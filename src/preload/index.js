/**
 * Yuhox Board · 预加载桥
 * 控制端与大屏端共用；只暴露白名单方法，不开 nodeIntegration。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yuhox', {
  // 状态
  getStatus: () => ipcRenderer.invoke('status:get'),
  getBoard: () => ipcRenderer.invoke('board:get'),
  setBoard: (patch) => ipcRenderer.invoke('board:set', patch),

  // 显示器与上屏
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  identifyDisplays: () => ipcRenderer.invoke('displays:identify'),
  startOutput: (displayId) => ipcRenderer.invoke('output:start', displayId),
  stopOutput: () => ipcRenderer.invoke('output:stop'),
  setBlacked: (v) => ipcRenderer.invoke('output:black', v),

  // 实时数据源
  serverStart: (port) => ipcRenderer.invoke('server:start', port),
  serverStop: () => ipcRenderer.invoke('server:stop'),
  fileWatch: (file) => ipcRenderer.invoke('file:watch', file),
  pickFile: () => ipcRenderer.invoke('file:pick'),
  exportBoard: () => ipcRenderer.invoke('file:export'),

  // 开机自启 / 托盘
  getAutoLaunch: () => ipcRenderer.invoke('autolaunch:get'),
  setAutoLaunch: (v) => ipcRenderer.invoke('autolaunch:set', v),
  setPrefs: (p) => ipcRenderer.invoke('prefs:set', p),

  // 数据文件
  openDataDir: () => ipcRenderer.invoke('data:open'),
  resetBoard: (kind) => ipcRenderer.invoke('data:reset', kind),
  importBoard: () => ipcRenderer.invoke('data:import'),
  openUrl: (url) => ipcRenderer.invoke('app:openUrl', url),

  // 输入历史（自动补全）
  addDict: (key, value) => ipcRenderer.invoke('dict:add', { key, value }),
  mergeDict: (key, values) => ipcRenderer.invoke('dict:merge', { key, values }),

  // Excel
  exportExcel: () => ipcRenderer.invoke('excel:export'),
  importExcel: () => ipcRenderer.invoke('excel:import'),

  // 主进程广播
  onBoardUpdated: (cb) => ipcRenderer.on('board:updated', (_e, b) => cb(b)),
  onStatusUpdated: (cb) => ipcRenderer.on('status:updated', (_e, s) => cb(s)),
  onOutputCmd: (cb) => ipcRenderer.on('output:cmd', (_e, c) => cb(c))
});
