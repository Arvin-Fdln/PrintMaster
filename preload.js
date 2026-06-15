const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStore: (key) => ipcRenderer.invoke('get-store', key),
  setStore: (key, value) => ipcRenderer.invoke('set-store', key, value),
  getAllStore: () => ipcRenderer.invoke('get-all-store'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  openPdfDialog: () => ipcRenderer.invoke('open-pdf-dialog'),
  printPdf: (printData) => ipcRenderer.invoke('print-pdf', printData),
  verifyPin: (pin) => ipcRenderer.invoke('verify-pin', pin),
  hasPin: () => ipcRenderer.invoke('has-pin'),
  setPin: (pin) => ipcRenderer.invoke('set-pin', pin),
  clearPin: () => ipcRenderer.invoke('clear-pin'),
  launchMain: () => ipcRenderer.invoke('launch-main'),
  saveJob: (job) => ipcRenderer.invoke('save-job', job),
  deleteJob: (id) => ipcRenderer.invoke('delete-job', id),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  on: (channel, cb) => {
    const allowed = ['show-about', 'open-settings', 'trigger-open', 'new-job', 'export-quote'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, ...args) => cb(...args));
  }
});
