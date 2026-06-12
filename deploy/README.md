# Деплой Cadence в интернете (безопасно)

Схема: **nginx** терминирует HTTPS, раздаёт собранный фронтенд и проксирует
`/api` на **сервер авторизации** (Node, папка `server/`).

```
браузер ──HTTPS──▶ nginx ──┬─▶ /            статика dist/ (SPA)
                           └─▶ /api/  ──────▶ Node auth server :3001
```

## Шаги

1. **Собрать фронтенд:**
   ```bash
   npm install
   npm run build          # появится dist/
   ```
   Скопируйте `dist/` на сервер (например, в `/var/www/cadence/dist`).

2. **Запустить сервер авторизации** (см. [`../server/README.md`](../server/README.md)):
   ```bash
   cd server
   npm install --omit=dev
   # .env с обязательным SESSION_SECRET и NODE_ENV=production
   NODE_ENV=production node server.js
   ```
   Лучше под systemd/pm2, чтобы перезапускался. Слушает `127.0.0.1:3001`
   (наружу его публиковать не нужно — только через nginx).

3. **Настроить nginx** по образцу [`nginx.conf`](nginx.conf): подставьте домен,
   пути к TLS-сертификату и к `dist/`. Перезагрузите nginx.

4. **Сертификат** — например, Let's Encrypt (certbot). HSTS включайте только
   после того, как HTTPS гарантированно работает.

## Пример systemd-юнита для сервера авторизации

```ini
# /etc/systemd/system/cadence-auth.service
[Unit]
Description=Cadence auth server
After=network.target

[Service]
WorkingDirectory=/var/www/cadence/server
Environment=NODE_ENV=production
EnvironmentFile=/var/www/cadence/server/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now cadence-auth
```

## Что это даёт по безопасности

- Пароли **не в коде** — только bcrypt-хеши на сервере, проверка серверная.
- Сессия в **httpOnly + Secure + SameSite=strict** cookie — недоступна JS, не уходит на сторонние сайты.
- **Авто-выход**: токен живёт 8 ч, плюс клиент разлогинивает после 30 мин простоя.
- **HTTPS** обязателен (иначе Secure-cookie не отправится), + заголовки (HSTS, CSP, X-Frame-Options…).

## Чего это НЕ делает (важно понимать)

- Данные (письма, задачи, документы) по-прежнему хранятся **в браузере** пользователя.
  Серверная авторизация ограничивает вход, но не переносит данные на сервер и не
  защищает их от владельца конкретного устройства. Если нужна централизованная
  база с разграничением доступа — это отдельный этап (перенос данных на бэкенд).
