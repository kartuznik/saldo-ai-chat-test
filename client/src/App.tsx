import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useChat } from "./useChat.ts";

const EXAMPLES = [
  "Объясни простыми словами, что такое SSE",
  "Напиши короткий чек-лист код-ревью",
  "Переведи на английский: история чата хранится локально",
];

export default function App() {
  const { messages, status, send, stop } = useChat();
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

  const last = messages[messages.length - 1];
  const typing = status === "streaming" && last?.role === "assistant" && last.content === "";

  return (
    <main>
      <header>
        <h1>Сальдо</h1>
      </header>

      <div ref={logRef} role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div>
            <p>Привет. Напиши вопрос или выбери пример.</p>
            <ul>
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button type="button" onClick={() => setDraft(example)}>
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((message) => (
            <article key={message.id} data-role={message.role}>
              <p>{message.content}</p>
              {message.stopped ? <p>остановлено</p> : null}
            </article>
          ))
        )}
        {typing ? <p>модель печатает</p> : null}
      </div>

      <form onSubmit={onSubmit}>
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
          <button type="button" onClick={stop}>
            Стоп
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim()}>
            Отправить
          </button>
        )}
      </form>
    </main>
  );
}
