/**
 * Client for the hatch product API (hatch daemon run --api).
 * Default base: http://127.0.0.1:8787. Auth: Authorization: Bearer <token>
 * (create one with `hatch daemon token create <name> [--scope read|write]`).
 * GET /v1/health is unauthenticated.
 */

declare global {
  interface Window {
    hatch?: {
      apiBase: () => Promise<string>;
      platform: string;
    };
  }
}

const FALLBACK_BASE = "http://127.0.0.1:8787";

export async function apiBase(): Promise<string> {
  if (window.hatch?.apiBase) return window.hatch.apiBase();
  return FALLBACK_BASE;
}

function token(): string | null {
  return localStorage.getItem("hatch_token");
}

export function setToken(t: string) {
  localStorage.setItem("hatch_token", t);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = await apiBase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function health(): Promise<boolean> {
  try {
    const base = await apiBase();
    const res = await fetch(`${base}/v1/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface Session {
  id: string;
}

export async function createSession(): Promise<Session> {
  return request<Session>("/v1/sessions", { method: "POST", body: "{}" });
}

export interface TurnEvent {
  event: string;
  data: unknown;
}

/** Send a message and stream the turn over SSE (message / tool_call / tool_result / approval_needed / done). */
export async function sendMessageStreaming(
  sessionId: string,
  text: string,
  onEvent: (e: TurnEvent) => void,
): Promise<void> {
  const base = await apiBase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${base}/v1/sessions/${sessionId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const block of blocks) {
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        onEvent({ event, data: JSON.parse(data) });
      } catch {
        onEvent({ event, data });
      }
    }
  }
}
