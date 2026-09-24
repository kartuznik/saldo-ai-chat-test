import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { KuzmaMark, OwnerSilhouette } from "./avatars.tsx";
import { useChat, type ChatErrorKind } from "./useChat.ts";

function assistantHtml(content: string): string {
  const raw = marked.parse(content, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw);
}

const ERROR_TEXT: Record<ChatErrorKind, string> = {
  rate_limit: "лимит запросов, подождите и повторите",
  upstream_timeout: "таймаут модели",
  upstream_error: "ошибка модели",
  network: "сеть оборвалась",
  interrupted: "генерация прервана",
};

const EXAMPLES = [
  "Объясни простыми словами, что такое SSE",
  "Напиши короткий чек-лист код-ревью",
  "Переведи на английский: история чата хранится локально",
];

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";
const NEAR_BOTTOM_PX = 40;

function formatTime(createdAt: number): string {
  const date = new Date(createdAt);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

export default function App() {
  const { messages, status, errorKind, waitingForToken, send, stop, retry, clearHistory } = useChat();
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/health`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (cancelled || !body || typeof body !== "object" || !("model" in body)) {
          return;
        }
        const name = body.model;
        if (typeof name === "string" && name.trim()) {
          setModel(name.trim());
        }
      })
      .catch(() => {
        /* header stays without the model tag */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function followLog() {
    stickToBottomRef.current = true;
    setShowJump(false);
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }

  function onLogScroll() {
    const el = logRef.current;
    if (!el) {
      return;
    }
    const near = isNearBottom(el);
    stickToBottomRef.current = near;
    setShowJump(!near && status === "streaming");
  }

  useEffect(() => {
    if (!stickToBottomRef.current) {
      return;
    }
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, status, waitingForToken]);

  useEffect(() => {
    function onDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && status === "streaming") {
        stop();
      }
    }
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [status, stop]);

  function submitDraft() {
    const text = draft.trim();
    if (!text || status === "streaming") {
      return;
    }
    setDraft("");
    stickToBottomRef.current = true;
    setShowJump(false);
    void send(text);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitDraft();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  }

  function onRetry() {
    stickToBottomRef.current = true;
    setShowJump(false);
    void retry();
  }

  return (
    <main className="shell">
      <header className="channel">
        <div className="channel-id">
          <span className="avatar-slot">
            <KuzmaMark className="avatar" />
          </span>
          <div className="channel-copy">
            <h1>Кузьма</h1>
            <p className="online">
              <span className="online-dot" />
              онлайн
            </p>
          </div>
        </div>
        {model ? (
          <p className="model-tag" title={model}>
            {model}
          </p>
        ) : null}
        {messages.length > 0 ? (
          <button type="button" className="btn" onClick={clearHistory}>
            Очистить историю
          </button>
        ) : null}
      </header>

      <div className="log-wrap">
        <div ref={logRef} className="log" role="log" aria-live="polite" onScroll={onLogScroll}>
        {messages.length === 0 ? (
          <div className="empty">
            <section className="empty-card">
              <p className="empty-title">Привет</p>
              <p>Напиши вопрос или выбери пример.</p>
            </section>
            <ul className="chips">
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button type="button" className="chip-card" onClick={() => setDraft(example)}>
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((message) => (
              <article key={message.id} className="msg" data-role={message.role}>
                {message.role === "assistant" ? (
                  <KuzmaMark className="avatar" />
                ) : (
                  <OwnerSilhouette className="avatar" />
                )}
                <div className="bubble">
                  {message.role === "assistant" ? (
                    <div
                      className="bubble-body markdown"
                      dangerouslySetInnerHTML={{ __html: assistantHtml(message.content) }}
                    />
                  ) : (
                    <p className="bubble-body">{message.content}</p>
                  )}
                  {message.stopped ? <p className="stopped">остановлено</p> : null}
                  {typeof message.createdAt === "number" ? (
                    <time className="stamp" dateTime={new Date(message.createdAt).toISOString()}>
                      {formatTime(message.createdAt)}
                    </time>
                  ) : null}
                </div>
              </article>
          ))
        )}
        {waitingForToken ? (
          <div className="typing-row">
            <KuzmaMark className="avatar" />
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="visually-hidden">модель печатает</span>
          </div>
        ) : null}
        {status === "error" && errorKind ? (
          <div className="state-card state-card-error" role="alert">
            <svg className="state-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M12 3.2 22 20.8H2L12 3.2Zm0 5.3c-.4 0-.7.3-.7.8l.4 5.2h.6l.4-5.2c0-.5-.3-.8-.7-.8Zm0 8.3a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z"
              />
            </svg>
            <div className="state-copy">
              <p className="state-title">Ошибка</p>
              <p>{ERROR_TEXT[errorKind]}</p>
            </div>
            <button type="button" className="btn btn-accent" onClick={onRetry}>
              Повторить
            </button>
          </div>
        ) : null}
        {status !== "streaming" &&
        status !== "error" &&
        messages[messages.length - 1]?.stopped ? (
          <div className="state-card state-card-stop">
            <svg className="state-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M8.2 3.2h7.6L20.8 8.2v7.6l-5 5H8.2l-5-5V8.2l5-5ZM9 9v6h6V9H9Z"
              />
            </svg>
            <div className="state-copy">
              <p className="state-title">Генерация остановлена</p>
              <p>Часть ответа сохранена в истории</p>
            </div>
            <button type="button" className="btn" onClick={onRetry}>
              Продолжить
            </button>
          </div>
        ) : null}
        </div>
        {showJump ? (
          <button type="button" className="jump-btn" onClick={followLog}>
            ↓ к новому
          </button>
        ) : null}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor="chat-input" className="visually-hidden">
          Сообщение
        </label>
        <textarea
          id="chat-input"
          name="message"
          rows={2}
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {status === "streaming" ? (
          <button type="button" className="btn btn-warn" onClick={stop}>
            Стоп
          </button>
        ) : (
          <button type="submit" className="send-btn" aria-label="Отправить" disabled={!draft.trim()}>
            <svg className="send-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M3.05 11.25 20.7 3.2c.72-.33 1.45.4 1.12 1.12L13.75 20.95c-.3.64-1.22.58-1.42-.1l-1.7-5.95-5.95-1.7c-.68-.2-.74-1.12-.1-1.42Z"
              />
            </svg>
            <span className="send-label">Отправить</span>
          </button>
        )}
      </form>
    </main>
  );
}
