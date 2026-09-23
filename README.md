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
- httpx.AsyncClient: долгий SSE-read (до 60s) не блокирует event loop; один клиент в lifespan, без сокета на каждый запрос.
- В апстрим уходят последние 30 сообщений: у free-моделей узкое окно контекста, длинная история даёт 400/413.
- Ошибки апстрима до старта SSE отдаём JSON (429/504/502). После старта стрима HTTP-статус уже 200 — только ERROR в лог и закрытие потока.
- Отмена апстрима: обрыв клиента даёт `CancelledError` или `request.is_disconnected()`; генератор логирует строку и в `finally` делает `aclose()` httpx-стрима — отдельную задачу не создаём.
- модель liquid/lfm-2.5-2.6b:free выбрана живой проверкой 200, потому что meta-llama/llama-3.2-3b-instruct:free отключён от free-варианта (404 апстрима).
- CORS разрешает оба origin (`http://localhost:5173` и `http://127.0.0.1:5173`), потому что пользователь может открыть либо; прокси не проверяет origin-строгость, только whitelist.

## ИИ-лог

- Qwen | дал плейсхолдер noreply-email (12345678+) в примере команды | владелец сверил с настройками GitHub до отправки | подставлен реальный 277530346+kartuznik@users.noreply.github.com.
- cursor move_agent_to_root | InstantiationService has been disposed, workspace не переключился на /root/saldo-ai-chat-test | ответ инструмента, повтор дал ту же ошибку | работу продолжили по абсолютным путям, третью попытку не делали
- Owner | сохранил server/.env не в ту папку и не заметил этого в проводнике Cursor | агент остановил приёмку: файла нет на диске, ls подтвердил | файл перемещён в server/, проверено ls -la и git status | вывод: файл существует только после сохранения в верный путь, верим командам, а не проводнику.
- fastapi | аннотация `StreamingResponse | JSONResponse` валит старт FastAPIError | traceback uvicorn при первом запуске | убрали return annotation у `/api/chat`
- Qwen | предложил модель meta-llama/llama-3.2-3b-instruct:free по примеру из документации OpenRouter | апстрим ответил 404: free-вариант недоступен | заменено на liquid/lfm-2.5-2.6b:free, проверено живым запросом 200 | вывод: free-каталог меняется, слаг модели проверяется живым запросом до фиксации в плане.

## Если бы был ещё один день

заполняется по ходу

## Лицензия

MIT. Copyright (c) 2026 Efim Chechulin. Полный текст — в файле [LICENSE](LICENSE).
