import { useEffect, useRef, useState } from "react";
import {
  approveApproval,
  createSession,
  denyApproval,
  getApproval,
  health,
  sendMessageStreaming,
  setToken,
} from "./api";

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      id: number;
      name: string;
      args?: string;
      result?: string;
      status: "running" | "done" | "error";
    }
  | {
      kind: "approval";
      approvalId: string;
      summary: string;
      decided?: "approved" | "denied";
    }
  | { kind: "notice"; text: string };

const QUICK_PROMPTS = [
  "帮我总结一下今天的待办",
  "明天下午三点建一个方案评审会，一小时",
  "把这周的工作整理成一份周报草稿",
];

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function pretty(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

let toolSeq = 0;

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void health().then(setOnline);
    const timer = setInterval(() => void health().then(setOnline), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const s = await createSession();
    setSessionId(s.id);
    return s.id;
  }

  function appendAssistantChunk(chunk: string) {
    setItems((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.kind === "assistant") {
        next[next.length - 1] = { ...last, text: last.text + chunk };
      } else {
        next.push({ kind: "assistant", text: chunk });
      }
      return next;
    });
  }

  async function send(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setItems((prev) => [...prev, { kind: "user", text }]);
    try {
      const id = await ensureSession();
      await sendMessageStreaming(id, text, (e) => {
        const d = asRecord(e.data);
        if (e.event === "message") {
          appendAssistantChunk(typeof e.data === "string" ? e.data : String(d.text ?? ""));
        } else if (e.event === "tool_call") {
          const name = String(d.name ?? d.tool ?? d.tool_name ?? "tool");
          const args = d.args ?? d.input ?? d.arguments;
          setItems((prev) => [
            ...prev,
            {
              kind: "tool",
              id: ++toolSeq,
              name,
              args: args !== undefined ? pretty(args) : undefined,
              status: "running",
            },
          ]);
        } else if (e.event === "tool_result") {
          const failed = Boolean(d.error) || d.ok === false;
          setItems((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const it = next[i];
              if (it.kind === "tool" && it.status === "running") {
                next[i] = {
                  ...it,
                  status: failed ? "error" : "done",
                  result: pretty(d.result ?? d.output ?? d.error ?? e.data),
                };
                break;
              }
            }
            return next;
          });
        } else if (e.event === "approval_needed") {
          const approvalId = String(d.id ?? d.approval_id ?? "");
          const fallbackSummary = pretty(d.summary ?? d.description ?? d.payload ?? e.data);
          setItems((prev) => [
            ...prev,
            { kind: "approval", approvalId, summary: fallbackSummary },
          ]);
          if (approvalId) {
            void getApproval(approvalId)
              .then((a) => {
                setItems((prev) =>
                  prev.map((it) =>
                    it.kind === "approval" && it.approvalId === approvalId
                      ? { ...it, summary: pretty(a.summary ?? a.description ?? a.payload ?? a) }
                      : it,
                  ),
                );
              })
              .catch(() => undefined);
          }
        } else if (e.event === "done") {
          const answer = typeof d.answer === "string" ? d.answer : "";
          if (answer) {
            setItems((prev) => {
              const hasAssistant = prev.some((it) => it.kind === "assistant" && it.text);
              return hasAssistant ? prev : [...prev, { kind: "assistant", text: answer }];
            });
          }
        }
      });
    } catch (err) {
      setItems((prev) => [...prev, { kind: "notice", text: `请求失败：${String(err)}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function decide(approvalId: string, ok: boolean) {
    try {
      if (ok) await approveApproval(approvalId);
      else await denyApproval(approvalId);
      setItems((prev) =>
        prev.map((it) =>
          it.kind === "approval" && it.approvalId === approvalId
            ? { ...it, decided: ok ? "approved" : "denied" }
            : it,
        ),
      );
    } catch (err) {
      setItems((prev) => [...prev, { kind: "notice", text: `审批提交失败：${String(err)}` }]);
    }
  }

  async function copyCmd() {
    try {
      await navigator.clipboard.writeText("hatch daemon run --api");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Hatch</div>
        <button
          className="status-pill"
          onClick={() => setShowSettings((s) => !s)}
          title="连接与设置"
        >
          <span className={`dot ${online ? "on" : "off"}`} />
          {online === null ? "检测中…" : online ? "已连接" : "未连接"}
        </button>
        {showSettings && (
          <div className="settings-pop">
            <div className="settings-title">连接设置</div>
            <div className="settings-row">
              <span>daemon 状态</span>
              <span className="num">{online ? "已连接" : "未连接"}</span>
            </div>
            <label className="settings-label">客户端 token（可选）</label>
            <div className="settings-token">
              <input
                type="password"
                placeholder="hatch daemon token create 生成"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
              <button
                onClick={() => {
                  setToken(tokenInput.trim());
                  setTokenInput("");
                  setShowSettings(false);
                }}
              >
                保存
              </button>
            </div>
            <div className="settings-hint">token 只存在本机浏览器存储里，不经过聊天。</div>
          </div>
        )}
      </header>
      {busy && <div className="thinking-bar" />}

      <main className="chat">
        {items.length === 0 && (
          <div className="empty">
            <h1>Hatch</h1>
            <p className="empty-sub">你的个人助手。先启动本地服务，再在这里发消息。</p>
            <div className="cmd-row">
              <code>hatch daemon run --api</code>
              <button className="copy-btn" onClick={() => void copyCmd()}>
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <div className="quick-row">
              {QUICK_PROMPTS.map((q) => (
                <button key={q} className="quick-card" onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {items.map((it, i) => {
          if (it.kind === "user") {
            return (
              <div key={i} className="row user">
                <div className="bubble-user">{it.text}</div>
              </div>
            );
          }
          if (it.kind === "assistant") {
            return (
              <div key={i} className="row">
                <div className="bubble-assistant">{it.text || "…"}</div>
              </div>
            );
          }
          if (it.kind === "tool") {
            return <ToolCapsule key={i} item={it} />;
          }
          if (it.kind === "approval") {
            return (
              <div key={i} className="approval-card">
                <div className="approval-head">✋ 需要你的批准</div>
                <div className="approval-note">批准后执行的将是下面这确切内容。</div>
                <pre className="approval-body">{it.summary}</pre>
                {it.decided ? (
                  <div className={`approval-decided ${it.decided}`}>
                    {it.decided === "approved" ? "✓ 已批准" : "已拒绝"}
                  </div>
                ) : (
                  <div className="approval-actions">
                    <button
                      className="btn-primary"
                      disabled={!it.approvalId}
                      onClick={() => void decide(it.approvalId, true)}
                    >
                      批准执行
                    </button>
                    <button
                      className="btn-danger"
                      disabled={!it.approvalId}
                      onClick={() => void decide(it.approvalId, false)}
                    >
                      拒绝
                    </button>
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={i} className="row">
              <div className="notice">{it.text}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </main>

      <footer className="composer">
        <div className={`composer-card ${busy ? "thinking" : ""}`}>
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
          <div className="composer-bar">
            <button className="chip" onClick={() => fileRef.current?.click()}>
              📎 附件
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => setAttachment(e.target.files?.[0]?.name ?? null)}
            />
            {attachment && <span className="attach-name">{attachment}</span>}
            {busy && <span className="thinking-label">Hatch 正在思考…</span>}
            <button
              className="send-round"
              disabled={busy || !input.trim()}
              onClick={() => void send()}
              title="发送"
            >
              ↑
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ToolCapsule({
  item,
}: {
  item: Extract<Item, { kind: "tool" }>;
}) {
  const [open, setOpen] = useState(false);
  const statusText =
    item.status === "running" ? "运行中" : item.status === "done" ? "✓ 完成" : "✗ 失败";
  return (
    <div className="row">
      <div className={`tool-capsule ${item.status}`}>
        <button className="tool-head" onClick={() => setOpen((o) => !o)}>
          <span className="tool-name">{item.name}</span>
          <span className="tool-status">{statusText}</span>
          <span className="tool-caret">{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <div className="tool-detail">
            {item.args && (
              <>
                <div className="tool-detail-title">参数</div>
                <pre>{item.args}</pre>
              </>
            )}
            {item.result && (
              <>
                <div className="tool-detail-title">结果</div>
                <pre>{item.result}</pre>
              </>
            )}
            {!item.args && !item.result && <div className="tool-detail-title">暂无详情</div>}
          </div>
        )}
      </div>
    </div>
  );
}
