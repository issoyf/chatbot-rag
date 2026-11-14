import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { marked } from 'marked';

import { ChatService, Source, DocInfo, ConvInfo } from './chat.service';
import { AuthService } from './auth.service';

interface Message {
  role: 'user' | 'bot';
  text: string;
  sources?: Source[];
}

marked.setOptions({ breaks: true });

@Component({
  selector: 'app-root',
  imports: [MatToolbarModule, MatButtonModule, MatProgressBarModule, MatSnackBarModule],
  template: `
    @if (!auth.isLoggedIn()) {
      <!-- ============ CONNEXION ============ -->
      <div class="login-page">
        <button class="theme-btn floating" (click)="toggleTheme()">
          {{ dark() ? '☀️' : '🌙' }}
        </button>
        <div class="login-box">
          <h2>{{ registerMode() ? 'Créer un compte' : 'Connexion' }}</h2>
          <p class="subtitle">Assistant documentaire</p>

          <input
            placeholder="Nom d'utilisateur"
            [value]="username()"
            (input)="username.set($any($event.target).value)"
          />
          <input
            type="password"
            placeholder="Mot de passe"
            [value]="password()"
            (input)="password.set($any($event.target).value)"
            (keydown.enter)="submitAuth()"
          />

          @if (authError()) {
            <p class="error">{{ authError() }}</p>
          }

          <button mat-flat-button (click)="submitAuth()">
            {{ registerMode() ? "S'inscrire" : 'Se connecter' }}
          </button>

          <a (click)="toggleMode()">
            @if (registerMode()) { Déjà un compte ? Se connecter }
            @else { Pas de compte ? S'inscrire }
          </a>
        </div>
      </div>
    } @else {
      <!-- ============ APPLICATION ============ -->
      <div class="app">
        <mat-toolbar class="topbar">
          <button class="icon-btn menu-btn" (click)="sidebarOpen.set(!sidebarOpen())">☰</button>
          <span class="title">🤖 Assistant documentaire</span>
          <span class="spacer"></span>
          <span class="who">
            {{ auth.username() }} · {{ auth.isAdmin() ? 'admin' : 'étudiant' }}
          </span>
          <button class="icon-btn" (click)="toggleTheme()" title="Changer de thème">
            {{ dark() ? '☀️' : '🌙' }}
          </button>
          <button mat-stroked-button (click)="auth.logout()">Déconnexion</button>
        </mat-toolbar>

        @if (uploading()) {
          <mat-progress-bar mode="indeterminate" />
        }

        <div class="body">
          @if (sidebarOpen()) {
            <div class="backdrop" (click)="sidebarOpen.set(false)"></div>
          }

          <aside class="sidebar" [class.open]="sidebarOpen()">
            <button mat-flat-button class="new" (click)="newConversation()">
              + Nouvelle conversation
            </button>
            <div class="convs">
              @for (c of conversations(); track c.id) {
                <div class="conv" [class.active]="c.id === currentId()" (click)="open(c.id)">
                  <span>{{ c.title }}</span>
                  <button class="del" (click)="removeConv(c.id, $event)" title="Supprimer">✕</button>
                </div>
              }
              @if (conversations().length === 0) {
                <small class="muted">Aucune conversation.</small>
              }
            </div>
          </aside>

          <main class="chat">
            <details class="docs">
              <summary>📄 Documents disponibles ({{ documents().length }})</summary>

              @if (auth.isAdmin()) {
                <div class="upload">
                  <input type="file" accept=".pdf" (change)="onFile($event)" />
                </div>
              }
              @if (documents().length === 0) {
                <small class="muted">Aucun document.</small>
              }
              @for (d of documents(); track d.filename) {
                <div class="doc">
                  <span>{{ d.filename }} <small class="muted">({{ d.chunks }} extraits)</small></span>
                  @if (auth.isAdmin()) {
                    <button class="link-danger" (click)="remove(d.filename)">Supprimer</button>
                  }
                </div>
              }
            </details>

            <div class="messages" #scrollBox>
              @if (messages().length === 0 && !loading()) {
                <div class="empty">
                  <p>👋 Pose une question sur les documents importés.</p>
                </div>
              }
              @for (m of messages(); track $index) {
                <div class="msg" [class.user]="m.role === 'user'">
                  @if (m.role === 'bot') {
                    <div class="md" [innerHTML]="render(m.text)"></div>
                  } @else {
                    <div class="plain">{{ m.text }}</div>
                  }
                  @if (m.sources?.length) {
                    <div class="sources">
                      @for (s of m.sources; track $index) {
                        <span class="chip">{{ s.source }} · p.{{ s.page }}</span>
                      }
                    </div>
                  }
                </div>
              }
              @if (loading()) {
                <div class="msg typing"><span></span><span></span><span></span></div>
              }
            </div>

            <div class="form">
              <input
                [value]="question()"
                (input)="question.set($any($event.target).value)"
                (keydown.enter)="send()"
                placeholder="Pose ta question..."
              />
              <button mat-flat-button (click)="send()" [disabled]="loading()">Envoyer</button>
            </div>
          </main>
        </div>
      </div>
    }
  `,
  styles: [`
    * { box-sizing: border-box; }
    button { font-family: inherit; }
    input { font-family: inherit; font-size: 1rem; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 8px; outline: none; }
    input:focus { border-color: var(--primary); }
    .muted { color: var(--muted); }

    /* ---- Connexion ---- */
    .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; position: relative; }
    .login-box { background: var(--surface); padding: 2rem; border-radius: 14px; width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: .8rem; box-shadow: 0 4px 20px rgba(0,0,0,.12); border: 1px solid var(--border); }
    .login-box h2 { margin: 0; text-align: center; }
    .subtitle { margin: 0 0 .5rem; text-align: center; color: var(--muted); }
    .login-box input { padding: .7rem; }
    .login-box a { text-align: center; color: var(--primary); cursor: pointer; font-size: .9rem; }
    .error { color: var(--danger); margin: 0; font-size: .9rem; }
    .floating { position: absolute; top: 1rem; right: 1rem; }

    /* ---- Structure ---- */
    .app { height: 100vh; display: flex; flex-direction: column; }
    .topbar { background: var(--surface); color: var(--text); border-bottom: 1px solid var(--border); gap: .6rem; flex-shrink: 0; }
    .title { font-weight: 600; font-size: 1.05rem; white-space: nowrap; }
    .spacer { flex: 1; }
    .who { color: var(--muted); font-size: .85rem; white-space: nowrap; }
    .icon-btn, .theme-btn { background: none; border: 1px solid var(--border); border-radius: 8px; padding: .35rem .6rem; cursor: pointer; font-size: 1.05rem; color: var(--text); }
    .menu-btn { display: none; }
    .body { flex: 1; display: flex; min-height: 0; position: relative; }

    /* ---- Barre latérale ---- */
    .sidebar { width: 270px; background: var(--sidebar); border-right: 1px solid var(--border); padding: 1rem; display: flex; flex-direction: column; gap: 1rem; flex-shrink: 0; }
    .new { width: 100%; }
    .convs { flex: 1; overflow-y: auto; }
    .conv { display: flex; justify-content: space-between; align-items: center; padding: .55rem .6rem; border-radius: 8px; cursor: pointer; font-size: .92rem; }
    .conv:hover { background: var(--hover); }
    .conv.active { background: var(--active); }
    .conv span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .del { border: none; background: none; cursor: pointer; color: var(--muted); }
    .del:hover { color: var(--danger); }
    .backdrop { display: none; }

    /* ---- Zone de chat ---- */
    .chat { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 1rem; gap: .8rem; max-width: 900px; margin: 0 auto; width: 100%; }
    .docs { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: .6rem .9rem; flex-shrink: 0; }
    .docs summary { cursor: pointer; font-weight: 500; }
    .upload { margin: .6rem 0; }
    .doc { display: flex; justify-content: space-between; align-items: center; padding: .4rem 0; border-bottom: 1px solid var(--border); gap: .5rem; word-break: break-word; }
    .link-danger { background: none; border: none; color: var(--danger); cursor: pointer; }

    .messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: .6rem; padding: .3rem; scroll-behavior: smooth; }
    .empty { margin: auto; color: var(--muted); text-align: center; }
    .msg { background: var(--bubble); padding: .7rem .95rem; border-radius: 14px 14px 14px 4px; max-width: 85%; line-height: 1.5; word-break: break-word; }
    .msg.user { background: var(--primary); color: white; margin-left: auto; border-radius: 14px 14px 4px 14px; }
    .plain { white-space: pre-wrap; }
    .sources { margin-top: .5rem; display: flex; flex-wrap: wrap; gap: .35rem; }
    .chip { font-size: .75rem; background: var(--surface); color: var(--muted); border: 1px solid var(--border); padding: .1rem .5rem; border-radius: 999px; }

    .typing { display: flex; gap: .3rem; width: 64px; }
    .typing span { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite ease-in-out; }
    .typing span:nth-child(2) { animation-delay: .2s; }
    .typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

    .form { display: flex; gap: .5rem; flex-shrink: 0; }
    .form input { flex: 1; padding: .75rem; }

    /* ---- Mobile ---- */
    @media (max-width: 800px) {
      .menu-btn { display: inline-block; }
      .who { display: none; }
      .title { font-size: .95rem; }
      .sidebar { position: absolute; top: 0; bottom: 0; left: 0; z-index: 20; transform: translateX(-100%); transition: transform .2s; }
      .sidebar.open { transform: translateX(0); box-shadow: 4px 0 20px rgba(0,0,0,.25); }
      .backdrop { display: block; position: absolute; inset: 0; background: rgba(0,0,0,.35); z-index: 10; }
      .msg { max-width: 95%; }
    }
  `],
})
export class App {
  private chat = inject(ChatService);
  private snack = inject(MatSnackBar);
  auth = inject(AuthService);

  scrollBox = viewChild<ElementRef<HTMLElement>>('scrollBox');

  messages = signal<Message[]>([]);
  documents = signal<DocInfo[]>([]);
  conversations = signal<ConvInfo[]>([]);
  currentId = signal<number | null>(null);
  loading = signal(false);
  uploading = signal(false);
  question = signal('');
  sidebarOpen = signal(false);
  dark = signal(localStorage.getItem('dark') === '1');

  username = signal('');
  password = signal('');
  registerMode = signal(false);
  authError = signal('');

  constructor() {
    // Thème clair / sombre
    effect(() => {
      const theme = this.dark() ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.style.colorScheme = theme;
      localStorage.setItem('dark', this.dark() ? '1' : '0');
    });

    // Chargement des données à la connexion, nettoyage à la déconnexion
    effect(() => {
      if (this.auth.isLoggedIn()) {
        this.refreshDocs();
        this.refreshConvs();
      } else {
        this.messages.set([]);
        this.documents.set([]);
        this.conversations.set([]);
        this.currentId.set(null);
      }
    });

    // Défilement automatique vers le dernier message
    effect(() => {
      this.messages();
      this.loading();
      setTimeout(() => {
        const el = this.scrollBox()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, 0);
    });
  }

  render(text: string): string {
    return marked.parse(text, { async: false }) as string;
  }

  toggleTheme() {
    this.dark.update(v => !v);
  }

  toggleMode() {
    this.registerMode.update(v => !v);
    this.authError.set('');
  }

  submitAuth() {
    const u = this.username().trim();
    const p = this.password();
    if (!u || !p) {
      this.authError.set('Remplis les deux champs.');
      return;
    }
    const request = this.registerMode()
      ? this.auth.register(u, p)
      : this.auth.login(u, p);

    request.subscribe({
      next: () => {
        this.username.set('');
        this.password.set('');
        this.authError.set('');
      },
      error: err => {
        const detail = err.error?.detail;
        this.authError.set(
          typeof detail === 'string' ? detail : 'Connexion impossible. Vérifie le serveur.'
        );
      },
    });
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
    this.sidebarOpen.set(false);
  }

  open(id: number) {
    this.chat.getConversation(id).subscribe(c => {
      this.currentId.set(c.id);
      this.messages.set(c.messages.map(m => ({ ...m, sources: this.unique(m.sources) })));
      this.sidebarOpen.set(false);
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
    this.uploading.set(true);
    this.chat.upload(file).subscribe({
      next: () => {
        this.uploading.set(false);
        this.snack.open(`${file.name} importé ✔`, 'OK', { duration: 4000 });
        this.refreshDocs();
        input.value = '';
      },
      error: err => {
        this.uploading.set(false);
        this.snack.open(err.error?.detail ?? "Erreur lors de l'import", 'OK', { duration: 5000 });
        input.value = '';
      },
    });
  }

  remove(filename: string) {
    this.chat.deleteDocument(filename).subscribe(() => {
      this.snack.open(`${filename} supprimé`, 'OK', { duration: 3000 });
      this.refreshDocs();
    });
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