'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  api: (method, params = {}, force = false) => ipcRenderer.invoke('cf:call', { method, params, force }),
  statement: (contestId, index, force = false) => ipcRenderer.invoke('problem:statement', { contestId, index, force }),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authSave: (credentials) => ipcRenderer.invoke('auth:save', credentials),
  authClear: () => ipcRenderer.invoke('auth:clear'),
  window: (action) => ipcRenderer.send('window:control', action)
});
