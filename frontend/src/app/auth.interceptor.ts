import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    tap({
      error: err => {
        // Token expiré ou invalide : retour à la page de connexion
        if (err.status === 401 && !req.url.endsWith('/login')) {
          auth.logout();
        }
      },
    })
  );
};