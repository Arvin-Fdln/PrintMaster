const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store({
  encryptionKey: 'printmaster-secure-2024',
  name: 'config'
});

let mainWindow;
let loginWindow;

const schema = {
  businessName: { type: 'string', default: 'My Print Shop' },
  address: { type: 'string', default: '' },
  contact: { type: 'string', default: '' },
  pinHash: { type: 'string', default: '' },
  theme: { type: 'string', default: 'system' },
  currency: { type: 'string', default: '₱' },
  pricing: {
    type: 'object',
    default: {
      bw: { letter: 3, legal: 4, a3: 6, a4: 3 },
      color: { letter: 15, legal: 20, a3: 30, a4: 15 },
      defaultSize: 'letter',
      copiesDefault: 1
    }
  },
  jobHistory: { type: 'array', default: [] },
  taxRate: { type: 'number', default: 0 },
  showTax: { type: 'boolean', default: false }
};

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 440,
    height: 560,
    resizable: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#f8f7f4'
  });
  loginWindow.loadFile('renderer/login.html');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#f8f7f4',
    show: false
  });

  mainWindow.loadFile('renderer/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (loginWindow) loginWindow.close();
  });

  const menuTemplate = [
    {
      label: 'PrintMaster',
      submenu: [
        { label: 'About PrintMaster', click: () => mainWindow.webContents.send('show-about') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => mainWindow.webContents.send('open-settings') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'Open PDF...', accelerator: 'CmdOrCtrl+O', click: () => mainWindow.webContents.send('trigger-open') },
        { label: 'New Job', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('new-job') },
        { type: 'separator' },
        { label: 'Export Quote as PDF', accelerator: 'CmdOrCtrl+E', click: () => mainWindow.webContents.send('export-quote') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers
ipcMain.handle('get-store', (_, key) => store.get(key));
ipcMain.handle('set-store', (_, key, value) => { store.set(key, value); return true; });
ipcMain.handle('get-all-store', () => store.store);

ipcMain.handle('open-pdf-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select PDF File(s)',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled) return null;
  return result.filePaths.map(filePath => {
    const data = fs.readFileSync(filePath);
    return { buffer: data.buffer, name: path.basename(filePath), size: data.length };
  });
});

ipcMain.handle('save-quote-pdf', async (_, htmlContent) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Quote',
    defaultPath: `quote-${Date.now()}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled) return false;
  mainWindow.webContents.printToPDF({ printBackground: true }).then(data => {
    fs.writeFileSync(result.filePath, data);
  });
  return true;
});

ipcMain.handle('verify-pin', (_, inputHash) => {
  const storedHash = store.get('pinHash', '');
  if (!storedHash) return true;
  return inputHash === storedHash;
});

ipcMain.handle('has-pin', () => !!store.get('pinHash', ''));

ipcMain.handle('launch-main', () => {
  createMainWindow();
});

ipcMain.handle('print-pdf', async (_, bufferData, fileName) => {
  try {
    const os = require('os');
    // bufferData may come as ArrayBuffer or plain object — convert safely
    const buffer = Buffer.from(bufferData instanceof Buffer ? bufferData : new Uint8Array(bufferData));

    if (!buffer || buffer.length === 0) {
      return { ok: false, error: 'Empty buffer received — PDF data was not transferred correctly.' };
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tmpPath = path.join(os.tmpdir(), `printmaster_${Date.now()}_${safeName}`);
    fs.writeFileSync(tmpPath, buffer);

    // Verify file was written
    const stat = fs.statSync(tmpPath);
    if (stat.size === 0) {
      return { ok: false, error: 'Failed to write temp file.' };
    }

    // shell.openPath is the most reliable cross-platform method.
    // It opens the PDF in the default viewer (Edge/Adobe/Foxit on Windows).
    // User then uses Ctrl+P in that viewer for full print control.
    const result = await shell.openPath(tmpPath);
    if (result) {
      // result is non-empty string = error message from OS
      return { ok: false, error: result };
    }

    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch(e) {} }, 60000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('save-job', (_, job) => {  const history = store.get('jobHistory', []);
  history.unshift({ ...job, id: Date.now(), date: new Date().toISOString() });
  if (history.length > 200) history.pop();
  store.set('jobHistory', history);
  return true;
});

ipcMain.handle('delete-job', (_, id) => {
  const history = store.get('jobHistory', []);
  store.set('jobHistory', history.filter(j => j.id !== id));
  return true;
});

ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

app.whenReady().then(() => {
  const hasPin = !!store.get('pinHash', '');
  if (hasPin) {
    createLoginWindow();
  } else {
    createMainWindow();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
