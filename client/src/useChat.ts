import { useCallback, useRef, useState } from "react";

export type ChatRole = "user" | "assistant";
export type ChatStatus = "idle" | "streaming" | "error";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

function newId(): string {
  return crypto.randomUUID();
}

function parseContentDelta(data: string): string {
  const parsed = JSON.parse(data) as {
    choices?: { delta?: { content?: string } }[];
  };
  return parsed.choices?.[0]?.delta?.content ?? "";
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || abortRef.current) {
      return;
    }

    const userMsg: ChatMessage = { id: newId(), role: "user", content: trimmed };
    const assistantMsg: ChatMessage = {
      id: newId(),
      role: "assistant",
      content: "",
    };
    const history = [...messagesRef.current, userMsg];
    setMessages([...history, assistantMsg]);
    setStatus("streaming");

    const controller = new AbortController();
    abortRef.current = controller;

    const payload = history.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: payload }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      abortRef.current = null;
      setStatus("idle");
      return;
    }

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

    abortRef.current = null;
    setStatus("idle");
  }, []);

  return { messages, status, send };
}
