// ⚠️ Клиентская авторизация: барьер от случайных посетителей, НЕ криптозащита.
// Пароли попадают в собранный JS — подготовленный пользователь их увидит.
// Для настоящей защиты нужна серверная аутентификация (когда появится бэкенд).
//
// Учётки меняй прямо здесь.
export type Role = 'admin' | 'viewer';

export type User = { username: string; password: string; role: Role };

export const USERS: User[] = [
  { username: 'admin', password: 'admin', role: 'admin' }, // полный доступ
  { username: 'viewer', password: 'viewer', role: 'viewer' }, // только просмотр
];

export type Session = { username: string; role: Role };

const SESSION_KEY = 'resolve-table-session-v1';

export function authenticate(username: string, password: string): Session | null {
  const user = USERS.find(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password,
  );
  return user ? { username: user.username, role: user.role } : null;
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (parsed && typeof parsed.username === 'string' && (parsed.role === 'admin' || parsed.role === 'viewer')) {
      return parsed;
    }
  } catch {
    /* игнорируем битую сессию */
  }
  return null;
}

export function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
