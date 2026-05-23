const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store({ encryptionKey: 'printmaster-secure-2024', name: 'config' });
let mainWindow, loginWindow, splashWindow;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420, height: 380,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  splashWindow.loadFile('renderer/splash.html');
  splashWindow.once('ready-to-show', () => splashWindow.show());
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}
const openedFilePaths = new Map();

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 440, height: 560, resizable: false, frame: false, titleBarStyle: 'hidden',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
    icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#f8f7f4'
  });
  loginWindow.loadFile('renderer/login.html');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js'), webSecurity: true },
    icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#f8f7f4', show: false
  });
  mainWindow.loadFile('renderer/index.html');
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow.show();
    if (loginWindow) loginWindow.close();
  });
  Menu.setApplicationMenu(null);
}

ipcMain.handle('get-store', (_, key) => store.get(key));
ipcMain.handle('set-store', (_, key, value) => { store.set(key, value); return true; });
ipcMain.handle('get-all-store', () => store.store);
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('get-printers', async () => {
  try {
    // webContents.getPrintersAsync() returns installed system printers
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(p => ({
      name: p.name,
      isDefault: p.isDefault,
      status: p.status
    }));
  } catch (err) {
    return [];
  }
});

ipcMain.handle('open-pdf-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select PDF File(s)', filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled) return null;
  return result.filePaths.map(filePath => {
    const data = fs.readFileSync(filePath);
    const properBuffer = Buffer.from(data);
    const id = Date.now() + Math.random().toString(36).slice(2);
    openedFilePaths.set(id, filePath);
    return { buffer: Array.from(properBuffer), name: path.basename(filePath), size: data.length, fileId: id };
  });
});

ipcMain.handle('print-pdf', async (_, printData) => {
  try {
    const { pages, printerName, duplex, scale, landscape } = printData;

    const pageDivs = pages.map(pg => {
      const wIn = (pg.widthPt / 72).toFixed(4);
      const hIn = (pg.heightPt / 72).toFixed(4);
      const rot = pg.rotation || 0;
      const imgStyle = rot ? `width:100%;height:100%;display:block;transform:rotate(${rot}deg);transform-origin:center;` : `width:100%;height:100%;display:block;`;
      return `<div class="page" style="width:${wIn}in;height:${hIn}in;"><img src="${pg.dataUrl}" style="${imgStyle}"></div>`;
    }).join('\n');

    const scaleVal = scale || 100;
    const scaleCSS = scaleVal !== 100 ? `transform:scale(${scaleVal/100});transform-origin:top left;` : '';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      *{margin:0;padding:0;box-sizing:border-box;}body{background:white;}
      .page{display:block;overflow:hidden;page-break-after:always;page-break-inside:avoid;${scaleCSS}}
      .page:last-child{page-break-after:auto;}
      .page img{display:block;width:100%;height:100%;object-fit:fill;}
      @page{margin:0;}@media print{body{margin:0;}}
    </style></head><body>${pageDivs}</body></html>`;

    const printWin = new BrowserWindow({
      width: 900, height: 1100, show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise(r => setTimeout(r, 600));

    const firstPage = pages[0];
    const wMicrons = Math.round((firstPage.widthPt / 72) * 25400);
    const hMicrons = Math.round((firstPage.heightPt / 72) * 25400);

    // Build print options
    const printOptions = {
      silent: false,
      printBackground: true,
      color: true,
      pageSize: { width: wMicrons, height: hMicrons },
      margins: { marginType: 'none' },
      landscape: !!landscape
    };

    // Attach printer name if selected
    if (printerName && printerName !== '__default__') {
      printOptions.deviceName = printerName;
    }

    // Duplex settings
    if (duplex === 'long') printOptions.duplexMode = 'longEdge';
    else if (duplex === 'short') printOptions.duplexMode = 'shortEdge';
    else printOptions.duplexMode = 'simplex';

    return new Promise((resolve) => {
      printWin.webContents.print(printOptions, (success, reason) => {
        printWin.close();
        resolve(success ? { ok: true } : { ok: false, error: reason || 'Cancelled' });
      });
    });
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('verify-pin', (_, inputHash) => { const stored = store.get('pinHash',''); if (!stored) return true; return inputHash === stored; });
ipcMain.handle('has-pin', () => !!store.get('pinHash',''));
ipcMain.handle('launch-main', () => { createMainWindow(); });
ipcMain.handle('save-job', (_, job) => {
  const history = store.get('jobHistory', []);
  history.unshift({ ...job, id: Date.now(), date: new Date().toISOString() });
  if (history.length > 200) history.pop();
  store.set('jobHistory', history); return true;
});
ipcMain.handle('delete-job', (_, id) => { store.set('jobHistory', store.get('jobHistory',[]).filter(j=>j.id!==id)); return true; });
ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

app.whenReady().then(() => {
  createSplashWindow();
  // Show splash for 2.5 seconds then open the real app
  setTimeout(() => {
    closeSplash();
    if (!!store.get('pinHash','')) createLoginWindow();
    else createMainWindow();
  }, 2500);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
