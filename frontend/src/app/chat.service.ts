import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface Source {
  source: string;
  page: number;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  conversation_id: number;
}

export interface DocInfo {
  filename: string;
  chunks: number;
}

export interface ConvInfo {
  id: number;
  title: string;
}

export interface MessageDto {
  role: 'user' | 'bot';
  text: string;
  sources: Source[];
}

export interface ConvDetail {
  id: number;
  title: string;
  messages: MessageDto[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private api = 'http://127.0.0.1:8000';

  ask(question: string, conversationId: number | null) {
    return this.http.post<ChatResponse>(`${this.api}/chat`, {
      question,
      conversation_id: conversationId,
    });
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

  listConversations() {
    return this.http.get<ConvInfo[]>(`${this.api}/conversations`);
  }

  getConversation(id: number) {
    return this.http.get<ConvDetail>(`${this.api}/conversations/${id}`);
  }

  deleteConversation(id: number) {
    return this.http.delete(`${this.api}/conversations/${id}`);
  }
}