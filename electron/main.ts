import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";

const API_BASE = process.env.HATCH_API_BASE ?? "http://127.0.0.1:8787";
const isDev = !app.isPackaged;

let daemon: ChildProcess | null = null;

/**
 * Optionally supervise a local hatch daemon. Set HATCH_BIN to the hatch
 * binary path to have the app start `hatch daemon run --api` on launch.
 * Without it, the app simply talks to an already-running daemon.
 */
function startDaemon() {
  const bin = process.env.HATCH_BIN;
  if (!bin) return;
  daemon = spawn(bin, ["daemon", "run", "--api"], {
    stdio: "inherit",
    env: { ...process.env },
  });
  daemon.on("exit", (code) => {
    console.log(`[hatch-desktop] daemon exited with code ${code}`);
    daemon = null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#0b0e14",
    title: "Hatch",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    void win.loadURL("http://localhost:5173");
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("hatch:api-base", () => API_BASE);

app.whenReady().then(() => {
  startDaemon();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (daemon) daemon.kill();
  if (process.platform !== "darwin") app.quit();
});
