# Hatch Desktop

Hatch 的 PC 桌面客户端（Electron + React + TypeScript），与 [hatch-refrence](https://github.com/moseshu/hatch-refrence) 的 agent 后端对接，整合成一个产品。

## 架构

```
┌──────────────────────────── Hatch Desktop (Electron) ────────────────────────────┐
│  React UI (src/)          Electron 主进程 (electron/)                            │
│  聊天 / 任务 / 审批面板  ──▶ 窗口、托盘、快捷键、daemon 进程监督                │
└──────────────┬───────────────────────────────────────────────────────────────────┘
               │ HTTP/1.1 + SSE (Authorization: Bearer <token>)
               ▼
┌──────────────────────────── hatch daemon (Rust) ─────────────────────────────────┐
│  产品 API /v1/...（默认 127.0.0.1:8787）：会话、任务、审批、记忆、产物、目标…  │
│  agent 核心：规划、工具、门禁、跨步骤验收、记忆                                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

壳与核分离：桌面端只做界面和系统集成，agent 能力全在 daemon 侧，两边只通过产品 API 通信。前端代码与网页版共用。

## 快速开始

先启动后端（在 hatch-refrence 仓库构建后）：

```bash
hatch daemon run --api            # 默认 http://127.0.0.1:8787
hatch daemon token create desktop --scope write   # 可选：生成客户端 token
```

再启动桌面端：

```bash
npm install
npm run dev        # 只起前端（浏览器里调 UI，API 地址默认 127.0.0.1:8787）
npm start          # 构建并以 Electron 窗口打开
```

环境变量：

| 变量 | 说明 |
|---|---|
| `HATCH_API_BASE` | daemon API 地址，默认 `http://127.0.0.1:8787` |
| `HATCH_BIN` | hatch 二进制路径；设置后 App 启动时自动拉起 `hatch daemon run --api` 并监督进程 |

## 打包

```bash
npm run dist       # electron-builder 输出到 release/（Win: NSIS，Mac: DMG，Linux: AppImage）
```

## 对接的 API

端点总览见 hatch-refrence 的 README「对外接口」一节。本仓库 `src/api.ts` 已封装：健康检查、建会话、SSE 流式对话（`message` / `tool_call` / `tool_result` / `approval_needed` / `done` 事件）。任务、审批、记忆、产物等面板按同一套 API 逐步接入。

## License

MIT
