import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hatch", {
  apiBase: (): Promise<string> => ipcRenderer.invoke("hatch:api-base"),
  platform: process.platform,
});
