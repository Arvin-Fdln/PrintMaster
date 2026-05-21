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
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
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

  // Remove native menu bar entirely — everything handled in-app
  Menu.setApplicationMenu(null);
}

// IPC Handlers
ipcMain.handle('get-store', (_, key) => store.get(key));
ipcMain.handle('set-store', (_, key, value) => { store.set(key, value); return true; });
ipcMain.handle('get-all-store', () => store.store);

// Store file paths in main process — avoids buffer serialization issues over IPC
const openedFilePaths = new Map();

ipcMain.handle('open-pdf-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select PDF File(s)',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled) return null;
  return result.filePaths.map(filePath => {
    const data = fs.readFileSync(filePath);
    // Use Buffer.from to get a proper copy — NOT data.buffer which includes pool memory
    const properBuffer = Buffer.from(data);
    const id = Date.now() + Math.random().toString(36).slice(2);
    openedFilePaths.set(id, filePath);
    return {
      buffer: Array.from(properBuffer), // serialize as plain array — safe over IPC
      name: path.basename(filePath),
      size: data.length,
      fileId: id
    };
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

ipcMain.handle('print-pdf', async (_, printData) => {
  try {
    // printData: { pages: [{dataUrl, widthPt, heightPt}], fileName }
    // Build print HTML with exact physical page sizes
    const pageDivs = printData.pages.map(pg => {
      // Convert PDF points to inches (1 pt = 1/72 inch)
      const wIn = (pg.widthPt / 72).toFixed(4);
      const hIn = (pg.heightPt / 72).toFixed(4);
      return `<div class="page" style="width:${wIn}in;height:${hIn}in;">
        <img src="${pg.dataUrl}" style="width:100%;height:100%;display:block;">
      </div>`;
    }).join('\n');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:white; }
  .page {
    display: block;
    overflow: hidden;
    page-break-after: always;
    page-break-inside: avoid;
  }
  .page:last-child { page-break-after: auto; }
  .page img { display:block; width:100%; height:100%; object-fit:fill; }
  @page { margin: 0; }
  @media print { body { margin:0; } }
</style></head><body>${pageDivs}</body></html>`;

    const printWin = new BrowserWindow({
      width: 900, height: 1100,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise(r => setTimeout(r, 600));

    // Use first page's size for the print page setup
    const firstPage = printData.pages[0];
    const wMicrons = Math.round((firstPage.widthPt / 72) * 25400);
    const hMicrons = Math.round((firstPage.heightPt / 72) * 25400);

    return new Promise((resolve) => {
      printWin.webContents.print({
        silent: false,
        printBackground: true,
        color: true,
        pageSize: { width: wMicrons, height: hMicrons },
        margins: { marginType: 'none' }
      }, (success, reason) => {
        printWin.close();
        resolve(success ? { ok: true } : { ok: false, error: reason || 'Cancelled' });
      });
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('print-pdf-buffer', async (_, bufferArray, fileName) => {
  // kept as fallback, not used in main flow anymore
  return { ok: false, error: 'Use print-pdf instead.' };
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
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
ipcMain.handle('window-close', () => mainWindow?.close());
ipcMain.handle('get-version', () => app.getVersion());

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
