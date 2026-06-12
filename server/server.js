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
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3001;
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
const usersPath = join(here, 'users.json');
const users = existsSync(usersPath) ? JSON.parse(readFileSync(usersPath, 'utf8')) : [];
if (users.length === 0) {
  console.warn('[auth] users.json пуст или не найден — войти будет нельзя. Сгенерируйте хеши: npm run hash "пароль".');
}

// Фиктивный хеш для несуществующих пользователей — чтобы время ответа не выдавало,
// существует логин или нет (защита от перебора логинов).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-please-ignore', 12);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());

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

// Необязательно: если рядом лежит собранный фронтенд (../dist) — раздаём его же.
// На бою фронт обычно отдаёт nginx, а этот сервер проксируется на /api.
const dist = join(here, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[auth] Cadence auth server слушает http://localhost:${PORT}  (prod=${PROD})`);
});
