import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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

const NEAR_BOTTOM_PX = 40;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

export default function App() {
  const { messages, status, errorKind, waitingForToken, send, stop, retry, clearHistory } = useChat();
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

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
  }, [messages, status]);

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

  return (
    <main className="shell">
      <header className="top">
        <h1>Сальдо</h1>
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
            <p>Привет. Напиши вопрос или выбери пример.</p>
            <ul className="chips">
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    className="btn chip"
                    onClick={() => setDraft(example)}
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((message) => (
              <article key={message.id} className="bubble" data-role={message.role}>
                {message.role === "assistant" ? (
                  <div
                    className="bubble-body markdown"
                    dangerouslySetInnerHTML={{ __html: assistantHtml(message.content) }}
                  />
                ) : (
                  <p className="bubble-body">{message.content}</p>
                )}
                {message.stopped ? <p className="stopped">остановлено</p> : null}
              </article>
          ))
        )}
        {status === "error" && errorKind ? (
          <div className="alert" role="alert">
            <p>{ERROR_TEXT[errorKind]}</p>
            <button type="button" className="btn btn-accent" onClick={() => {
              stickToBottomRef.current = true;
              setShowJump(false);
              void retry();
            }}>
              Повторить
            </button>
          </div>
        ) : null}
        </div>
        {waitingForToken ? (
          <p className="typing-pill">модель печатает</p>
        ) : null}
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
          <button type="submit" className="btn btn-accent" disabled={!draft.trim()}>
            Отправить
          </button>
        )}
      </form>
    </main>
  );
}
