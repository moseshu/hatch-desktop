import { useEffect, useRef, useState } from "react";
import { createSession, health, sendMessageStreaming, setToken } from "./api";

interface Msg {
  role: "user" | "assistant" | "system";
  text: string;
}

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void health().then(setOnline);
    const timer = setInterval(() => void health().then(setOnline), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const s = await createSession();
    setSessionId(s.id);
    return s.id;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
    try {
      const id = await ensureSession();
      await sendMessageStreaming(id, text, (e) => {
        if (e.event === "message") {
          const chunk =
            typeof e.data === "string"
              ? e.data
              : ((e.data as { text?: string })?.text ?? "");
          setMessages((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") last.text += chunk;
            return next;
          });
        } else if (e.event === "tool_call" || e.event === "tool_result") {
          setMessages((m) => [
            ...m.slice(0, -1),
            { role: "system", text: `${e.event}: ${JSON.stringify(e.data)}` },
            m[m.length - 1],
          ]);
        } else if (e.event === "approval_needed") {
          setMessages((m) => [
            ...m.slice(0, -1),
            { role: "system", text: "需要你的批准（审批面板待接入）" },
            m[m.length - 1],
          ]);
        } else if (e.event === "done") {
          const d = e.data as { answer?: string };
          if (d?.answer) {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last && last.role === "assistant" && !last.text) last.text = d.answer!;
              return next;
            });
          }
        }
      });
    } catch (err) {
      setMessages((m) => [
        ...m.slice(0, -1),
        { role: "system", text: `请求失败：${String(err)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Hatch</div>
        <div className={`status ${online ? "on" : "off"}`}>
          {online === null ? "检测中…" : online ? "daemon 已连接" : "daemon 未连接"}
        </div>
        <div className="token-box">
          <input
            type="password"
            placeholder="客户端 token（可选）"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button
            onClick={() => {
              setToken(tokenInput.trim());
              setTokenInput("");
            }}
          >
            保存
          </button>
        </div>
      </header>

      <main className="chat">
        {messages.length === 0 && (
          <div className="empty">
            <h1>Hatch</h1>
            <p>
              个人助手桌面端。先在终端运行 <code>hatch daemon run --api</code>，
              再在这里发消息。
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">{m.text || "…"}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <footer className="composer">
        <textarea
          value={input}
          placeholder="给 Hatch 发消息…（Enter 发送，Shift+Enter 换行）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
        />
        <button className="send" disabled={busy} onClick={() => void send()}>
          {busy ? "…" : "发送"}
        </button>
      </footer>
    </div>
  );
}
