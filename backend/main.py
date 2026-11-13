import json
import uuid
import ollama
import chromadb
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from pypdf import PdfReader

from database import SessionLocal, User, Conversation, Message
from auth import (
    hash_password, verify_password, create_token,
    get_current_user, require_admin,
)

MODEL = "llama3.2:3b"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

chroma = chromadb.PersistentClient(path="./chroma_db")
collection = chroma.get_or_create_collection("documents")


def chunk_text(text, size=800, overlap=100):
    chunks, start = [], 0
    while start < len(text):
        chunks.append(text[start:start + size])
        start += size - overlap
    return chunks


# ---------- Création du compte admin au démarrage ----------

def create_default_admin():
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.username == "admin").first():
            db.add(User(
                username="admin",
                password_hash=hash_password("admin123"),
                role="admin",
            ))
            db.commit()
    finally:
        db.close()


create_default_admin()


# ---------- Authentification ----------

class RegisterRequest(BaseModel):
    username: str
    password: str


def auth_response(user: User):
    return {
        "access_token": create_token(user),
        "token_type": "bearer",
        "username": user.username,
        "role": user.role,
    }


@app.post("/register")
def register(req: RegisterRequest):
    username = req.username.strip()
    if len(username) < 3:
        raise HTTPException(status_code=422, detail="Nom d'utilisateur trop court (3 minimum).")
    if len(req.password) < 6:
        raise HTTPException(status_code=422, detail="Mot de passe trop court (6 minimum).")

    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == username).first():
            raise HTTPException(status_code=409, detail="Ce nom d'utilisateur existe déjà.")
        user = User(username=username, password_hash=hash_password(req.password), role="student")
        db.add(user)
        db.commit()
        db.refresh(user)
        return auth_response(user)
    finally:
        db.close()


@app.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends()):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == form.username).first()
        if not user or not verify_password(form.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Identifiants incorrects.")
        return auth_response(user)
    finally:
        db.close()


@app.get("/me")
def me(user: dict = Depends(get_current_user)):
    return user


# ---------- Documents ----------

@app.post("/documents")
async def upload_document(file: UploadFile = File(...), admin: dict = Depends(require_admin)):
    existing = collection.get(where={"source": file.filename})
    if existing["ids"]:
        raise HTTPException(status_code=409, detail="Ce document est déjà importé.")

    reader = PdfReader(file.file)
    ids, docs, metas = [], [], []
    for page_num, page in enumerate(reader.pages, start=1):
        for chunk in chunk_text(page.extract_text() or ""):
            ids.append(str(uuid.uuid4()))
            docs.append(chunk)
            metas.append({"source": file.filename, "page": page_num})
    if not docs:
        raise HTTPException(status_code=422, detail="Aucun texte trouvé dans ce PDF.")
    collection.add(ids=ids, documents=docs, metadatas=metas)
    return {"filename": file.filename, "chunks": len(docs)}


@app.get("/documents")
def list_documents(user: dict = Depends(get_current_user)):
    data = collection.get(include=["metadatas"])
    counts = {}
    for m in data["metadatas"]:
        counts[m["source"]] = counts.get(m["source"], 0) + 1
    return [{"filename": name, "chunks": n} for name, n in counts.items()]


@app.delete("/documents/{filename}")
def delete_document(filename: str, admin: dict = Depends(require_admin)):
    collection.delete(where={"source": filename})
    return {"deleted": filename}


# ---------- Conversations (propres à chaque utilisateur) ----------

@app.get("/conversations")
def list_conversations(user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        convs = (
            db.query(Conversation)
            .filter(Conversation.user_id == user["id"])
            .order_by(Conversation.id.desc())
            .all()
        )
        return [{"id": c.id, "title": c.title} for c in convs]
    finally:
        db.close()


@app.get("/conversations/{conv_id}")
def get_conversation(conv_id: int, user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = db.get(Conversation, conv_id)
        if not c or c.user_id != user["id"]:
            raise HTTPException(status_code=404, detail="Conversation introuvable.")
        return {
            "id": c.id,
            "title": c.title,
            "messages": [
                {"role": m.role, "text": m.text, "sources": json.loads(m.sources)}
                for m in c.messages
            ],
        }
    finally:
        db.close()


@app.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: int, user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = db.get(Conversation, conv_id)
        if c and c.user_id == user["id"]:
            db.delete(c)
            db.commit()
        return {"deleted": conv_id}
    finally:
        db.close()


# ---------- Chat ----------

class ChatRequest(BaseModel):
    question: str
    conversation_id: int | None = None


@app.post("/chat")
def chat(req: ChatRequest, user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        if req.conversation_id:
            conv = db.get(Conversation, req.conversation_id)
            if not conv or conv.user_id != user["id"]:
                raise HTTPException(status_code=404, detail="Conversation introuvable.")
        else:
            conv = Conversation(title=req.question[:50], user_id=user["id"])
            db.add(conv)
            db.commit()
            db.refresh(conv)

        db.add(Message(conversation_id=conv.id, role="user", text=req.question))
        db.commit()

        if collection.count() == 0:
            answer, sources = "Aucun document importé pour le moment.", []
        else:
            results = collection.query(query_texts=[req.question], n_results=4)
            docs = results["documents"][0]
            metas = results["metadatas"][0]
            context = "\n\n".join(
                f"[{m['source']}, page {m['page']}]\n{d}" for d, m in zip(docs, metas)
            )
            response = ollama.chat(
                model=MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Tu réponds en français, uniquement à partir du contexte fourni. "
                            "Si la réponse n'y est pas, dis-le clairement."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Contexte :\n{context}\n\nQuestion : {req.question}",
                    },
                ],
            )
            answer = response["message"]["content"]
            sources = [{"source": m["source"], "page": m["page"]} for m in metas]

        db.add(Message(
            conversation_id=conv.id, role="bot", text=answer,
            sources=json.dumps(sources),
        ))
        db.commit()
        return {"answer": answer, "sources": sources, "conversation_id": conv.id}
    finally:
        db.close()