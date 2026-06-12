// Клиентская часть авторизации. Пароли НЕ хранятся в приложении — проверку
// выполняет сервер ([server/server.js]). Сессия живёт в httpOnly-cookie,
// недоступной из JS, поэтому здесь нет ни паролей, ни токенов.

export type Role = 'admin' | 'viewer';

export type Session = { username: string; role: Role };

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.username === 'string' && (v.role === 'admin' || v.role === 'viewer');
}

// Вход: сервер проверяет пароль и ставит cookie сессии. Бросает ошибку с текстом.
export async function login(username: string, password: string): Promise<Session> {
  let res: Response;
  try {
    res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('Сервер недоступен. Проверьте подключение.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'Не удалось войти');
  }
  const data = await res.json();
  if (!isSession(data)) throw new Error('Некорректный ответ сервера');
  return data;
}

// Текущая сессия по cookie (для восстановления входа после перезагрузки). null — если нет.
export async function fetchSession(): Promise<Session | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    return isSession(data) ? data : null;
  } catch {
    return null;
  }
}

// Выход: сервер стирает cookie сессии.
export async function logout(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* даже если запрос не прошёл — на клиенте всё равно разлогиниваемся */
  }
}

// --- Управление пользователями ---

async function api(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new Error('Сервер недоступен');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'Ошибка запроса');
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export type ManagedUser = { username: string; role: Role };

// Сменить свой пароль (нужен текущий).
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api('/api/account/password', jsonInit('POST', { currentPassword, newPassword }));
}

// Админ: список пользователей.
export async function listUsers(): Promise<ManagedUser[]> {
  return (await api('/api/users')) as ManagedUser[];
}

// Админ: добавить пользователя.
export async function createUser(username: string, password: string, role: Role): Promise<void> {
  await api('/api/users', jsonInit('POST', { username, password, role }));
}

// Админ: изменить роль и/или сбросить пароль.
export async function updateUser(
  username: string,
  patch: { role?: Role; password?: string },
): Promise<void> {
  await api(`/api/users/${encodeURIComponent(username)}`, jsonInit('PATCH', patch));
}

// Админ: удалить пользователя.
export async function deleteUser(username: string): Promise<void> {
  await api(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
}
