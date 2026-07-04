// ===== SECURITY & UTILITIES =====
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function validateNumber(val, min = 0, max = 999) {
  const num = parseFloat(val) || min;
  return Math.max(min, Math.min(max, num));
}

function validateString(str, maxLen = 256) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen);
}

// pdfjsLib loaded via bootstrap in index.html
const pdfjsLib = window.pdfjsLib;

// ===== PAPER SIZES DATABASE =====
const PAPER_SIZES = {
  letter: { w: 8.5, h: 11, name: 'Letter (8.5 × 11")' },
  legal: { w: 8.5, h: 14, name: 'Legal (8.5 × 14")' },
  tabloid: { w: 11, h: 17, name: 'Tabloid (11 × 17")' },
  ledger: { w: 17, h: 11, name: 'Ledger (17 × 11")' },
  custom_85x13: { w: 8.5, h: 13, name: '8.5 × 13"' },
  a0: { w: 33.1, h: 46.8, name: 'A0 (33.1 × 46.8")' },
  a1: { w: 23.4, h: 33.1, name: 'A1 (23.4 × 33.1")' },
  a2: { w: 16.5, h: 23.4, name: 'A2 (16.5 × 23.4")' },
  a3: { w: 11.7, h: 16.5, name: 'A3 (11.7 × 16.5")' },
  a4: { w: 8.27, h: 11.69, name: 'A4 (8.27 × 11.69")' },
  a5: { w: 5.83, h: 8.27, name: 'A5 (5.83 × 8.27")' },
  a6: { w: 4.13, h: 5.83, name: 'A6 (4.13 × 5.83")' },
  b4: { w: 9.84, h: 13.9, name: 'B4 (9.84 × 13.9")' },
  b5: { w: 6.93, h: 9.84, name: 'B5 (6.93 × 9.84")' },
  c5: { w: 6.38, h: 9.02, name: 'C5 (6.38 × 9.02")' },
  halfletter: { w: 5.5, h: 8.5, name: 'Half Letter (5.5 × 8.5")' },
  gov: { w: 8, h: 10.5, name: 'Government Letter (8 × 10.5")' },
};

function getPaperSizeKey(widthIn, heightIn) {
  const tolerance = 0.15;
  let closest = null;
  let minDist = Infinity;
  
  for (const [key, size] of Object.entries(PAPER_SIZES)) {
    const dist1 = Math.abs(widthIn - size.w) + Math.abs(heightIn - size.h);
    const dist2 = Math.abs(widthIn - size.h) + Math.abs(heightIn - size.w);
    const dist = Math.min(dist1, dist2);
    if (dist < tolerance && dist < minDist) {
      minDist = dist;
      closest = key;
    }
  }
  return closest || 'letter';
}

function sizeName(k) { 
  return PAPER_SIZES[k]?.name || PAPER_SIZES.letter.name; 
}

// ===== STATE =====
let state = {
  pdfs: [],
  activePdfId: null,
  copies: 1,
  pricing: { 
    bw: { letter:3, legal:4, a3:6, a4:3, tabloid:8, custom_85x13:3.5 },
    color: { letter:15, legal:20, a3:30, a4:15, tabloid:40, custom_85x13:17.5 },
    defaultSize:'letter'
  },
  settings: {},
  currency: '₱'
};

function activePdf() { return state.pdfs.find(p => p.id === state.activePdfId) || state.pdfs[0] || null; }
function allPages() { return state.pdfs.flatMap(pdf => pdf.pages); }

// ===== SIDEBAR COLLAPSE =====
let sidebarCollapsed = false;
window.toggleSidebar = function() {
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
};

// ===== PRINTER DROPDOWN =====
let printerDropdownOpen = false;
let cachedPrinters = [];

window.togglePrinterDropdown = function() {
  printerDropdownOpen = !printerDropdownOpen;
  const dd = document.getElementById('printer-dropdown');
  const chevron = document.getElementById('biz-chevron');
  dd.classList.toggle('open', printerDropdownOpen);
  chevron.style.transform = printerDropdownOpen ? 'rotate(180deg)' : '';
  if (printerDropdownOpen) renderPrinterList();
};

function renderPrinterList() {
  const list = document.getElementById('printer-list');
  if (!cachedPrinters.length) {
    list.innerHTML = '<div class="no-printers">No printers found</div>';
    return;
  }
  list.innerHTML = cachedPrinters.map(p => `
    <div class="printer-item">
      <div class="status-dot ${p.status === 0 ? '' : 'offline'}"></div>
      <div class="printer-name">${escapeHtml(p.name)}</div>
      ${p.isDefault ? '<div class="printer-default">Default</div>' : ''}
    </div>`).join('');
}

document.addEventListener('click', e => {
  const bottom = document.querySelector('.sidebar-bottom');
  if (bottom && !bottom.contains(e.target) && printerDropdownOpen) {
    printerDropdownOpen = false;
    document.getElementById('printer-dropdown').classList.remove('open');
    document.getElementById('biz-chevron').style.transform = '';
  }
});

// ===== PRINTER STATUS =====
async function checkPrinterStatus() {
  try {
    const printers = await window.api.getPrinters();
    cachedPrinters = printers || [];
    const dot = document.getElementById('printer-status-dot');
    const txt = document.getElementById('printer-status-text');
    if (printers && printers.length > 0) {
      dot.className = 'status-dot';
      txt.textContent = `${printers.length} printer${printers.length>1?'s':''} connected`;
    } else {
      dot.className = 'status-dot offline';
      txt.textContent = 'No printers found';
    }
  } catch (e) {
    console.warn('Printer check error:', e);
    cachedPrinters = [];
    const dot = document.getElementById('printer-status-dot');
    const txt = document.getElementById('printer-status-text');
    if (dot) dot.className = 'status-dot offline';
    if (txt) txt.textContent = 'Offline';
  }
}

async function loadDefaultPrinterList() {
  try {
    const printers = await window.api.getPrinters();
    const sel = document.getElementById('s-default-printer');
    if (!sel) return;
    sel.innerHTML = '<option value="__default__">System Default</option>' +
      printers.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
    const stored = await window.api.getStore('defaultPrinter');
    if (stored) {
      sel.value = stored;
    }
  } catch (e) {
    console.warn('Could not load printers for default setting', e);
  }
}

// ===== INIT =====
async function init() {
  try {
    const all = await window.api.getAllStore();
    state.settings = all;
    state.pricing = all.pricing || state.pricing;
    state.currency = all.currency || '₱';

    try {
      const ver = await window.api.getVersion();
      if (ver) {
        document.getElementById('app-ver').textContent = 'v' + ver;
        if (document.getElementById('about-ver')) document.getElementById('about-ver').textContent = 'Version ' + ver;
      }
    } catch(e) {
      console.error('Could not load version:', e);
    }

    applyTheme(all.theme || 'light');

    const bizName = validateString(all.businessName || 'My Print Shop', 100);
    document.getElementById('sb-biz-name').textContent = bizName;
    document.getElementById('sb-biz-avatar').textContent = bizName.charAt(0).toUpperCase();

    populateSettings(all);
    renderHistory();
    setTimeout(async () => {
      checkPrinterStatus();
      await loadDefaultPrinterList();
    }, 500);

    document.getElementById('s-show-tax').addEventListener('change', function() {
      document.getElementById('tax-row').style.display = this.checked ? 'flex' : 'none';
    });
  } catch (err) {
    console.error('Init error:', err);
    toast('Failed to initialize app: ' + err.message);
  }
}

// ===== NAVIGATION =====
window.gotoPage = function(id) {
  if (typeof id !== 'string') return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (!page) return;
  page.classList.add('active');
  document.querySelector(`.nav-item[data-page="${id}"]`)?.classList.add('active');
  if (id === 'quote') buildQuote();
  if (id === 'history') renderHistory();
};

// ===== THEME =====
function applyTheme(t) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.className = dark ? 'theme-dark' : 'theme-light';
  if (document.getElementById('s-dark')) document.getElementById('s-dark').checked = dark;
}
window.toggleDark = function(on) { document.body.className = on ? 'theme-dark' : 'theme-light'; };

// ===== DRAG & DROP =====
let dragCounter = 0;
window.pageOver = function(e) { e.preventDefault(); dragCounter++; document.getElementById('drag-overlay').classList.add('active'); };
window.pageOut = function(e) { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; document.getElementById('drag-overlay').classList.remove('active'); } };
window.pageDrop = function(e) {
  e.preventDefault(); dragCounter = 0;
  document.getElementById('drag-overlay').classList.remove('active');
  const files = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (files.length) loadFilesFromDrop(files);
};

async function loadFilesFromDrop(files) {
  for (const f of files) {
    if (f.type !== 'application/pdf' && !f.name.endsWith('.pdf')) continue;
    try {
      const ab = await f.arrayBuffer();
      await processPdf({ buffer: ab, name: f.name, size: f.size });
    } catch (err) {
      toast('Failed to load: ' + f.name);
    }
  }
}

// ===== OPEN PDF =====
window.openPdfDialog = async function() {
  try {
    const results = await window.api.openPdfDialog();
    if (!results || !results.length) return;
    for (const result of results) {
      if (result) await processPdf(result);
    }
  } catch (err) {
    console.error('Dialog error:', err);
    toast('Failed to open PDF');
  }
};

// ===== PROCESS PDF =====
// Thumbnail cache for performance
const thumbCache = new Map();
const MAX_CACHE = 100;

async function getThumbnail(page, scale = 0.35) {
  const key = `${page._pageIndex}-${scale}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  
  thumbCache.set(key, dataUrl);
  if (thumbCache.size > MAX_CACHE) {
    const first = thumbCache.keys().next().value;
    thumbCache.delete(first);
  }
  return dataUrl;
}

async function processPdf({ buffer, name, size, fileId }) {
  document.getElementById('drop-zone').style.display = 'none';
  document.getElementById('scan-results').style.display = 'none';
  document.getElementById('scan-progress').style.display = 'block';
  document.getElementById('scan-file-info').innerHTML = `
    <div class="scan-file-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
    <div><div class="scan-file-name">${escapeHtml(name)}</div><div class="scan-file-size">${(size/1024/1024).toFixed(2)} MB</div></div>`;
  setProgress(5, 'Loading PDF...');
  try {
    const pdfData = Array.isArray(buffer) ? new Uint8Array(buffer) : new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const total = pdf.numPages;
    setProgress(15, `Found ${total} page${total>1?'s':''}. Analyzing...`);
    const canvas = document.getElementById('offscreen-canvas');
    const ctx = canvas.getContext('2d');
    const pages = [];
    
    for (let p = 1; p <= total; p++) {
      const page = await pdf.getPage(p);
      const rawVp = page.getViewport({ scale: 1 });
      const widthPt = rawVp.width, heightPt = rawVp.height;
      const widthIn = widthPt / 72, heightIn = heightPt / 72;
      const sizeKey = getPaperSizeKey(widthIn, heightIn);
      
      const vp = page.getViewport({ scale: 0.8 });
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const colored = detectColor(ctx.getImageData(0, 0, canvas.width, canvas.height));
      
      const thumbFn = () => getThumbnail(page, 0.35);
      const fullFn = () => getThumbnail(page, 1.5);
      const printFn = () => getThumbnail(page, 3.0);
      
      const cost = getPageCost(colored, sizeKey);
      pages.push({ 
        num: p, colored, colorOverride: null, included: true, sizeKey, cost,
        widthPt, heightPt, widthIn, heightIn,
        _thumbFn: thumbFn,
        _fullFn: fullFn,
        _printFn: printFn,
        thumb: null, full: null, printImg: null,
      });
      setProgress(15 + Math.round((p/total)*82), `Page ${p} of ${total} — ${colored?'🎨 Color':'⬛ B&W'} (${widthIn.toFixed(1)}" × ${heightIn.toFixed(1)}")`);
    }
    setProgress(100, 'Done!');
    let pdfBuffer = buffer;
    if (Array.isArray(buffer)) pdfBuffer = new Uint8Array(buffer).buffer;
    const pdfId = Date.now() + Math.random();
    state.pdfs.push({ id: pdfId, fileName: validateString(name, 256), fileSize: size, fileId: fileId||null, pdfBuffer, pages });
    state.activePdfId = pdfId;
    
    if (state.pdfs.length > 5) {
      const oldPdf = state.pdfs.shift();
      if (oldPdf) oldPdf.pdfBuffer = null;
    }
    
    setTimeout(() => renderResults(), 300);
  } catch (err) {
    console.error('PDF processing error:', err);
    setProgress(0, 'Error: ' + err.message);
    resetScan();
    toast('Failed to read PDF: ' + err.message);
  }
}

function setProgress(pct, msg) {
  document.getElementById('prog-fill').style.width = pct + '%';
  document.getElementById('prog-label').textContent = msg;
}

// ===== IMPROVED COLOR DETECTION =====
function detectColor(imgData) {
  const d = imgData.data;
  let colorPx = 0, total = 0;
  const step = 4;
  const sens = validateNumber(state.settings.colorSensitivity || 5, 1, 10);
  const satThreshold = 0.08 - (sens * 0.004);
  const ratioThreshold = 0.008 - (sens * 0.0006);
  
  for (let i = 0; i < d.length; i += 4 * step) {
    const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
    if (a < 30) continue;
    const brightness = (r + g + b) / 3;
    if (brightness > 240 || brightness < 15) continue;
    const grayDev = Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b);
    if (grayDev < 20) continue;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const sat = max === 0 ? 0 : (max-min)/max;
    if (sat > satThreshold) colorPx++;
    total++;
  }
  return total > 0 && (colorPx/total) > ratioThreshold;
}

function effectiveColor(p) { return p.colorOverride !== null ? p.colorOverride : p.colored; }
function getPageCost(colored, sizeKey) { const src = colored ? state.pricing.color : state.pricing.bw; return src[sizeKey] ?? src.letter ?? 0; }

// ===== RENDER RESULTS =====
function renderResults() {
  document.getElementById('scan-progress').style.display = 'none';
  document.getElementById('drop-zone').style.display = 'none';
  document.getElementById('scan-results').style.display = 'block';
  document.getElementById('add-pdf-btn').style.display = 'inline-flex';
  document.getElementById('open-btn').style.display = 'none';
  renderPdfTabs(); renderMetrics(); renderTable(); updateTotalBar();
}

function renderPdfTabs() {
  document.getElementById('pdf-tabs').innerHTML = state.pdfs.map(pdf => `
    <div class="pdf-tab ${pdf.id===state.activePdfId?'active':''}" onclick="switchPdfTab(${pdf.id})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="pdf-tab-name">${escapeHtml(pdf.fileName)}</span>
      <span class="pdf-tab-count">${pdf.pages.length}pg</span>
      <button class="pdf-tab-close" onclick="removePdf(${pdf.id},event)">×</button>
    </div>`).join('');
}

window.switchPdfTab = function(id) { state.activePdfId = id; renderPdfTabs(); renderMetrics(); renderTable(); };
window.removePdf = function(id, e) {
  e.stopPropagation();
  const pdf = state.pdfs.find(p => p.id === id);
  if (pdf) pdf.pdfBuffer = null;
  state.pdfs = state.pdfs.filter(p => p.id !== id);
  if (!state.pdfs.length) { resetScan(); return; }
  if (state.activePdfId === id) state.activePdfId = state.pdfs[0].id;
  renderResults();
};

function renderMetrics() {
  const pdf = activePdf(); if (!pdf) return;
  const pages = pdf.pages;
  const included = pages.filter(p => p.included);
  const colorPgs = included.filter(p => effectiveColor(p)).length;
  const cur = state.currency;
  const total = included.reduce((s,p) => s + getPageCost(effectiveColor(p), p.sizeKey), 0) * state.copies;
  document.getElementById('metrics-row').innerHTML = `
    <div class="metric-card"><div class="metric-label">Total Pages</div><div class="metric-value">${pages.length}</div><div class="metric-sub">${included.length} included</div></div>
    <div class="metric-card"><div class="metric-label">Color Pages</div><div class="metric-value">${colorPgs}</div><div class="metric-sub">${included.length?Math.round(colorPgs/included.length*100)+'%':'—'}</div></div>
    <div class="metric-card"><div class="metric-label">B&W Pages</div><div class="metric-value">${included.length-colorPgs}</div><div class="metric-sub">${included.length?Math.round((included.length-colorPgs)/included.length*100)+'%':'—'}</div></div>
    <div class="metric-card"><div class="metric-label">Est. Total</div><div class="metric-value">${cur}${total.toFixed(2)}</div><div class="metric-sub">${state.copies} cop${state.copies===1?'y':'ies'}</div></div>`;
  document.getElementById('results-file').innerHTML = `📄 ${escapeHtml(pdf.fileName)} — ${(pdf.fileSize/1024/1024).toFixed(2)} MB`;
}

function renderTable() {
  const cur = state.currency;
  const pdf = activePdf(); if (!pdf) return;
  
  const rows = pdf.pages.map(async (p, i) => {
    let thumb = p.thumb;
    if (!thumb) {
      thumb = await p._thumbFn();
      p.thumb = thumb;
    }
    const isColor = effectiveColor(p);
    const isOverridden = p.colorOverride !== null;
    const excluded = !p.included;
    const sizeDisplay = `${p.widthIn.toFixed(2)}" × ${p.heightIn.toFixed(2)}"`;
    return `<tr class="${excluded?'row-excluded':''}">
      <td style="color:var(--text-secondary);font-size:12px;">${p.num}</td>
      <td><div class="thumb-cell" onclick="openPreview(${i})" title="Click to preview"><img src="${thumb}" alt="p${p.num}" style="${excluded?'opacity:0.35':''}"><div class="thumb-overlay">🔍</div></div></td>
      <td><label class="include-toggle"><input type="checkbox" ${p.included?'checked':''} onchange="toggleInclude(${i},this.checked)"><span class="include-slider"></span></label></td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;${excluded?'opacity:0.4':''}">
          <span class="badge ${isColor?'badge-color':'badge-bw'}"><span class="dot-c" style="background:${isColor?'#c0392b':'#888'}"></span>${isColor?'Color':'B&W'}</span>
          ${isOverridden?`<span style="font-size:10px;color:var(--text-secondary);font-style:italic;">override</span>`:''}
        </div>
        <div style="margin-top:5px;display:flex;gap:4px;${excluded?'opacity:0.4':''}">
          <button class="color-ovr-btn ${!isColor?'active-bw':''}" onclick="setColorOverride(${i},false)">B&W</button>
          <button class="color-ovr-btn ${isColor?'active-color':''}" onclick="setColorOverride(${i},true)">Color</button>
          ${isOverridden?`<button class="color-ovr-btn reset-btn" onclick="setColorOverride(${i},null)">Auto</button>`:''}
        </div>
      </td>
      <td style="${excluded?'opacity:0.4':''}"><span class="badge badge-size" title="${sizeName(p.sizeKey)}">${sizeDisplay}</span></td>
      <td style="${excluded?'opacity:0.4':''}">
        <select class="size-sel" onchange="overrideSize(${i},this.value)" ${excluded?'disabled':''}>
          ${Object.entries(PAPER_SIZES).map(([k,v]) => `<option value="${k}" ${p.sizeKey===k?'selected':''}>${v.name}</option>`).join('')}
        </select>
      </td>
      <td style="color:var(--text-secondary);font-size:12px;${excluded?'opacity:0.4':''}">$${getPageCost(isColor,p.sizeKey).toFixed(2)}/pg</td>
      <td style="text-align:right;font-weight:500;${excluded?'opacity:0.4;text-decoration:line-through':''}">$${excluded?'—':cur+p.cost.toFixed(2)}</td>
    </tr>`;
  });
  
  Promise.all(rows).then(html => {
    document.getElementById('page-tbody').innerHTML = html.join('');
  });
}

function updateTotalBar() {
  const cur = state.currency, copies = validateNumber(state.copies, 1, 999);
  const included = allPages().filter(p => p.included);
  const total = included.reduce((s,p) => s + getPageCost(effectiveColor(p), p.sizeKey), 0) * copies;
  const colorCount = included.filter(p => effectiveColor(p)).length;
  const pdf = activePdf();
  document.getElementById('total-summary').textContent = `${pdf?pdf.pages.filter(p=>p.included).length:0} of ${pdf?.pages.length||0} pages included · ${colorCount} color · ${included.length-colorCount} B&W`;
  document.getElementById('grand-total').textContent = `${cur}${total.toFixed(2)}`;
  const mv = document.querySelector('.metric-card:last-child .metric-value');
  if (mv) mv.textContent = `${cur}${total.toFixed(2)}`;
  const ms = document.querySelector('.metric-card:last-child .metric-sub');
  if (ms) ms.textContent = `${copies} cop${copies===1?'y':'ies'}`;
}

window.toggleInclude = function(idx, val) { const pdf = activePdf(); if (!pdf) return; pdf.pages[idx].included = val; renderTable(); renderMetrics(); updateTotalBar(); };
window.overrideSize = function(idx, newSize) { const pdf = activePdf(); if (!pdf) return; if (PAPER_SIZES[newSize]) { pdf.pages[idx].sizeKey = newSize; pdf.pages[idx].cost = getPageCost(effectiveColor(pdf.pages[idx]), newSize); renderTable(); updateTotalBar(); } };
window.setColorOverride = function(idx, val) { const pdf = activePdf(); if (!pdf) return; pdf.pages[idx].colorOverride = val; pdf.pages[idx].cost = getPageCost(effectiveColor(pdf.pages[idx]), pdf.pages[idx].sizeKey); renderTable(); updateTotalBar(); };
window.recalcCopies = function() { state.copies = validateNumber(document.getElementById('copies-input').value, 1, 999); renderMetrics(); updateTotalBar(); };
window.resetScan = function() {
  state.pdfs.forEach(p => p.pdfBuffer = null);
  state.pdfs = []; state.activePdfId = null; state.copies = 1;
  document.getElementById('copies-input').value = 1;
  document.getElementById('drop-zone').style.display = 'block';
  document.getElementById('scan-progress').style.display = 'none';
  document.getElementById('scan-results').style.display = 'none';
  document.getElementById('add-pdf-btn').style.display = 'none';
  document.getElementById('open-btn').style.display = 'inline-flex';
  thumbCache.clear();
};

// ===== PRINT PREVIEW =====
let pendingPrintData = null;
let ppState = {
  pages: [],
  currentIdx: 0,
  zoom: 1.0,
  rotations: [],
  scale: 100,
  orientation: 'portrait',
  duplex: 'none',
  printerName: '__default__',
  zoomMode: 'fit'
};

window.printPdf = async function() {
  const pdf = activePdf(); if (!pdf) { toast('No PDF loaded.'); return; }
  const includedPages = pdf.pages.filter(p => p.included);
  if (!includedPages.length) { toast('No pages selected for printing.'); return; }

  for (const p of includedPages) {
    if (!p.printImg) {
      p.printImg = await p._printFn();
    }
  }

  ppState.pages = includedPages;
  ppState.currentIdx = 0;
  ppState.zoom = 1.0;
  ppState.rotations = includedPages.map(() => 0);
  ppState.scale = 100;
  ppState.orientation = 'portrait';
  ppState.zoomMode = 'fit';

  document.getElementById('pp-filename').textContent = escapeHtml(pdf.fileName);
  document.getElementById('pp-page-count-info').textContent = `${includedPages.length} page${includedPages.length!==1?'s':''}`;

  document.getElementById('pp-scale-range').value = 100;
  document.getElementById('pp-scale-num').value = 100;

  document.getElementById('pp-orient-port').classList.add('active');
  document.getElementById('pp-orient-land').classList.remove('active');

  const printers = await window.api.getPrinters();
  const sel = document.getElementById('pp-printer');
  sel.innerHTML = printers.length
    ? printers.map(p => `<option value="${escapeHtml(p.name)}" ${p.isDefault?'selected':''}>${escapeHtml(p.name)}${p.isDefault?' (Default)':''}</option>`).join('')
    : '<option value="__default__">Default Printer</option>';

  // Set initial printer from stored default
  const storedDefault = await window.api.getStore('defaultPrinter');
  if (storedDefault && storedDefault !== '__default__') {
    const optionExists = Array.from(sel.options).some(opt => opt.value === storedDefault);
    if (optionExists) {
      sel.value = storedDefault;
    }
  }
  ppState.printerName = sel.value;

  sel.onchange = function() {
    ppState.printerName = this.value;
  };

  const duplexSel = document.getElementById('pp-duplex');
  duplexSel.value = 'none';
  ppState.duplex = 'none';

  // Reset print button
  const btn = document.getElementById('pp-print-btn');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print Now`;
  btn.disabled = false;

  ppRenderCurrentPage();
  document.getElementById('print-preview-modal').style.display = 'flex';
};

function ppRenderCurrentPage() {
  const pages = ppState.pages;
  if (!pages.length) return;
  const idx = ppState.currentIdx;
  const pg = pages[idx];
  const rot = ppState.rotations[idx];

  const img = document.getElementById('pp-current-img');
  img.src = pg.printImg || pg.full || pg.thumb;

  img.onload = function() {
    applyZoom();
  };
  if (img.complete && img.naturalWidth > 0) {
    applyZoom();
  }

  img.style.transform = rot ? `rotate(${rot}deg)` : '';

  document.getElementById('pp-page-counter').textContent = `${idx+1} / ${pages.length}`;
  document.getElementById('pp-prev-btn').disabled = idx === 0;
  document.getElementById('pp-next-btn').disabled = idx === pages.length - 1;

  const isColor = effectiveColor(pg);
  document.getElementById('pp-info-strip').innerHTML =
    `Page ${pg.num} &nbsp;·&nbsp; ${sizeName(pg.sizeKey)} (${pg.widthIn.toFixed(2)}" × ${pg.heightIn.toFixed(2)}") &nbsp;·&nbsp;
     <span class="badge ${isColor?'badge-color':'badge-bw'}" style="font-size:10px;">${isColor?'🎨 Color':'⬛ B&W'}</span>
     ${rot ? `&nbsp;·&nbsp; Rotated ${rot}°` : ''}`;
}

function applyZoom() {
  const container = document.getElementById('pp-page-container');
  const vp = document.getElementById('pp-viewport');
  const img = document.getElementById('pp-current-img');
  if (!vp || !img) return;

  const vpWidth = vp.clientWidth - 40;
  const vpHeight = vp.clientHeight - 40;
  let effectiveZoom = ppState.zoom;

  if (ppState.zoomMode === 'fit') {
    const imgW = img.naturalWidth || 1;
    const imgH = img.naturalHeight || 1;
    const fitWidth = vpWidth / imgW;
    const fitHeight = vpHeight / imgH;
    effectiveZoom = Math.min(fitWidth, fitHeight, 1.5);
  } else if (ppState.zoomMode === 'fitWidth') {
    const imgW = img.naturalWidth || 1;
    effectiveZoom = vpWidth / imgW;
  } else {
    effectiveZoom = ppState.zoom;
  }

  container.style.transform = `scale(${effectiveZoom})`;
  container.style.transformOrigin = 'center top';
  document.getElementById('pp-zoom-label').textContent = Math.round(effectiveZoom * 100) + '%';
}

window.ppPrevPage = function() {
  if (ppState.currentIdx > 0) { ppState.currentIdx--; ppRenderCurrentPage(); }
};
window.ppNextPage = function() {
  if (ppState.currentIdx < ppState.pages.length - 1) { ppState.currentIdx++; ppRenderCurrentPage(); }
};

window.ppZoom = function(delta) {
  ppState.zoomMode = 'custom';
  ppState.zoom = Math.min(3.0, Math.max(0.3, ppState.zoom + delta));
  applyZoom();
};

window.ppZoomMode = function(mode) {
  if (!['fit', 'fitWidth', 'custom'].includes(mode)) return;
  ppState.zoomMode = mode;
  if (mode === 'custom') ppState.zoom = 1.0;
  applyZoom();
};

window.ppRotate = function(deg) {
  const idx = ppState.currentIdx;
  ppState.rotations[idx] = ((ppState.rotations[idx] || 0) + deg + 360) % 360;
  ppRenderCurrentPage();
};

window.ppScaleChange = function(val) {
  ppState.scale = validateNumber(val, 50, 150);
  document.getElementById('pp-scale-num').value = ppState.scale;
};
window.ppScaleNumChange = function(val) {
  const v = validateNumber(val, 50, 150);
  ppState.scale = v;
  document.getElementById('pp-scale-range').value = v;
};

window.ppSetOrientation = function(ori) {
  if (!['portrait', 'landscape'].includes(ori)) ori = 'portrait';
  ppState.orientation = ori;
  document.getElementById('pp-orient-port').classList.toggle('active', ori === 'portrait');
  document.getElementById('pp-orient-land').classList.toggle('active', ori === 'landscape');
};

window.ppSetPrinter = function(name) {
  ppState.printerName = name || '__default__';
};

window.ppSetDuplex = function(mode) {
  if (!['none', 'long', 'short'].includes(mode)) mode = 'none';
  ppState.duplex = mode;
};

window.confirmPrint = async function() {
  const btn = document.getElementById('pp-print-btn');
  const originalText = btn.innerHTML;
  btn.textContent = 'Printing...'; btn.disabled = true;

  for (const pg of ppState.pages) {
    if (!pg.printImg) {
      pg.printImg = await pg._printFn();
    }
  }

  const printData = {
    pages: ppState.pages.map((pg, i) => ({
      dataUrl: pg.printImg,
      widthPt: pg.widthPt,
      heightPt: pg.heightPt,
      num: pg.num,
      colored: effectiveColor(pg),
      rotation: ppState.rotations[i] || 0
    })),
    printerName: ppState.printerName,
    duplex: ppState.duplex,
    scale: ppState.scale,
    landscape: ppState.orientation === 'landscape',
    silent: true
  };

  try {
    const result = await window.api.printPdf(printData);
    
    // Reset button
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print Now`;
    btn.disabled = false;

    if (result?.ok) {
      closePrintPreview();
      if (result.fallback) {
        toast('Print job prepared as PDF - opening for manual printing');
      } else {
        toast('Print job sent!');
      }
    } else if (result?.error) {
      toast('Print error: ' + result.error);
    } else {
      closePrintPreview();
    }
  } catch (err) {
    btn.innerHTML = originalText;
    btn.disabled = false;
    toast('Print failed: ' + err.message);
  }
};

window.closePrintPreview = function() {
  document.getElementById('print-preview-modal').style.display = 'none';
  pendingPrintData = null;
  const btn = document.getElementById('pp-print-btn');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print Now`;
  btn.disabled = false;
};

// ===== QUOTE =====
function buildQuote() {
  const included = allPages().filter(p => p.included);
  const hasData = included.length > 0;
  document.getElementById('quote-empty').style.display = hasData ? 'none' : 'flex';
  document.getElementById('quote-content').style.display = hasData ? 'block' : 'none';
  if (!hasData) return;
  const s = state.settings, cur = state.currency, copies = state.copies;
  document.getElementById('q-biz-name').textContent = escapeHtml(s.businessName || 'My Print Shop');
  document.getElementById('q-biz-meta').innerHTML = [s.address, s.contact].filter(Boolean).map(x => escapeHtml(x)).join('<br>');
  document.getElementById('q-ref').textContent = 'Ref: PM-' + Date.now().toString().slice(-6);
  document.getElementById('q-date').textContent = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  document.getElementById('q-file-row').innerHTML = `<strong>Document${state.pdfs.length>1?'s':''}:</strong> ${state.pdfs.map(p=>escapeHtml(p.fileName)).join(', ')} &nbsp;·&nbsp; ${included.length} pages &nbsp;·&nbsp; ${state.copies} cop${state.copies===1?'y':'ies'}`;
  const groups = {};
  included.forEach(p => {
    const isColor = effectiveColor(p);
    const k = `${isColor?'color':'bw'}|${p.sizeKey}`;
    if (!groups[k]) groups[k] = { colored:isColor, sizeKey:p.sizeKey, count:0, unitCost:getPageCost(isColor,p.sizeKey) };
    groups[k].count++;
  });
  let subtotal = 0;
  document.getElementById('q-tbody').innerHTML = Object.values(groups).map(g => {
    const lineTotal = g.unitCost * g.count * copies; subtotal += lineTotal;
    return `<tr><td>${g.colored?'🎨 Color':'⬛ B&W'} — ${sizeName(g.sizeKey)} × ${g.count} page${g.count>1?'s':''} × ${copies} cop${copies===1?'y':'ies'}</td><td>${cur}${g.unitCost.toFixed(2)}</td><td>×${g.count*copies}</td><td style="text-align:right;">${cur}${lineTotal.toFixed(2)}</td></tr>`;
  }).join('');
  const showTax = s.showTax, taxRate = validateNumber(s.taxRate, 0, 100);
  const tax = showTax ? subtotal*(taxRate/100) : 0;
  const grand = subtotal + tax;
  let totalsHtml = `<div class="quote-total-row"><span>Subtotal</span><span>${cur}${subtotal.toFixed(2)}</span></div>`;
  if (showTax) totalsHtml += `<div class="quote-total-row"><span>Tax (${taxRate.toFixed(2)}%)</span><span>${cur}${tax.toFixed(2)}</span></div>`;
  totalsHtml += `<div class="quote-total-row grand"><span>TOTAL</span><span>${cur}${grand.toFixed(2)}</span></div>`;
  document.getElementById('q-totals').innerHTML = totalsHtml;
}

window.saveJobFromQuote = async function() {
  const included = allPages().filter(p => p.included); if (!included.length) return;
  const total = included.reduce((s,p) => s + getPageCost(effectiveColor(p), p.sizeKey), 0) * state.copies;
  try {
    await window.api.saveJob({ fileName: state.pdfs.map(p=>p.fileName).join(', '), pages: included.length, colorPages: included.filter(p=>effectiveColor(p)).length, copies: state.copies, total, currency: state.currency });
    toast('Job saved to history!'); renderHistory();
  } catch (err) {
    toast('Failed to save job');
  }
};

// ===== HISTORY =====
async function renderHistory() {
  try {
    const history = (await window.api.getStore('jobHistory')) || [];
    const el = document.getElementById('history-list');
    const cur = state.currency;
    if (!history.length) { el.innerHTML = `<div class="empty-state" style="margin-top:3rem;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="40" height="40"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>No job history yet.</p></div>`; return; }
    el.innerHTML = history.map(j => `
      <div class="history-item">
        <div><div class="history-file">📄 ${escapeHtml(j.fileName||'Unknown')}</div><div class="history-meta">${j.pages} pages · ${j.colorPages} color · ${j.copies} cop${j.copies===1?'y':'ies'} · ${new Date(j.date).toLocaleDateString()}</div></div>
        <div style="display:flex;align-items:center;gap:12px;"><div class="history-amount">${j.currency||cur}${parseFloat(j.total).toFixed(2)}</div><button class="history-del" onclick="deleteJob(${j.id})">🗑</button></div>
      </div>`).join('');
  } catch (err) {
    console.error('History error:', err);
  }
}
window.deleteJob = async function(id) { try { await window.api.deleteJob(id); renderHistory(); } catch (err) { toast('Failed to delete'); } };
window.clearHistory = async function() { if (!confirm('Clear all job history?')) return; try { await window.api.setStore('jobHistory',[]); renderHistory(); } catch (err) { toast('Failed to clear'); } };

// ===== SETTINGS =====
function populateSettings(s) {
  document.getElementById('s-biz-name').value = validateString(s.businessName||'', 100);
  document.getElementById('s-address').value = validateString(s.address||'', 200);
  document.getElementById('s-contact').value = validateString(s.contact||'', 100);
  document.getElementById('s-currency').value = validateString(s.currency||'₱', 5);
  const p = s.pricing||state.pricing;
  document.getElementById('p-bw-letter').value = validateNumber(p.bw?.letter, 0, 999) || 3;
  document.getElementById('p-bw-legal').value = validateNumber(p.bw?.legal, 0, 999) || 4;
  document.getElementById('p-bw-a4').value = validateNumber(p.bw?.a4, 0, 999) || 3;
  document.getElementById('p-bw-a3').value = validateNumber(p.bw?.a3, 0, 999) || 6;
  document.getElementById('p-bw-tabloid').value = validateNumber(p.bw?.tabloid, 0, 999) || 8;
  document.getElementById('p-color-letter').value = validateNumber(p.color?.letter, 0, 999) || 15;
  document.getElementById('p-color-legal').value = validateNumber(p.color?.legal, 0, 999) || 20;
  document.getElementById('p-color-a4').value = validateNumber(p.color?.a4, 0, 999) || 15;
  document.getElementById('p-color-a3').value = validateNumber(p.color?.a3, 0, 999) || 30;
  document.getElementById('p-color-tabloid').value = validateNumber(p.color?.tabloid, 0, 999) || 40;
  document.getElementById('s-default-size').value = p.defaultSize||'letter';
  document.getElementById('s-show-tax').checked = !!s.showTax;
  document.getElementById('tax-row').style.display = s.showTax?'flex':'none';
  document.getElementById('s-tax-rate').value = validateNumber(s.taxRate, 0, 100) || 12;
  document.getElementById('s-color-sensitivity').value = validateNumber(s.colorSensitivity, 1, 10) || 5;
  document.getElementById('s-dark').checked = s.theme==='dark';
  updateCurrencySymbols(validateString(s.currency||'₱', 5));
  // Default printer is set in loadDefaultPrinterList, not here
}

window.saveSettings = async function() {
  try {
    const pin = document.getElementById('s-pin').value;
    const pin2 = document.getElementById('s-pin2').value;
    if (pin||pin2) {
      if (pin.length!==4||!/^\d{4}$/.test(pin)) {
        document.getElementById('pin-status').textContent='⚠ PIN must be 4 digits.';
        document.getElementById('pin-status').style.color='var(--danger)';
        return;
      }
      if (pin!==pin2) {
        document.getElementById('pin-status').textContent='⚠ PINs do not match.';
        document.getElementById('pin-status').style.color='var(--danger)';
        return;
      }
      const result = await window.api.setPin(pin);
      if (result.ok) {
        document.getElementById('pin-status').textContent='✓ PIN saved securely.';
        document.getElementById('pin-status').style.color='var(--success)';
      } else {
        document.getElementById('pin-status').textContent='⚠ ' + result.error;
        document.getElementById('pin-status').style.color='var(--danger)';
        return;
      }
      document.getElementById('s-pin').value='';
      document.getElementById('s-pin2').value='';
    }
    const cur = validateString(document.getElementById('s-currency').value||'₱', 5);
    const pricing = {
      bw: {
        letter: validateNumber(document.getElementById('p-bw-letter').value, 0, 999),
        legal: validateNumber(document.getElementById('p-bw-legal').value, 0, 999),
        a4: validateNumber(document.getElementById('p-bw-a4').value, 0, 999),
        a3: validateNumber(document.getElementById('p-bw-a3').value, 0, 999),
        tabloid: validateNumber(document.getElementById('p-bw-tabloid').value, 0, 999)
      },
      color: {
        letter: validateNumber(document.getElementById('p-color-letter').value, 0, 999),
        legal: validateNumber(document.getElementById('p-color-legal').value, 0, 999),
        a4: validateNumber(document.getElementById('p-color-a4').value, 0, 999),
        a3: validateNumber(document.getElementById('p-color-a3').value, 0, 999),
        tabloid: validateNumber(document.getElementById('p-color-tabloid').value, 0, 999)
      }
    };
    pricing.bw.custom_85x13 = state.pricing.bw.custom_85x13 || 3.5;
    pricing.color.custom_85x13 = state.pricing.color.custom_85x13 || 17.5;

    const bizName = validateString(document.getElementById('s-biz-name').value, 100);
    const address = validateString(document.getElementById('s-address').value, 200);
    const contact = validateString(document.getElementById('s-contact').value, 100);
    const showTax = document.getElementById('s-show-tax').checked;
    const taxRate = validateNumber(document.getElementById('s-tax-rate').value, 0, 100);
    const colorSensitivity = validateNumber(document.getElementById('s-color-sensitivity').value, 1, 10);
    const theme = document.getElementById('s-dark').checked?'dark':'light';
    const defaultPrinter = document.getElementById('s-default-printer').value;

    await window.api.setStore('businessName', bizName);
    await window.api.setStore('address', address);
    await window.api.setStore('contact', contact);
    await window.api.setStore('currency', cur);
    await window.api.setStore('pricing', pricing);
    await window.api.setStore('showTax', showTax);
    await window.api.setStore('taxRate', taxRate);
    await window.api.setStore('colorSensitivity', colorSensitivity);
    await window.api.setStore('theme', theme);
    await window.api.setStore('defaultPrinter', defaultPrinter);

    state.pricing = pricing;
    state.currency = cur;
    state.settings = { ...state.settings, businessName: bizName, address, contact, currency: cur, pricing, showTax, taxRate, colorSensitivity, theme, defaultPrinter };

    document.getElementById('sb-biz-name').textContent = bizName || 'My Print Shop';
    document.getElementById('sb-biz-avatar').textContent = (bizName || 'M').charAt(0).toUpperCase();
    document.getElementById('sb-biz-contact').textContent = contact || '';
    updateCurrencySymbols(cur);
    applyTheme(theme);
    toast('Settings saved!');
  } catch (err) {
    console.error('Settings save error:', err);
    toast('Failed to save settings');
  }
};

window.clearPin = async function() {
  if (!confirm('Remove PIN lock?')) return;
  try {
    await window.api.clearPin();
    document.getElementById('pin-status').textContent='✓ PIN removed.';
    document.getElementById('pin-status').style.color='var(--success)';
  } catch (err) {
    toast('Failed to clear PIN');
  }
};

function updateCurrencySymbols(sym) {
  for (let i = 1; i <= 10; i++) {
    const el = document.getElementById('cs' + i);
    if (el) el.textContent = escapeHtml(sym);
  }
}

// ===== PAGE PREVIEW MODAL =====
let previewIdx = 0;
window.openPreview = function(idx) { previewIdx=idx; showPreview(); document.getElementById('preview-modal').style.display='flex'; };
window.closePreview = function() { document.getElementById('preview-modal').style.display='none'; };
window.shiftPreview = function(dir) { const pages=activePdf()?.pages||[]; previewIdx=Math.max(0,Math.min(pages.length-1,previewIdx+dir)); showPreview(); };
function showPreview() {
  const pages=activePdf()?.pages||[];
  const p=pages[previewIdx];
  if (!p) return;
  if (!p.full) {
    p._fullFn().then(url => {
      p.full = url;
      document.getElementById('preview-img').src = url;
    });
    document.getElementById('preview-img').src = p.thumb || '';
  } else {
    document.getElementById('preview-img').src = p.full;
  }
  const isColor=effectiveColor(p);
  document.getElementById('preview-label').innerHTML=`Page ${p.num} of ${pages.length} &nbsp;·&nbsp; <span class="badge ${isColor?'badge-color':'badge-bw'}" style="font-size:12px;">${isColor?'🎨 Color':'⬛ B&W'}</span>`;
  document.getElementById('prev-pg').disabled=previewIdx===0;
  document.getElementById('next-pg').disabled=previewIdx===pages.length-1;
}

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', e => {
  if (document.getElementById('preview-modal').style.display==='flex') {
    if (e.key==='ArrowLeft') shiftPreview(-1);
    if (e.key==='ArrowRight') shiftPreview(1);
    if (e.key==='Escape') closePreview();
  }
  if (document.getElementById('print-preview-modal').style.display==='flex') {
    if (e.key==='Escape') closePrintPreview();
    if (e.key==='ArrowLeft') ppPrevPage();
    if (e.key==='ArrowRight') ppNextPage();
    if (e.key==='+'||e.key==='=') ppZoom(0.15);
    if (e.key==='-') ppZoom(-0.15);
    if (e.key==='0') ppZoomMode('fit');
  }
});

// ===== CTRL + MOUSE WHEEL ZOOM =====
document.addEventListener('DOMContentLoaded', () => {
  const vp = document.getElementById('pp-viewport');
  if (vp) {
    vp.addEventListener('wheel', e => {
      if (document.getElementById('print-preview-modal').style.display === 'flex') {
        if (e.ctrlKey) {
          e.preventDefault();
          ppZoom(e.deltaY < 0 ? 0.15 : -0.15);
        }
        // else let scroll happen normally
      }
    }, { passive: false });
  }
});

// ===== ABOUT =====
window.closeAbout = function() { document.getElementById('about-modal').style.display='none'; };

// ===== TOAST =====
window.toast = function(msg) { const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); };

init();