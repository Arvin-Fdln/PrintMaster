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
const FILE_BUFFER_LIMIT = 5;

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
    if (!mainWindow || mainWindow.isDestroyed()) {
      return [];
    }
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

// ===== PDF ANALYSIS =====
ipcMain.handle('analyze-pdf', async (_, fileData) => {
  try {
    if (!fileData) throw new Error('No file data provided');
    const { getDocument } = await import('pdfjs-dist');
    const pdf = await getDocument({ data: fileData }).promise;
    const numPages = pdf.numPages;
    const analysis = {
      totalPages: numPages,
      colorPages: 0,
      bwPages: 0,
      pageSizes: new Set(),
      pages: []
    };

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const widthIn = viewport.width / 72;
      const heightIn = viewport.height / 72;
      const size = detectPageSize(widthIn, heightIn);
      analysis.pageSizes.add(size);
      analysis.pages.push({
        pageNum: i,
        size: size,
        widthIn: widthIn,
        heightIn: heightIn,
        widthPt: viewport.width,
        heightPt: viewport.height
      });
    }

    analysis.pageSizes = Array.from(analysis.pageSizes);
    return analysis;
  } catch (error) {
    console.error('PDF Analysis Error:', error);
    throw new Error(`Failed to analyze PDF: ${error.message}`);
  }
});

function detectPageSize(widthIn, heightIn) {
  const sizes = {
    'letter': { w: 8.5, h: 11 },
    'legal': { w: 8.5, h: 14 },
    'a4': { w: 8.27, h: 11.69 },
    'a3': { w: 11.7, h: 16.5 },
    'tabloid': { w: 11, h: 17 },
    'custom_85x13': { w: 8.5, h: 13 }
  };
  const tolerance = 0.2;
  const minDim = Math.min(widthIn, heightIn);
  const maxDim = Math.max(widthIn, heightIn);
  for (const [name, dims] of Object.entries(sizes)) {
    const w = Math.min(dims.w, dims.h);
    const h = Math.max(dims.w, dims.h);
    if (Math.abs(minDim - w) < tolerance && Math.abs(maxDim - h) < tolerance) {
      return name;
    }
  }
  return 'custom';
}

// ===== PRINT =====
ipcMain.handle('print-pdf', async (_, printData) => {
  try {
    if (!mainWindow) return { ok: false, error: 'Window unavailable' };
    
    const { pages, printerName, duplex, scale, landscape, silent } = printData;
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return { ok: false, error: 'No pages to print' };
    }

    const scaleVal = validateNumber(scale, 50, 150);
    const landscapeVal = !!landscape;
    const duplexVal = ['long', 'short', 'none'].includes(duplex) ? duplex : 'none';
    const silentVal = !!silent;

    // Build the HTML
    const pageDivs = pages.map((pg, index) => {
      if (!pg.dataUrl || !pg.widthPt || !pg.heightPt) return '';
      const wIn = (pg.widthPt / 72).toFixed(4);
      const hIn = (pg.heightPt / 72).toFixed(4);
      const rot = pg.rotation || 0;
      const imgStyle = rot ? 
        `width:100%;height:100%;display:block;transform:rotate(${rot}deg);transform-origin:center;` : 
        `width:100%;height:100%;display:block;`;
      const breakStyle = index < pages.length - 1 ? 'page-break-after:always;' : '';
      return `<div class="page" style="width:${wIn}in;height:${hIn}in;${breakStyle}">
        <img src="${pg.dataUrl}" style="${imgStyle}">
      </div>`;
    }).join('\n');

    const scaleCSS = scaleVal !== 100 ? 
      `transform:scale(${scaleVal/100});transform-origin:top left;` : '';
    const isLandscape = landscapeVal ? '@page { size: landscape; }' : '';

    const html = `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>PrintMaster Print Job</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: white; }
        .page {
          display: block;
          overflow: hidden;
          page-break-inside: avoid;
          ${scaleCSS}
        }
        .page:last-child { page-break-after: auto; }
        .page img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: fill;
        }
        ${isLandscape}
        @page {
          margin: 0;
          size: auto;
        }
        @media print {
          body { margin: 0; }
          .page { 
            page-break-after: always;
            page-break-inside: avoid;
          }
          .page:last-child { page-break-after: auto; }
        }
      </style>
    </head>
    <body>
      ${pageDivs}
    </body>
    </html>`;

    // Create temp file
    const tempDir = app.getPath('temp');
    const tempFile = path.join(tempDir, `printmaster-${Date.now()}.html`);
    await fs.promises.writeFile(tempFile, html, 'utf-8');

    const printWin = new BrowserWindow({
      width: 800,
      height: 1000,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    await printWin.loadFile(tempFile);
    await new Promise(r => setTimeout(r, 800));

    const firstPage = pages[0];
    const wMicrons = Math.round((firstPage.widthPt / 72) * 25400);
    const hMicrons = Math.round((firstPage.heightPt / 72) * 25400);

    // ---- PAPER SIZE FIX ----
    const firstPageSize = detectPageSize(firstPage.widthIn, firstPage.heightIn);
    let pageSizeOption;
    switch(firstPageSize) {
      case 'letter': pageSizeOption = 'Letter'; break;
      case 'legal': pageSizeOption = 'Legal'; break;
      case 'a4': pageSizeOption = 'A4'; break;
      case 'a3': pageSizeOption = 'A3'; break;
      case 'tabloid': pageSizeOption = 'Tabloid'; break;
      default:
        pageSizeOption = { width: wMicrons, height: hMicrons };
        break;
    }

    const printOptions = {
      silent: silentVal,
      printBackground: true,
      color: true,
      pageSize: pageSizeOption,
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
      let printed = false;
      
      const onPrinted = (success, reason) => {
        if (printed) return;
        printed = true;
        
        setTimeout(() => {
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {}
          if (printWin && !printWin.isDestroyed()) {
            printWin.close();
          }
        }, 1000);
        
        if (success) {
          resolve({ ok: true });
        } else {
          // Fallback
          if (reason && (reason.includes('invalid') || reason.includes('failed'))) {
            console.warn('Direct print failed, trying PDF fallback...');
            printWin.webContents.printToPDF({ 
              pageSize: 'A4',
              landscape: landscapeVal,
              printBackground: true
            }).then(pdfData => {
              const pdfPath = path.join(tempDir, `printmaster-fallback-${Date.now()}.pdf`);
              fs.writeFileSync(pdfPath, pdfData);
              shell.openPath(pdfPath);
              resolve({ ok: true, fallback: true });
            }).catch(err => {
              resolve({ ok: false, error: reason || err.message || 'Print failed' });
            });
          } else {
            resolve({ ok: false, error: reason || 'Print failed' });
          }
        }
      };

      printWin.once('closed', () => {
        if (!printed) {
          printed = true;
          resolve({ ok: false, error: 'Print window closed' });
        }
      });

      printWin.webContents.print(printOptions, onPrinted);
    });

  } catch (err) {
    console.error('Print error:', err);
    return { ok: false, error: err.message || 'Print error' };
  }
});

// ===== PIN MANAGEMENT =====
ipcMain.handle('verify-pin', async (_, inputPin) => {
  try {
    if (typeof inputPin !== 'string' || !/^\d{4}$/.test(inputPin)) return false;
    const stored = store.get('pinHash', '');
    if (!stored) return true;
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

app.on('quit', () => {
  openedFilePaths.clear();
});