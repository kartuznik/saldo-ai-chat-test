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
  const [waitingForToken, setWaitingForToken] = useState(false);
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
    setWaitingForToken(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const payload = history
      .filter((message) => message.content.length > 0)
      .map((message) => ({ role: message.role, content: message.content }));
    const assistantOpened = { current: false };

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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      const appendDelta = (piece: string) => {
        setWaitingForToken(false);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (assistantOpened.current && last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + piece };
            return next;
          }
          assistantOpened.current = true;
          next.push({ id: newId(), role: "assistant", content: piece });
          return next;
        });
      };

      const consumeLine = (raw: string): boolean => {
        const line = raw.trim();
        if (!line || line.startsWith(":")) {
          return false;
        }
        if (!line.startsWith("data:")) {
          return false;
        }
        const data = line.slice("data:".length).trimStart();
        if (data === "[DONE]") {
          return true;
        }
        try {
          const piece = parseContentDelta(data);
          if (piece) {
            appendDelta(piece);
          }
        } catch {
          // Non-JSON data line; skip.
        }
        return false;
      };

      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer && consumeLine(buffer)) {
            sawDone = true;
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (consumeLine(raw)) {
            sawDone = true;
            break;
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
        if (assistantOpened.current) {
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
      setWaitingForToken(false);
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
    const current = messagesRef.current;
    const lastUserIdx = current.findLastIndex((message) => message.role === "user");
    if (lastUserIdx < 0) {
      return;
    }
    await complete(current.slice(0, lastUserIdx + 1));
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

  return { messages, status, errorKind, waitingForToken, send, stop, retry, clearHistory };
}
