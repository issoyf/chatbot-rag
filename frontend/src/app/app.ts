import { Component, inject, signal } from '@angular/core';
import { ChatService, Source } from './chat.service';

interface Message {
  role: 'user' | 'bot';
  text: string;
  sources?: Source[];
}

@Component({
  selector: 'app-root',
  template: `
    <div class="chat">
      <h2>Assistant documentaire</h2>

      <div class="upload">
        <input type="file" accept=".pdf" (change)="onFile($event)" />
        <small>{{ uploadStatus() }}</small>
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
    </div>
  `,
  styles: [`
    .chat { max-width: 700px; margin: 2rem auto; font-family: sans-serif; padding: 0 1rem; }
    .upload { display: flex; flex-direction: column; gap: .25rem; }
    .upload small { color: #666; }
    .messages { min-height: 300px; margin: 1rem 0; }
    .msg { background: #eee; padding: .75rem; border-radius: 8px; margin: .5rem 0; max-width: 80%; }
    .msg p { margin: 0 0 .25rem; white-space: pre-wrap; }
    .msg.user { background: #1976d2; color: white; margin-left: auto; }
    .form { display: flex; gap: .5rem; }
    .form input { flex: 1; padding: .6rem; }
    .form button { padding: .6rem 1rem; }
  `],
})
export class App {
  private chat = inject(ChatService);

  messages = signal<Message[]>([]);
  loading = signal(false);
  uploadStatus = signal('');
  question = signal('');

  onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.uploadStatus.set('Import en cours (la première fois peut être long)...');
    this.chat.upload(file).subscribe({
      next: () => this.uploadStatus.set(`${file.name} importé ✔`),
      error: () => this.uploadStatus.set("Erreur lors de l'import"),
    });
  }

  send() {
    const q = this.question().trim();
    if (!q || this.loading()) return;

    this.messages.update(m => [...m, { role: 'user', text: q }]);
    this.question.set('');
    this.loading.set(true);

    this.chat.ask(q).subscribe({
      next: res => {
        this.messages.update(m => [
          ...m,
          { role: 'bot', text: res.answer, sources: this.unique(res.sources) },
        ]);
        this.loading.set(false);
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