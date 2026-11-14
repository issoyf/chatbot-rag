import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';

interface AuthResponse {
  access_token: string;
  username: string;
  role: 'student' | 'admin';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private api = 'http://127.0.0.1:8000';

  token = signal<string | null>(localStorage.getItem('token'));
  username = signal<string | null>(localStorage.getItem('username'));
  role = signal<string | null>(localStorage.getItem('role'));

  isLoggedIn = computed(() => !!this.token());
  isAdmin = computed(() => this.role() === 'admin');

  login(username: string, password: string) {
    const body = new URLSearchParams();
    body.set('username', username);
    body.set('password', password);
    return this.http
      .post<AuthResponse>(`${this.api}/login`, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      .pipe(tap(r => this.save(r)));
  }

  register(username: string, password: string) {
    return this.http
      .post<AuthResponse>(`${this.api}/register`, { username, password })
      .pipe(tap(r => this.save(r)));
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    this.token.set(null);
    this.username.set(null);
    this.role.set(null);
  }

  private save(r: AuthResponse) {
    localStorage.setItem('token', r.access_token);
    localStorage.setItem('username', r.username);
    localStorage.setItem('role', r.role);
    this.token.set(r.access_token);
    this.username.set(r.username);
    this.role.set(r.role);
  }
}