#!/bin/bash
# Деплой серверного кода на VPS (/opt/worksly-checker)
#
# Использование:
#   ./deploy.sh          — проверка различий с сервером (dry-run)
#   ./deploy.sh --push   — проверка синтаксиса, заливка и перезапуск сервиса

set -u

SSH_KEY="$HOME/.ssh/worksly_server"
REMOTE_DIR="/opt/worksly-checker"
FILES=(checker.js server.js domains.json)

cd "$(dirname "$0")" || exit 1

# Адрес сервера в репозитории НЕ хранится: репозиторий публичный, и строка вида root@<ip>
# в открытом виде прямо подсказывает, какой хост и какого пользователя перебирать.
# Берём из переменной окружения, иначе из .env.local — он в git не попадает.
if [ -z "${WORKSLY_SSH_HOST:-}" ] && [ -f .env.local ]; then
  WORKSLY_SSH_HOST=$(grep -E '^SSH_HOST=' .env.local | head -1 | cut -d= -f2- | tr -d '\r"' | xargs)
fi
SSH_HOST="${WORKSLY_SSH_HOST:-}"

if [ -z "$SSH_HOST" ]; then
  echo "Не задан адрес сервера."
  echo "Впишите строку  SSH_HOST=root@<ip>  в server/.env.local"
  echo "или задайте переменную окружения WORKSLY_SSH_HOST."
  exit 1
fi

ssh_run() {
  ssh -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" "$SSH_HOST" "$@"
}

check() {
  local drift=0
  for f in "${FILES[@]}"; do
    local_hash=$(md5sum "$f" | cut -d' ' -f1)
    remote_hash=$(ssh_run "md5sum $REMOTE_DIR/$f 2>/dev/null | cut -d' ' -f1" 2>/dev/null)
    if [ -z "$remote_hash" ]; then
      # Пустой ответ — это НЕ расхождение: либо сервер недоступен, либо файла там нет.
      echo "  НЕТ ОТВЕТА  $f  (сервер недоступен или файла нет на VPS)"
      drift=1
    elif [ "$local_hash" = "$remote_hash" ]; then
      echo "  OK          $f"
    else
      echo "  РАЗЪЕХАЛСЯ  $f"
      drift=1
    fi
  done
  return $drift
}

echo "Сверяю локальные файлы с сервером..."
if check; then
  synced=1
else
  synced=0
fi

if [ "${1:-}" != "--push" ]; then
  echo
  if [ "$synced" = "1" ]; then
    echo "Всё совпадает, деплоить нечего."
  else
    echo "Есть расхождения. Если локальная версия верная — запусти: ./deploy.sh --push"
    echo "Если верная версия на СЕРВЕРЕ — сначала стяни её, иначе потеряешь изменения:"
    echo "  ssh -i $SSH_KEY $SSH_HOST \"cat $REMOTE_DIR/checker.js\" > checker.js"
  fi
  exit 0
fi

echo
echo "Проверяю синтаксис перед заливкой..."
for f in checker.js server.js; do
  if ! node -c "$f" 2>/dev/null; then
    echo "  ОШИБКА в $f — деплой отменён, на сервере ничего не тронуто"
    exit 1
  fi
  echo "  OK  $f"
done

echo
echo "Заливаю на сервер..."
for f in "${FILES[@]}"; do
  scp -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" "$f" "$SSH_HOST:$REMOTE_DIR/$f" >/dev/null || {
    echo "  ОШИБКА при копировании $f"
    exit 1
  }
  echo "  залит  $f"
done

echo
echo "Перезапускаю сервис (server.js)..."
ssh_run "systemctl restart worksly-checker && sleep 1 && systemctl is-active worksly-checker"

echo
echo "Проверяю результат..."
check
echo
echo "Готово. checker.js запустится сам по крону (раз в 2 часа)."
echo "Проверить его вручную прямо сейчас: ssh -i $SSH_KEY $SSH_HOST \"cd $REMOTE_DIR && node checker.js\""
