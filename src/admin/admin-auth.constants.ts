export const ADMIN_SESSION_COOKIE = '__Secure-wenyou-admin-session';
export const ADMIN_SESSION_COOKIE_DEV = 'wenyou-admin-session';
export const ADMIN_CSRF_COOKIE = '__Secure-wenyou-admin-csrf';
export const ADMIN_CSRF_COOKIE_DEV = 'wenyou-admin-csrf';
export const ADMIN_STEP_UP_KEY = 'admin-step-up-required';

export function adminSessionCookieName(production: boolean): string {
  return production ? ADMIN_SESSION_COOKIE : ADMIN_SESSION_COOKIE_DEV;
}

export function adminCsrfCookieName(production: boolean): string {
  return production ? ADMIN_CSRF_COOKIE : ADMIN_CSRF_COOKIE_DEV;
}
