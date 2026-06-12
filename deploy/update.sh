#!/usr/bin/env bash
# Обновление Cadence из git: подтянуть код → пересобрать фронтенд →
# обновить зависимости сервера → перезапустить → проверить.
#
# Что НЕ трогается (всё в .gitignore, поэтому переживает обновление):
#   • server/data/      — данные приложения (письма, документы …)
#   • server/.env       — секреты и настройки
#   • server/users.json — пользователи и пароли
#
# Использование:  bash deploy/update.sh
# Перед первым запуском поправьте SERVICE при необходимости.

set -euo pipefail

SERVICE="cadence-auth"                 # имя systemd-службы сервера
HEALTH_URL="http://127.0.0.1:3001/api/health"

cd "$(dirname "$0")/.."                 # корень репозитория

echo "→ git pull"
git pull

echo "→ сборка фронтенда"
npm ci
npm run build

echo "→ зависимости сервера"
( cd server && npm install --omit=dev )

echo "→ перезапуск службы $SERVICE"
sudo systemctl restart "$SERVICE"

echo "→ проверка живости"
sleep 1
if curl -fsS "$HEALTH_URL" >/dev/null; then
  echo "✓ Обновление завершено, сервер отвечает."
else
  echo "✗ Сервер не отвечает на $HEALTH_URL — проверьте: sudo journalctl -u $SERVICE -n 50"
  exit 1
fi
