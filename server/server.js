// Сервер авторизации Cadence.
//
// Что делает:
//  • POST /api/login   — проверяет логин/пароль по bcrypt-хешу из users.json,
//                        выдаёт сессию в httpOnly-cookie (JWT). Пароль в браузер не попадает.
//  • GET  /api/me      — возвращает текущую сессию по cookie (для восстановления входа).
//  • POST /api/logout  — стирает cookie сессии.
//
// Пароли в открытом виде НИГДЕ не хранятся — только bcrypt-хеши в users.json.
// Секрет подписи берётся из переменной окружения SESSION_SECRET (обязательно в проде).

import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3001;

// Папка с данными приложения (снимок). По умолчанию server/data — её НЕ трогает
// обновление кода, поэтому введённые данные сохраняются между версиями.
// Для надёжности можно задать DATA_DIR вне каталога деплоя.
const DATA_DIR = process.env.DATA_DIR
  ? (isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : join(here, process.env.DATA_DIR))
  : join(here, 'data');
mkdirSync(DATA_DIR, { recursive: true });
const STORE_FILE = join(DATA_DIR, 'store.json');
const PROD = process.env.NODE_ENV === 'production';
const TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS) || 8 * 60 * 60; // 8 часов
const COOKIE = 'cadence_session';

// Флаг Secure у cookie сессии (cookie уходит только по HTTPS).
// По умолчанию: в проде — включён, в dev — выключен. Но если HTTPS нет,
// поставьте COOKIE_SECURE=false, иначе вход по HTTP не заработает.
const COOKIE_SECURE =
  process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === 'true' : PROD;

// Секрет подписи токенов. В проде ОБЯЗАТЕЛЬНО задать SESSION_SECRET,
// иначе при перезапуске сервера все сессии станут недействительны.
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[auth] ВНИМАНИЕ: SESSION_SECRET не задан — используется случайный секрет.\n' +
      '       Сессии сбросятся при перезапуске. Задайте SESSION_SECRET в продакшене.',
  );
}
if (PROD && !process.env.SESSION_SECRET) {
  console.error('[auth] В продакшене SESSION_SECRET обязателен. Останавливаюсь.');
  process.exit(1);
}
if (PROD && !COOKIE_SECURE) {
  console.warn(
    '[auth] ВНИМАНИЕ: COOKIE_SECURE=false — cookie сессии ходит по незашифрованному HTTP.\n' +
      '       Это работает, но трафик можно перехватить. По возможности используйте HTTPS.',
  );
}

// Пользователи: [{ username, role: 'admin'|'viewer', passwordHash }]
// users.json НЕ в git (его меняют пароли/пользователи в рантайме). При первом
// запуске создаём его из шаблона users.example.json — чтобы свежий деплой работал.
const usersPath = join(here, 'users.json');
const usersExample = join(here, 'users.example.json');
if (!existsSync(usersPath) && existsSync(usersExample)) {
  copyFileSync(usersExample, usersPath);
  console.warn('[auth] users.json не найден — создан из users.example.json. ОБЯЗАТЕЛЬНО смените стартовые пароли!');
}
const users = existsSync(usersPath) ? JSON.parse(readFileSync(usersPath, 'utf8')) : [];
if (users.length === 0) {
  console.warn('[auth] users.json пуст или не найден — войти будет нельзя. Сгенерируйте хеши: npm run hash "пароль".');
}

// Фиктивный хеш для несуществующих пользователей — чтобы время ответа не выдавало,
// существует логин или нет (защита от перебора логинов).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-please-ignore', 12);

// Атомичное сохранение списка пользователей обратно в users.json.
function saveUsers() {
  const tmp = `${usersPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(users, null, 2)}\n`);
  renameSync(tmp, usersPath);
}
const MIN_PASSWORD = 6;
const adminCount = () => users.filter((u) => u.role === 'admin').length;

const app = express();
app.disable('x-powered-by');
// Лимит большой: снимок данных включает файлы документов (base64).
app.use(express.json({ limit: '64mb' }));
app.use(cookieParser());

// --- Middleware авторизации для защищённых маршрутов ---
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'нет сессии' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'сессия недействительна' });
  }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'нужны права администратора' });
  next();
}

function issueSession(res, payload) {
  const token = jwt.sign(payload, SECRET, { expiresIn: TTL_SECONDS });
  res.cookie(COOKIE, token, {
    httpOnly: true, // недоступна из JS — защита от кражи через XSS
    sameSite: 'strict', // не отправляется на сторонние запросы — защита от CSRF
    secure: COOKIE_SECURE, // по HTTPS; для HTTP-деплоя поставьте COOKIE_SECURE=false
    maxAge: TTL_SECONDS * 1000,
    path: '/',
  });
}

app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());

  // Всегда выполняем bcrypt.compare (даже если юзера нет) — постоянное время ответа.
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  issueSession(res, { username: user.username, role: user.role });
  res.json({ username: user.username, role: user.role });
});

app.get('/api/me', (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'нет сессии' });
  try {
    const payload = jwt.verify(token, SECRET);
    res.json({ username: payload.username, role: payload.role });
  } catch {
    res.status(401).json({ error: 'сессия недействительна' });
  }
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Проверка живости (без авторизации) — удобно для мониторинга и шага «проверить».
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// --- Управление пользователями ---

// Сменить СВОЙ пароль (любой вошедший): нужен текущий пароль.
app.post('/api/account/password', requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword ?? '');
  const next = String(req.body?.newPassword ?? '');
  if (next.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Новый пароль слишком короткий (мин. ${MIN_PASSWORD}).` });
  }
  const user = users.find((u) => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const ok = await bcrypt.compare(current, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Текущий пароль неверен' });
  user.passwordHash = bcrypt.hashSync(next, 12);
  saveUsers();
  res.json({ ok: true });
});

// Список пользователей (без хешей) — только admin.
app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
  res.json(users.map((u) => ({ username: u.username, role: u.role })));
});

// Добавить пользователя — только admin.
app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const role = req.body?.role === 'admin' ? 'admin' : 'viewer';
  if (!username) return res.status(400).json({ error: 'Укажите логин' });
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Пароль слишком короткий (мин. ${MIN_PASSWORD}).` });
  }
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Такой логин уже существует' });
  }
  users.push({ username, role, passwordHash: bcrypt.hashSync(password, 12) });
  saveUsers();
  res.json({ username, role });
});

// Изменить пользователя (роль и/или сбросить пароль) — только admin.
app.patch('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  const user = users.find((u) => u.username.toLowerCase() === String(req.params.username).toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  if (req.body?.role === 'admin' || req.body?.role === 'viewer') {
    if (user.role === 'admin' && req.body.role !== 'admin' && adminCount() <= 1) {
      return res.status(400).json({ error: 'Нельзя убрать последнего администратора' });
    }
    user.role = req.body.role;
  }
  if (typeof req.body?.password === 'string' && req.body.password.length > 0) {
    if (req.body.password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Пароль слишком короткий (мин. ${MIN_PASSWORD}).` });
    }
    user.passwordHash = bcrypt.hashSync(req.body.password, 12);
  }
  saveUsers();
  res.json({ username: user.username, role: user.role });
});

// Удалить пользователя — только admin (нельзя себя и нельзя последнего админа).
app.delete('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  const idx = users.findIndex((u) => u.username.toLowerCase() === String(req.params.username).toLowerCase());
  if (idx === -1) return res.status(404).json({ error: 'Пользователь не найден' });
  if (users[idx].username === req.user.username) return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  if (users[idx].role === 'admin' && adminCount() <= 1) {
    return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
  }
  users.splice(idx, 1);
  saveUsers();
  res.json({ ok: true });
});

// --- Хранилище данных приложения (общий снимок) ---
// GET — отдаёт сохранённый снимок (любой вошедший). PUT — сохраняет (только admin).
// Снимок в формате резервной копии приложения: письма, задачи, документы и т.д.

app.get('/api/store', requireAuth, (_req, res) => {
  if (!existsSync(STORE_FILE)) return res.json({ empty: true });
  try {
    res.type('application/json').send(readFileSync(STORE_FILE, 'utf8'));
  } catch {
    res.status(500).json({ error: 'не удалось прочитать данные' });
  }
});

app.put('/api/store', requireAuth, requireAdmin, (req, res) => {
  try {
    // Атомичная запись: пишем во временный файл и переименовываем.
    const tmp = `${STORE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(req.body));
    renameSync(tmp, STORE_FILE);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'не удалось сохранить данные' });
  }
});

// Необязательно: если рядом лежит собранный фронтенд (../dist) — раздаём его же.
// На бою фронт обычно отдаёт nginx, а этот сервер проксируется на /api.
const dist = join(here, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[auth] Cadence слушает http://localhost:${PORT}  (prod=${PROD})`);
  console.log(`[auth] данные приложения: ${STORE_FILE}`);
});
