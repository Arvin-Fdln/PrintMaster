const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const argon2 = require('argon2');

const store = new Store({ encryptionKey: 'printmaster-secure-2024', name: 'config' });
let mainWindow, loginWindow, splashWindow;

// ===== UTILITIES =====
function validateNumber(val, min = 0, max = 999) {
  const num = parseFloat(val);
  if (isNaN(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function sanitizePath(filePath) {
  // Prevent directory traversal attacks
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) throw new Error('Invalid file path');
  return normalized;
}

// ===== SPLASH WINDOW =====
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

// ===== FILE TRACKING =====
const openedFilePaths = new Map();
const FILE_BUFFER_LIMIT = 5; // Prevent memory bloat

// ===== LOGIN WINDOW =====
function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 440, height: 560, resizable: false, frame: false, titleBarStyle: 'hidden',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
    icon: process.platform === 'win32' ? path.join(__dirname, 'assets', 'icon.ico') : path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#f8f7f4'
  });
  loginWindow.loadFile('renderer/login.html');
}

// ===== MAIN WINDOW =====
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js'), webSecurity: true },
    icon: process.platform === 'win32' ? path.join(__dirname, 'assets', 'icon.ico') : path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#f8f7f4', show: false
  });
  mainWindow.loadFile('renderer/index.html');
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow.show();
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  });
  Menu.setApplicationMenu(null);
}

// ===== IPC HANDLERS =====
ipcMain.handle('get-store', (_, key) => store.get(key));
ipcMain.handle('set-store', (_, key, value) => { store.set(key, value); return true; });
ipcMain.handle('get-all-store', () => store.store);
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('get-printers', async () => {
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(p => ({
      name: String(p.name || '').slice(0, 256),
      isDefault: !!p.isDefault,
      status: p.status || 0
    }));
  } catch (err) {
    console.error('Printer list error:', err);
    return [];
  }
});

ipcMain.handle('open-pdf-dialog', async () => {
  if (!mainWindow) return null;
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select PDF File(s)',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return null;
    
    // Limit concurrent file loads
    const filesToProcess = result.filePaths.slice(0, 10);
    return filesToProcess.map(filePath => {
      try {
        sanitizePath(filePath);
        const data = fs.readFileSync(filePath);
        const properBuffer = Buffer.from(data);
        const id = Date.now() + Math.random().toString(36).slice(2);
        openedFilePaths.set(id, filePath);
        return {
          buffer: Array.from(properBuffer),
          name: path.basename(filePath).slice(0, 256),
          size: data.length,
          fileId: id
        };
      } catch (err) {
        console.error('File read error:', err);
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    console.error('Dialog error:', err);
    return null;
  }
});

ipcMain.handle('print-pdf', async (_, printData) => {
  try {
    if (!mainWindow) return { ok: false, error: 'Window unavailable' };
    
    const { pages, printerName, duplex, scale, landscape } = printData;
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return { ok: false, error: 'No pages to print' };
    }

    const scaleVal = validateNumber(scale, 50, 150);
    const landscapeVal = !!landscape;
    const duplexVal = ['long', 'short', 'none'].includes(duplex) ? duplex : 'none';

    const pageDivs = pages.map(pg => {
      if (!pg.dataUrl || !pg.widthPt || !pg.heightPt) return '';
      const wIn = (pg.widthPt / 72).toFixed(4);
      const hIn = (pg.heightPt / 72).toFixed(4);
      const rot = pg.rotation || 0;
      const imgStyle = rot ? `width:100%;height:100%;display:block;transform:rotate(${rot}deg);transform-origin:center;` : `width:100%;height:100%;display:block;`;
      return `<div class="page" style="width:${wIn}in;height:${hIn}in;"><img src="${pg.dataUrl}" style="${imgStyle}"></div>`;
    }).join('\n');

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

    const printOptions = {
      silent: false,
      printBackground: true,
      color: true,
      pageSize: { width: wMicrons, height: hMicrons },
      margins: { marginType: 'none' },
      landscape: landscapeVal
    };

    if (printerName && printerName !== '__default__' && typeof printerName === 'string') {
      printOptions.deviceName = printerName.slice(0, 256);
    }

    if (duplexVal === 'long') printOptions.duplexMode = 'longEdge';
    else if (duplexVal === 'short') printOptions.duplexMode = 'shortEdge';
    else printOptions.duplexMode = 'simplex';

    return new Promise((resolve) => {
      const onClosed = () => {
        printWin.removeListener('closed', onClosed);
        resolve({ ok: false, error: 'Print window closed' });
      };
      printWin.on('closed', onClosed);
      
      printWin.webContents.print(printOptions, (success, reason) => {
        printWin.removeListener('closed', onClosed);
        setTimeout(() => {
          if (printWin && !printWin.isDestroyed()) {
            printWin.close();
          }
        }, 500);
        resolve(success ? { ok: true } : { ok: false, error: reason || 'Print failed' });
      });
    });
  } catch (err) {
    console.error('Print error:', err);
    return { ok: false, error: err.message || 'Print error' };
  }
});

// ===== PIN MANAGEMENT (SECURE) =====
ipcMain.handle('verify-pin', async (_, inputPin) => {
  try {
    if (typeof inputPin !== 'string' || !/^\d{4}$/.test(inputPin)) return false;
    const stored = store.get('pinHash', '');
    if (!stored) return true; // No PIN set
    
    // Compare with argon2
    const isValid = await argon2.verify(stored, inputPin);
    return isValid;
  } catch (err) {
    console.error('PIN verification error:', err);
    return false;
  }
});

ipcMain.handle('has-pin', () => !!store.get('pinHash', ''));

ipcMain.handle('set-pin', async (_, pin) => {
  try {
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return { ok: false, error: 'PIN must be 4 digits' };
    }
    const hash = await argon2.hash(pin);
    store.set('pinHash', hash);
    return { ok: true };
  } catch (err) {
    console.error('PIN set error:', err);
    return { ok: false, error: 'Failed to save PIN' };
  }
});

ipcMain.handle('clear-pin', () => {
  store.set('pinHash', '');
  return true;
});

ipcMain.handle('launch-main', () => { createMainWindow(); });

// ===== JOB HISTORY =====
ipcMain.handle('save-job', (_, job) => {
  try {
    if (!job || typeof job !== 'object') return false;
    const history = store.get('jobHistory', []);
    history.unshift({
      ...job,
      id: Date.now(),
      date: new Date().toISOString()
    });
    // Keep only last 200 jobs
    if (history.length > 200) history.pop();
    store.set('jobHistory', history);
    return true;
  } catch (err) {
    console.error('Job save error:', err);
    return false;
  }
});

ipcMain.handle('delete-job', (_, id) => {
  try {
    if (typeof id !== 'number') return false;
    store.set('jobHistory', store.get('jobHistory', []).filter(j => j.id !== id));
    return true;
  } catch (err) {
    console.error('Job delete error:', err);
    return false;
  }
});

// ===== THEME =====
ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

// ===== APP LIFECYCLE =====
app.whenReady().then(() => {
  createSplashWindow();
  setTimeout(() => {
    closeSplash();
    if (!!store.get('pinHash', '')) createLoginWindow();
    else createMainWindow();
  }, 2500);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

// Cleanup on quit
app.on('quit', () => {
  openedFilePaths.clear();
});
