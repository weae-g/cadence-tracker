# Cadence — сервер авторизации

Небольшой сервис на Express: проверяет пароль по bcrypt-хешу и выдаёт сессию
в httpOnly-cookie (JWT). Пароли в открытом виде нигде не хранятся и в браузер
не передаются.

## Запуск (разработка)

```bash
cd server
npm install
cp .env.example .env      # затем впишите SESSION_SECRET
npm start                 # http://localhost:3001
```

Фронтенд в dev-режиме (`npm run dev` в корне) проксирует `/api` на этот сервер
(см. `vite.config.ts`).

## Пользователи

Хранятся в `server/users.json`:

```json
[
  { "username": "cadmin", "role": "admin",  "passwordHash": "$2a$12$..." },
  { "username": "cview",  "role": "viewer", "passwordHash": "$2a$12$..." }
]
```

Стартовые учётки (поменяйте пароли!):

| Логин   | Пароль        | Роль   |
|---------|---------------|--------|
| cadmin  | `Cadence!2026`| admin  |
| cview   | `View!2026`   | viewer |

Сменить пароль / добавить пользователя:

```bash
npm run hash "новый-пароль"     # печатает bcrypt-хеш
# вставьте хеш в users.json как passwordHash
```

`role` — только `admin` (полный доступ) или `viewer` (просмотр).

## Переменные окружения (`.env`)

| Переменная            | Назначение                                        |
|-----------------------|---------------------------------------------------|
| `SESSION_SECRET`      | Секрет подписи токенов. **Обязателен в проде.**   |
| `PORT`                | Порт (по умолчанию 3001)                           |
| `SESSION_TTL_SECONDS` | Время жизни сессии (по умолчанию 28800 = 8 часов)  |
| `NODE_ENV`            | `production` включает Secure-cookie и проверку секрета |

Сгенерировать секрет:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Продакшен

- Запускайте под процесс-менеджером (systemd / pm2) с `NODE_ENV=production` и заданным `SESSION_SECRET`.
- Доступ — **только по HTTPS** (Secure-cookie иначе не уйдёт). Терминируйте TLS на nginx.
- nginx проксирует `/api` на этот сервер и раздаёт собранный фронтенд (`dist/`).
  Готовый конфиг с заголовками безопасности — в [`deploy/nginx.conf`](../deploy/nginx.conf).

## API

| Метод/путь        | Назначение                                    |
|-------------------|-----------------------------------------------|
| `POST /api/login` | `{username,password}` → ставит cookie сессии  |
| `GET  /api/me`    | текущая сессия по cookie (или 401)            |
| `POST /api/logout`| стирает cookie                                |
