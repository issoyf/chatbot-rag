import { Component, inject, signal, OnInit } from '@angular/core';
import { ChatService, Source, DocInfo, ConvInfo } from './chat.service';

interface Message {
  role: 'user' | 'bot';
  text: string;
  sources?: Source[];
}

@Component({
  selector: 'app-root',
  template: `
    <div class="layout">
      <aside class="sidebar">
        <button class="new" (click)="newConversation()">+ Nouvelle conversation</button>
        @for (c of conversations(); track c.id) {
          <div class="conv" [class.active]="c.id === currentId()" (click)="open(c.id)">
            <span>{{ c.title }}</span>
            <button class="del" (click)="removeConv(c.id, $event)">✕</button>
          </div>
        }
      </aside>

      <main class="chat">
        <h2>Assistant documentaire</h2>

        <div class="upload">
          <input type="file" accept=".pdf" (change)="onFile($event)" />
          <small>{{ uploadStatus() }}</small>
        </div>

        <div class="docs">
          <strong>Documents importés :</strong>
          @if (documents().length === 0) {
            <small>Aucun document.</small>
          }
          @for (d of documents(); track d.filename) {
            <div class="doc">
              <span>{{ d.filename }} ({{ d.chunks }} extraits)</span>
              <button (click)="remove(d.filename)">Supprimer</button>
            </div>
          }
        </div>

        <div class="messages">
          @for (m of messages(); track $index) {
            <div class="msg" [class.user]="m.role === 'user'">
              <p>{{ m.text }}</p>
              @if (m.sources?.length) {
                <small>
                  Sources :
                  @for (s of m.sources; track $index) {
                    {{ s.source }} (p.{{ s.page }}) &nbsp;
                  }
                </small>
              }
            </div>
          }
          @if (loading()) {
            <div class="msg">Réflexion en cours...</div>
          }
        </div>

        <div class="form">
          <input
            [value]="question()"
            (input)="question.set($any($event.target).value)"
            (keydown.enter)="send()"
            placeholder="Pose ta question..."
          />
          <button (click)="send()" [disabled]="loading()">Envoyer</button>
        </div>
      </main>
    </div>
  `,
  styles: [`
    .layout { display: flex; min-height: 100vh; font-family: sans-serif; }
    .sidebar { width: 260px; background: #f3f3f3; padding: 1rem; border-right: 1px solid #ddd; box-sizing: border-box; }
    .new { width: 100%; padding: .6rem; margin-bottom: 1rem; cursor: pointer; }
    .conv { display: flex; justify-content: space-between; align-items: center; padding: .5rem; border-radius: 6px; cursor: pointer; font-size: .9rem; }
    .conv:hover { background: #e4e4e4; }
    .conv.active { background: #d6e6f8; }
    .conv span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .del { border: none; background: none; cursor: pointer; color: #999; }
    .chat { flex: 1; max-width: 700px; margin: 2rem auto; padding: 0 1rem; }
    .upload { display: flex; flex-direction: column; gap: .25rem; }
    .upload small { color: #666; }
    .docs { margin: 1rem 0; }
    .doc { display: flex; justify-content: space-between; align-items: center; padding: .4rem 0; border-bottom: 1px solid #ddd; }
    .messages { min-height: 300px; margin: 1rem 0; }
    .msg { background: #eee; padding: .75rem; border-radius: 8px; margin: .5rem 0; max-width: 80%; }
    .msg p { margin: 0 0 .25rem; white-space: pre-wrap; }
    .msg.user { background: #1976d2; color: white; margin-left: auto; }
    .form { display: flex; gap: .5rem; }
    .form input { flex: 1; padding: .6rem; }
    .form button { padding: .6rem 1rem; }
  `],
})
export class App implements OnInit {
  private chat = inject(ChatService);

  messages = signal<Message[]>([]);
  documents = signal<DocInfo[]>([]);
  conversations = signal<ConvInfo[]>([]);
  currentId = signal<number | null>(null);
  loading = signal(false);
  uploadStatus = signal('');
  question = signal('');

  ngOnInit() {
    this.refreshDocs();
    this.refreshConvs();
  }

  refreshDocs() {
    this.chat.listDocuments().subscribe(d => this.documents.set(d));
  }

  refreshConvs() {
    this.chat.listConversations().subscribe(c => this.conversations.set(c));
  }

  newConversation() {
    this.currentId.set(null);
    this.messages.set([]);
  }

  open(id: number) {
    this.chat.getConversation(id).subscribe(c => {
      this.currentId.set(c.id);
      this.messages.set(c.messages.map(m => ({ ...m, sources: this.unique(m.sources) })));
    });
  }

  removeConv(id: number, event: Event) {
    event.stopPropagation();
    this.chat.deleteConversation(id).subscribe(() => {
      if (this.currentId() === id) this.newConversation();
      this.refreshConvs();
    });
  }

  onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadStatus.set('Import en cours (la première fois peut être long)...');
    this.chat.upload(file).subscribe({
      next: () => {
        this.uploadStatus.set(`${file.name} importé ✔`);
        this.refreshDocs();
        input.value = '';
      },
      error: err => {
        this.uploadStatus.set(err.error?.detail ?? "Erreur lors de l'import");
        input.value = '';
      },
    });
  }

  remove(filename: string) {
    this.chat.deleteDocument(filename).subscribe(() => this.refreshDocs());
  }

  send() {
    const q = this.question().trim();
    if (!q || this.loading()) return;

    this.messages.update(m => [...m, { role: 'user', text: q }]);
    this.question.set('');
    this.loading.set(true);

    this.chat.ask(q, this.currentId()).subscribe({
      next: res => {
        this.currentId.set(res.conversation_id);
        this.messages.update(m => [
          ...m,
          { role: 'bot', text: res.answer, sources: this.unique(res.sources) },
        ]);
        this.loading.set(false);
        this.refreshConvs();
      },
      error: () => {
        this.messages.update(m => [...m, { role: 'bot', text: 'Une erreur est survenue.' }]);
        this.loading.set(false);
      },
    });
  }

  // une seule ligne par source + page
  private unique(sources: Source[]): Source[] {
    const seen = new Set<string>();
    return sources.filter(s => {
      const key = `${s.source}-${s.page}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}