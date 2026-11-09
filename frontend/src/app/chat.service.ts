import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface Source {
  source: string;
  page: number;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
}

export interface DocInfo {
  filename: string;
  chunks: number;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private api = 'http://127.0.0.1:8000';

  ask(question: string) {
    return this.http.post<ChatResponse>(`${this.api}/chat`, { question });
  }

  upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post(`${this.api}/documents`, form);
  }

  listDocuments() {
    return this.http.get<DocInfo[]>(`${this.api}/documents`);
  }

  deleteDocument(filename: string) {
    return this.http.delete(`${this.api}/documents/${encodeURIComponent(filename)}`);
  }
}