import uuid
import ollama
import chromadb
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader

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


@app.post("/documents")
async def upload_document(file: UploadFile = File(...)):
    # Protection contre les doublons
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
def list_documents():
    data = collection.get(include=["metadatas"])
    counts = {}
    for m in data["metadatas"]:
        counts[m["source"]] = counts.get(m["source"], 0) + 1
    return [{"filename": name, "chunks": n} for name, n in counts.items()]


@app.delete("/documents/{filename}")
def delete_document(filename: str):
    collection.delete(where={"source": filename})
    return {"deleted": filename}


class ChatRequest(BaseModel):
    question: str


@app.post("/chat")
def chat(req: ChatRequest):
    if collection.count() == 0:
        return {"answer": "Aucun document importé pour le moment.", "sources": []}

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
    sources = [{"source": m["source"], "page": m["page"]} for m in metas]
    return {"answer": response["message"]["content"], "sources": sources}