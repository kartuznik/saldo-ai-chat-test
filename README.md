# saldo-ai-chat-test

## Запуск (5 минут)

Сервер (каталог `server/`):

```bash
cp .env.example .env
# заполнить OPENROUTER_API_KEY и MODEL; файл не коммитится

.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

Проверка:

```bash
curl -s http://127.0.0.1:8000/api/health
curl -N http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi in one word"}]}'
```

Клиент — задача 2.

## Ключевые решения

- Скелет закоммичен в `main` как bootstrap пустого репозитория; весь дальнейший код — в `feat/chat`, в `main` только через PR.
- FastAPI: ASGI, CORS и `StreamingResponse` из коробки, без отдельного SSE-сервера и без синхронного WSGI.

## ИИ-лог

- Qwen | дал плейсхолдер noreply-email (12345678+) в примере команды | владелец сверил с настройками GitHub до отправки | подставлен реальный 277530346+kartuznik@users.noreply.github.com.
- cursor move_agent_to_root | InstantiationService has been disposed, workspace не переключился на /root/saldo-ai-chat-test | ответ инструмента, повтор дал ту же ошибку | работу продолжили по абсолютным путям, третью попытку не делали
- Owner | сохранил server/.env не в ту папку и не заметил этого в проводнике Cursor | агент остановил приёмку: файла нет на диске, ls подтвердил | файл перемещён в server/, проверено ls -la и git status | вывод: файл существует только после сохранения в верный путь, верим командам, а не проводнику.

## Если бы был ещё один день

заполняется по ходу

## Лицензия

MIT. Copyright (c) 2026 Efim Chechulin. Полный текст — в файле [LICENSE](LICENSE).
