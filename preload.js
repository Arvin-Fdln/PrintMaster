const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStore: (key) => ipcRenderer.invoke('get-store', key),
  setStore: (key, value) => ipcRenderer.invoke('set-store', key, value),
  getAllStore: () => ipcRenderer.invoke('get-all-store'),
  openPdfDialog: () => ipcRenderer.invoke('open-pdf-dialog'),
  saveQuotePdf: (html) => ipcRenderer.invoke('save-quote-pdf', html),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  hasPin: () => ipcRenderer.invoke('has-pin'),
  launchMain: () => ipcRenderer.invoke('launch-main'),
  saveJob: (job) => ipcRenderer.invoke('save-job', job),
  deleteJob: (id) => ipcRenderer.invoke('delete-job', id),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  on: (channel, cb) => {
    const allowed = ['show-about','open-settings','trigger-open','new-job','export-quote'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, ...args) => cb(...args));
  }
});
