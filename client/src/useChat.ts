import { useCallback, useEffect, useRef, useState } from "react";

export type ChatRole = "user" | "assistant";
export type ChatStatus = "idle" | "streaming" | "error";
export type ChatErrorKind =
  | "rate_limit"
  | "upstream_timeout"
  | "upstream_error"
  | "network"
  | "interrupted";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  stopped?: boolean;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";
const STORAGE_KEY = "saldo.chat.messages";

function newId(): string {
  return crypto.randomUUID();
}

function parseContentDelta(data: string): string {
  const parsed = JSON.parse(data) as {
    choices?: { delta?: { content?: string } }[];
  };
  return parsed.choices?.[0]?.delta?.content ?? "";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const messages: ChatMessage[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        "id" in item &&
        "role" in item &&
        "content" in item &&
        typeof item.id === "string" &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string"
      ) {
        messages.push({
          id: item.id,
          role: item.role,
          content: item.content,
          stopped: "stopped" in item && item.stopped === true,
        });
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function kindFromHttp(status: number, errorCode: string | undefined): ChatErrorKind {
  if (status === 429 || errorCode === "rate_limit") {
    return "rate_limit";
  }
  if (status === 504 || errorCode === "upstream_timeout") {
    return "upstream_timeout";
  }
  return "upstream_error";
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [errorKind, setErrorKind] = useState<ChatErrorKind | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  const complete = useCallback(async (history: ChatMessage[]) => {
    if (abortRef.current) {
      return;
    }
    setStatus("streaming");
    setErrorKind(null);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantOpened = false;

    const payload = history
      .filter((message) => message.content.length > 0)
      .map((message) => ({ role: message.role, content: message.content }));

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorCode: string | undefined;
        try {
          const body = (await response.json()) as { error?: string };
          errorCode = body.error;
        } catch {
          errorCode = undefined;
        }
        setErrorKind(kindFromHttp(response.status, errorCode));
        setStatus("error");
        return;
      }

      if (!response.body) {
        setErrorKind("upstream_error");
        setStatus("error");
        return;
      }

      const assistantMsg: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: "",
      };
      setMessages([...history, assistantMsg]);
      assistantOpened = true;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      const appendDelta = (piece: string) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + piece };
          }
          return next;
        });
      };

      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line || line.startsWith(":")) {
            continue;
          }
          if (!line.startsWith("data:")) {
            continue;
          }
          const data = line.slice("data:".length).trimStart();
          if (data === "[DONE]") {
            sawDone = true;
            break;
          }
          try {
            const piece = parseContentDelta(data);
            if (piece) {
              appendDelta(piece);
            }
          } catch {
            // Non-JSON data line; skip.
          }
        }
      }

      if (sawDone) {
        setStatus("idle");
      } else {
        setErrorKind("interrupted");
        setStatus("error");
      }
    } catch (error) {
      if (isAbortError(error)) {
        if (assistantOpened) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, stopped: true };
            }
            return next;
          });
        }
        setErrorKind(null);
        setStatus("idle");
        return;
      }
      setErrorKind("network");
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || abortRef.current) {
        return;
      }
      const userMsg: ChatMessage = { id: newId(), role: "user", content: trimmed };
      const history = [...messagesRef.current, userMsg];
      setMessages(history);
      await complete(history);
    },
    [complete],
  );

  const retry = useCallback(async () => {
    if (abortRef.current) {
      return;
    }
    const lastUser = [...messagesRef.current]
      .reverse()
      .find((message) => message.role === "user");
    if (!lastUser) {
      return;
    }
    await complete(messagesRef.current);
  }, [complete]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearHistory = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setErrorKind(null);
    setStatus("idle");
  }, []);

  return { messages, status, errorKind, send, stop, retry, clearHistory };
}
