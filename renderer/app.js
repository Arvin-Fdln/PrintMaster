// pdfjsLib is loaded via window.pdfjsLib by the bootstrap in index.html
const pdfjsLib = window.pdfjsLib;

// ===== STATE =====
let state = {
  pdfs: [],           // array of { id, fileName, fileSize, pdfBuffer, pages[] }
  activePdfId: null,  // which PDF tab is selected
  copies: 1,
  pricing: { bw: { letter:3, legal:4, a3:6, a4:3 }, color: { letter:15, legal:20, a3:30, a4:15 }, defaultSize:'letter' },
  settings: {},
  currency: '₱'
};

function activePdf() {
  return state.pdfs.find(p => p.id === state.activePdfId) || state.pdfs[0] || null;
}
function allPages() {
  return state.pdfs.flatMap(pdf => pdf.pages);
}

// ===== INIT =====
async function init() {
  const all = await window.api.getAllStore();
  state.settings = all;
  state.pricing = all.pricing || state.pricing;
  state.currency = all.currency || '₱';

  applyTheme(all.theme || 'light');
  document.getElementById('sb-biz-name').textContent = all.businessName || 'My Print Shop';
  document.getElementById('sb-biz-contact').textContent = all.contact || '';
  populateSettings(all);
  renderHistory();

  // Menu/keyboard triggers from main process
  window.api.on('open-settings', () => gotoPage('settings'));
  window.api.on('trigger-open', () => openPdfDialog());
  window.api.on('new-job', () => resetScan());
  window.api.on('show-about', () => document.getElementById('about-modal').style.display='flex');
  window.api.on('export-quote', () => window.print());

  document.getElementById('s-show-tax').addEventListener('change', function() {
    document.getElementById('tax-row').style.display = this.checked ? 'flex' : 'none';
  });
}

// ===== NAVIGATION =====
window.gotoPage = function(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelector(`.nav-item[data-page="${id}"]`)?.classList.add('active');
  if (id === 'quote') buildQuote();
  if (id === 'history') renderHistory();
};

// ===== THEME =====
function applyTheme(t) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.className = dark ? 'theme-dark' : 'theme-light';
  document.getElementById('s-dark').checked = dark;
}
window.toggleDark = function(on) {
  document.body.className = on ? 'theme-dark' : 'theme-light';
};

// ===== DRAG & DROP — whole page, always active =====
let dragCounter = 0; // track enter/leave across child elements

window.pageOver = function(e) {
  e.preventDefault();
  dragCounter++;
  document.getElementById('drag-overlay').classList.add('active');
};

window.pageOut = function(e) {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    document.getElementById('drag-overlay').classList.remove('active');
  }
};

window.pageDrop = function(e) {
  e.preventDefault();
  dragCounter = 0;
  document.getElementById('drag-overlay').classList.remove('active');
  const files = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (files.length) loadFilesFromDrop(files);
};

// Keep old dzOver/dzOut/dzDrop for compatibility but they're no longer on the element
window.dzOver = function(e) { e.preventDefault(); };
window.dzOut = function(e) {};
window.dzDrop = function(e) { e.preventDefault(); };

async function loadFilesFromDrop(files) {
  for (const f of files) {
    const ab = await f.arrayBuffer();
    await processPdf({ buffer: ab, name: f.name, size: f.size });
  }
}

// ===== OPEN PDF =====
window.openPdfDialog = async function() {
  const results = await window.api.openPdfDialog();
  if (!results || !results.length) return;
  for (const result of results) {
    await processPdf(result);
  }
};

// ===== PROCESS PDF =====
async function processPdf({ buffer, name, size }) {
  // Show progress
  document.getElementById('drop-zone').style.display = 'none';
  document.getElementById('scan-results').style.display = 'none';
  document.getElementById('scan-progress').style.display = 'block';
  document.getElementById('scan-file-info').innerHTML = `
    <div class="scan-file-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
    <div><div class="scan-file-name">${name}</div><div class="scan-file-size">${(size/1024/1024).toFixed(2)} MB — Analyzing...</div></div>`;

  setProgress(5, 'Loading PDF...');

  try {
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const total = pdf.numPages;
    setProgress(15, `Found ${total} page${total>1?'s':''}. Analyzing...`);

    const canvas = document.getElementById('offscreen-canvas');
    const ctx = canvas.getContext('2d');
    const pages = [];

    for (let p = 1; p <= total; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 0.8 });
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const colored = detectColor(imgData);

      const rawVp = page.getViewport({ scale: 1 });
      const sizeKey = detectSize(rawVp.width, rawVp.height);

      const tVp = page.getViewport({ scale: 0.35 });
      const tc = document.createElement('canvas');
      tc.width = tVp.width; tc.height = tVp.height;
      await page.render({ canvasContext: tc.getContext('2d'), viewport: tVp }).promise;
      const thumb = tc.toDataURL('image/jpeg', 0.85);

      const fVp = page.getViewport({ scale: 1.2 });
      const fc = document.createElement('canvas');
      fc.width = fVp.width; fc.height = fVp.height;
      await page.render({ canvasContext: fc.getContext('2d'), viewport: fVp }).promise;
      const full = fc.toDataURL('image/jpeg', 0.92);

      const cost = getPageCost(colored, sizeKey);
      pages.push({ num: p, colored, colorOverride: null, included: true, sizeKey, cost, thumb, full });

      const pct = 15 + Math.round((p / total) * 82);
      setProgress(pct, `Page ${p} of ${total} — ${colored ? '🎨 Color' : '⬛ B&W'}`);
    }

    setProgress(100, 'Done!');

    // Normalize buffer — IPC may return a plain object, drag-drop gives real ArrayBuffer
    let pdfBuffer = buffer;
    if (!(buffer instanceof ArrayBuffer)) {
      // Convert plain object / Buffer-like back to ArrayBuffer
      pdfBuffer = new Uint8Array(Object.values(buffer)).buffer;
    }

    // Add to pdfs list
    const pdfId = Date.now() + Math.random();
    state.pdfs.push({ id: pdfId, fileName: name, fileSize: size, pdfBuffer, pages });
    state.activePdfId = pdfId;

    setTimeout(() => renderResults(), 300);
  } catch (err) {
    setProgress(0, 'Error: ' + err.message);
    toast('Failed to read PDF: ' + err.message);
  }
}

function setProgress(pct, msg) {
  document.getElementById('prog-fill').style.width = pct + '%';
  document.getElementById('prog-label').textContent = msg;
}

// ===== COLOR DETECTION =====
function detectColor(imgData) {
  const d = imgData.data;
  let colorPx = 0, total = 0;
  const step = 8;
  // Sensitivity 1-10: higher = lower thresholds = more sensitive (more pages flagged as color)
  const sens = state.settings.colorSensitivity || 5;
  const satThreshold = 0.14 - (sens * 0.01);   // range ~0.04–0.13
  const ratioThreshold = 0.025 - (sens * 0.002); // range ~0.005–0.023

  for (let i = 0; i < d.length; i += 4 * step) {
    const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
    if (a < 30) continue;
    if (r > 230 && g > 230 && b > 230) continue; // skip white paper
    if (r < 40 && g < 40 && b < 40) continue;    // skip pure black text
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat > satThreshold && max > 20) colorPx++;
    total++;
  }
  return total > 0 && (colorPx / total) > ratioThreshold;
}

// ===== SIZE DETECTION =====
function detectSize(wPt, hPt) {
  const wi = wPt / 72, hi = hPt / 72;
  const shortIn = Math.min(wi, hi), longIn = Math.max(wi, hi);
  // A3 / Tabloid
  if (longIn >= 16.4) return 'a3';
  // Legal
  if (longIn >= 13.4 && shortIn >= 8.0) return 'legal';
  // A4 vs Letter — A4 is 8.27 x 11.69 in, Letter is 8.5 x 11 in
  const wIn = wPt / 72, hIn = hPt / 72;
  const longSide = Math.max(wIn, hIn);
  // A4 long side ~11.69, Letter ~11.0 — use 11.35 as divider
  if (longSide > 11.35) return 'a4';
  return 'letter';
}
function sizeName(k) {
  return { letter: 'Letter', legal: 'Legal', a3: 'A3', a4: 'A4' }[k] || 'Letter';
}

// ===== COST =====
function effectiveColor(p) {
  return p.colorOverride !== null ? p.colorOverride : p.colored;
}

function getPageCost(colored, sizeKey) {
  const src = colored ? state.pricing.color : state.pricing.bw;
  return src[sizeKey] ?? src.letter ?? 0;
}

function totalCost() {
  return state.pages.reduce((s, p) => s + p.cost, 0) * state.copies;
}

// ===== RENDER RESULTS =====
function renderResults() {
  document.getElementById('scan-progress').style.display = 'none';
  document.getElementById('drop-zone').style.display = 'none';
  document.getElementById('scan-results').style.display = 'block';
  document.getElementById('add-pdf-btn').style.display = 'inline-flex';
  document.getElementById('open-btn').style.display = 'none';

  renderPdfTabs();
  renderMetrics();
  renderTable();
  updateTotalBar();
}

function renderPdfTabs() {
  const tabs = document.getElementById('pdf-tabs');
  tabs.innerHTML = state.pdfs.map(pdf => `
    <div class="pdf-tab ${pdf.id === state.activePdfId ? 'active' : ''}" onclick="switchPdfTab(${pdf.id})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="pdf-tab-name">${pdf.fileName}</span>
      <span class="pdf-tab-count">${pdf.pages.length}pg</span>
      <button class="pdf-tab-close" onclick="removePdf(${pdf.id}, event)" title="Remove this PDF">×</button>
    </div>`).join('');
}

window.switchPdfTab = function(id) {
  state.activePdfId = id;
  renderPdfTabs();
  renderMetrics();
  renderTable();
};

window.removePdf = function(id, e) {
  e.stopPropagation();
  state.pdfs = state.pdfs.filter(p => p.id !== id);
  if (!state.pdfs.length) { resetScan(); return; }
  if (state.activePdfId === id) state.activePdfId = state.pdfs[0].id;
  renderResults();
};

function renderMetrics() {
  const pdf = activePdf();
  if (!pdf) return;
  const pages = pdf.pages;
  const included = pages.filter(p => p.included);
  const colorPgs = included.filter(p => effectiveColor(p)).length;
  const bwPgs = included.length - colorPgs;
  const cur = state.currency;
  const total = included.reduce((s, p) => s + getPageCost(effectiveColor(p), p.sizeKey), 0) * state.copies;

  document.getElementById('metrics-row').innerHTML = `
    <div class="metric-card"><div class="metric-label">Total Pages</div><div class="metric-value">${pages.length}</div><div class="metric-sub">${included.length} included</div></div>
    <div class="metric-card"><div class="metric-label">Color Pages</div><div class="metric-value">${colorPgs}</div><div class="metric-sub">${included.length ? Math.round(colorPgs/included.length*100) : 0}% of included</div></div>
    <div class="metric-card"><div class="metric-label">B&W Pages</div><div class="metric-value">${bwPgs}</div><div class="metric-sub">${included.length ? Math.round(bwPgs/included.length*100) : 0}% of included</div></div>
    <div class="metric-card"><div class="metric-label">Est. Total</div><div class="metric-value">${cur}${total.toFixed(2)}</div><div class="metric-sub">${state.copies} cop${state.copies===1?'y':'ies'}</div></div>`;
  document.getElementById('results-file').innerHTML = `📄 ${pdf.fileName} — ${(pdf.fileSize/1024/1024).toFixed(2)} MB`;
}

function renderTable() {
  const cur = state.currency;
  const pdf = activePdf();
  if (!pdf) return;
  document.getElementById('page-tbody').innerHTML = pdf.pages.map((p, i) => {
    const isColor = effectiveColor(p);
    const isOverridden = p.colorOverride !== null;
    const excluded = !p.included;
    return `
    <tr class="${excluded ? 'row-excluded' : ''}">
      <td style="color:var(--text-secondary);font-size:12px;">${p.num}</td>
      <td>
        <div class="thumb-cell" onclick="openPreview(${i})" title="Click to preview">
          <img src="${p.thumb}" alt="p${p.num}" style="${excluded ? 'opacity:0.35' : ''}">
          <div class="thumb-overlay">🔍</div>
        </div>
      </td>
      <td>
        <label class="include-toggle" title="${excluded ? 'Excluded from print' : 'Included in print'}">
          <input type="checkbox" ${p.included ? 'checked' : ''} onchange="toggleInclude(${i}, this.checked)">
          <span class="include-slider"></span>
        </label>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;${excluded ? 'opacity:0.4' : ''}">
          <span class="badge ${isColor ? 'badge-color' : 'badge-bw'}">
            <span class="dot-c" style="background:${isColor ? '#c0392b' : '#888'}"></span>
            ${isColor ? 'Color' : 'B&W'}
          </span>
          ${isOverridden ? `<span style="font-size:10px;color:var(--text-secondary);font-style:italic;">override</span>` : ''}
        </div>
        <div style="margin-top:5px;display:flex;gap:4px;${excluded ? 'opacity:0.4' : ''}">
          <button class="color-ovr-btn ${!isColor ? 'active-bw' : ''}" onclick="setColorOverride(${i}, false)">B&W</button>
          <button class="color-ovr-btn ${isColor ? 'active-color' : ''}" onclick="setColorOverride(${i}, true)">Color</button>
          ${isOverridden ? `<button class="color-ovr-btn reset-btn" onclick="setColorOverride(${i}, null)">Auto</button>` : ''}
        </div>
      </td>
      <td style="${excluded ? 'opacity:0.4' : ''}"><span class="badge badge-size">${sizeName(p.sizeKey)}</span></td>
      <td style="${excluded ? 'opacity:0.4' : ''}">
        <select class="size-sel" onchange="overrideSize(${i}, this.value)" ${excluded ? 'disabled' : ''}>
          <option value="letter" ${p.sizeKey==='letter'?'selected':''}>Letter</option>
          <option value="a4" ${p.sizeKey==='a4'?'selected':''}>A4</option>
          <option value="legal" ${p.sizeKey==='legal'?'selected':''}>Legal</option>
          <option value="a3" ${p.sizeKey==='a3'?'selected':''}>A3</option>
        </select>
      </td>
      <td style="color:var(--text-secondary);font-size:12px;${excluded ? 'opacity:0.4' : ''}">${cur}${getPageCost(isColor, p.sizeKey).toFixed(2)}/pg</td>
      <td style="text-align:right;font-weight:500;${excluded ? 'opacity:0.4;text-decoration:line-through' : ''}">${excluded ? '—' : cur+p.cost.toFixed(2)}</td>
    </tr>`;
  }).join('');
}

function updateTotalBar() {
  const cur = state.currency;
  const copies = state.copies;
  // Sum across ALL PDFs, included pages only
  const includedPages = allPages().filter(p => p.included);
  const total = includedPages.reduce((s,p) => s + getPageCost(effectiveColor(p), p.sizeKey), 0) * copies;
  const colorCount = includedPages.filter(p => effectiveColor(p)).length;
  const pdf = activePdf();
  const pdfIncluded = pdf ? pdf.pages.filter(p=>p.included).length : 0;
  document.getElementById('total-summary').textContent =
    `${pdfIncluded} of ${pdf?.pages.length||0} pages included · ${colorCount} color · ${includedPages.length - colorCount} B&W · ${copies} cop${copies===1?'y':'ies'}`;
  document.getElementById('grand-total').textContent = `${cur}${total.toFixed(2)}`;
  // Update metric card
  const mv = document.querySelector('.metric-card:last-child .metric-value');
  if (mv) mv.textContent = `${cur}${total.toFixed(2)}`;
  const ms = document.querySelector('.metric-card:last-child .metric-sub');
  if (ms) ms.textContent = `${copies} cop${copies===1?'y':'ies'}`;
}

window.toggleInclude = function(idx, val) {
  const pdf = activePdf(); if (!pdf) return;
  pdf.pages[idx].included = val;
  renderTable();
  renderMetrics();
  updateTotalBar();
};

window.overrideSize = function(idx, newSize) {
  const pdf = activePdf(); if (!pdf) return;
  pdf.pages[idx].sizeKey = newSize;
  const isColor = effectiveColor(pdf.pages[idx]);
  pdf.pages[idx].cost = getPageCost(isColor, newSize);
  renderTable();
  updateTotalBar();
};

window.setColorOverride = function(idx, val) {
  const pdf = activePdf(); if (!pdf) return;
  pdf.pages[idx].colorOverride = val;
  const isColor = effectiveColor(pdf.pages[idx]);
  pdf.pages[idx].cost = getPageCost(isColor, pdf.pages[idx].sizeKey);
  renderTable();
  updateTotalBar();
};

// ===== PRINT PDF =====
window.printPdf = async function() {
  const pdf = activePdf();
  if (!pdf) { toast('No PDF loaded.'); return; }
  toast('Opening PDF for printing...');
  // Send as Uint8Array — ArrayBuffer doesn't serialize correctly over Electron IPC
  const u8 = new Uint8Array(pdf.pdfBuffer);
  const result = await window.api.printPdf(u8, pdf.fileName);
  if (result && !result.ok) {
    toast('Print error: ' + result.error);
  }
};

window.recalcCopies = function() {
  state.copies = Math.max(1, parseInt(document.getElementById('copies-input').value) || 1);
  renderMetrics();
  updateTotalBar();
};

window.resetScan = function() {
  state.pdfs = [];
  state.activePdfId = null;
  state.copies = 1;
  document.getElementById('copies-input').value = 1;
  document.getElementById('drop-zone').style.display = 'block';
  document.getElementById('scan-progress').style.display = 'none';
  document.getElementById('scan-results').style.display = 'none';
  document.getElementById('add-pdf-btn').style.display = 'none';
  document.getElementById('open-btn').style.display = 'inline-flex';
};

// ===== QUOTE =====
function buildQuote() {
  const included = allPages().filter(p => p.included);
  const hasData = included.length > 0;
  document.getElementById('quote-empty').style.display = hasData ? 'none' : 'flex';
  document.getElementById('quote-content').style.display = hasData ? 'block' : 'none';
  if (!hasData) return;

  const s = state.settings;
  const cur = state.currency;
  const copies = state.copies;
  const fileNames = state.pdfs.map(p => p.fileName).join(', ');
  const totalPages = included.length;

  document.getElementById('q-biz-name').textContent = s.businessName || 'My Print Shop';
  document.getElementById('q-biz-meta').innerHTML = [s.address, s.contact].filter(Boolean).join('<br>');
  document.getElementById('q-ref').textContent = 'Ref: PM-' + Date.now().toString().slice(-6);
  document.getElementById('q-date').textContent = new Date().toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
  document.getElementById('q-file-row').innerHTML =
    `<strong>Document${state.pdfs.length > 1 ? 's' : ''}:</strong> ${fileNames} &nbsp;·&nbsp; ${totalPages} page${totalPages!==1?'s':''} &nbsp;·&nbsp; ${copies} cop${copies===1?'y':'ies'}`;

  const groups = {};
  included.forEach(p => {
    const isColor = effectiveColor(p);
    const k = `${isColor?'color':'bw'}|${p.sizeKey}`;
    if (!groups[k]) groups[k] = { colored: isColor, sizeKey: p.sizeKey, count: 0, unitCost: getPageCost(isColor, p.sizeKey) };
    groups[k].count++;
  });

  let subtotal = 0;
  const rows = Object.values(groups).map(g => {
    const lineTotal = g.unitCost * g.count * copies;
    subtotal += lineTotal;
    return `<tr>
      <td>${g.colored ? '🎨 Color' : '⬛ B&W'} — ${sizeName(g.sizeKey)} × ${g.count} page${g.count>1?'s':''} × ${copies} cop${copies===1?'y':'ies'}</td>
      <td>${cur}${g.unitCost.toFixed(2)}</td>
      <td>${g.count * copies}</td>
      <td style="text-align:right;">${cur}${lineTotal.toFixed(2)}</td>
    </tr>`;
  });
  document.getElementById('q-tbody').innerHTML = rows.join('');

  const showTax = s.showTax;
  const taxRate = parseFloat(s.taxRate) || 0;
  const tax = showTax ? subtotal * (taxRate/100) : 0;
  const grand = subtotal + tax;

  let totalsHtml = `<div class="quote-total-row"><span>Subtotal</span><span>${cur}${subtotal.toFixed(2)}</span></div>`;
  if (showTax) totalsHtml += `<div class="quote-total-row"><span>Tax (${taxRate}%)</span><span>${cur}${tax.toFixed(2)}</span></div>`;
  totalsHtml += `<div class="quote-total-row grand"><span>TOTAL</span><span>${cur}${grand.toFixed(2)}</span></div>`;
  document.getElementById('q-totals').innerHTML = totalsHtml;
}

window.saveJobFromQuote = async function() {
  const included = allPages().filter(p => p.included);
  if (!included.length) return;
  const total = included.reduce((s,p) => s + getPageCost(effectiveColor(p), p.sizeKey), 0) * state.copies;
  await window.api.saveJob({
    fileName: state.pdfs.map(p => p.fileName).join(', '),
    pages: included.length,
    colorPages: included.filter(p => effectiveColor(p)).length,
    copies: state.copies,
    total,
    currency: state.currency
  });
  toast('Job saved to history!');
  renderHistory();
};

// ===== HISTORY =====
async function renderHistory() {
  const history = (await window.api.getStore('jobHistory')) || [];
  const el = document.getElementById('history-list');
  const cur = state.currency;
  if (!history.length) {
    el.innerHTML = `<div class="empty-state" style="margin-top:3rem;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="40" height="40"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <p>No jobs saved yet.</p></div>`;
    return;
  }
  el.innerHTML = history.map(j => `
    <div class="history-item">
      <div class="history-item-left">
        <div class="history-file">📄 ${j.fileName || 'Unknown'}</div>
        <div class="history-meta">${j.pages} pages · ${j.colorPages} color · ${j.copies} cop${j.copies===1?'y':'ies'} · ${new Date(j.date).toLocaleDateString('en-PH', {month:'short',day:'numeric',year:'numeric'})}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="history-amount">${j.currency||cur}${parseFloat(j.total).toFixed(2)}</div>
        <button class="history-del" onclick="deleteJob(${j.id})" title="Delete">×</button>
      </div>
    </div>`).join('');
}

window.deleteJob = async function(id) {
  await window.api.deleteJob(id);
  renderHistory();
};

window.clearHistory = async function() {
  if (!confirm('Clear all job history? This cannot be undone.')) return;
  await window.api.setStore('jobHistory', []);
  renderHistory();
};

// ===== SETTINGS =====
function populateSettings(s) {
  document.getElementById('s-biz-name').value = s.businessName || '';
  document.getElementById('s-address').value = s.address || '';
  document.getElementById('s-contact').value = s.contact || '';
  document.getElementById('s-currency').value = s.currency || '₱';
  const p = s.pricing || state.pricing;
  document.getElementById('p-bw-letter').value = p.bw?.letter ?? 3;
  document.getElementById('p-bw-legal').value = p.bw?.legal ?? 4;
  document.getElementById('p-bw-a3').value = p.bw?.a3 ?? 6;
  document.getElementById('p-color-letter').value = p.color?.letter ?? 15;
  document.getElementById('p-color-legal').value = p.color?.legal ?? 20;
  document.getElementById('p-color-a3').value = p.color?.a3 ?? 30;
  document.getElementById('s-default-size').value = p.defaultSize || 'letter';
  document.getElementById('s-show-tax').checked = !!s.showTax;
  document.getElementById('tax-row').style.display = s.showTax ? 'flex' : 'none';
  document.getElementById('s-tax-rate').value = s.taxRate || 12;
  document.getElementById('s-color-sensitivity').value = s.colorSensitivity || 5;
  document.getElementById('s-dark').checked = s.theme === 'dark';
  updateCurrencySymbols(s.currency || '₱');
}

function updateCurrencySymbols(sym) {
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById('cs'+i);
    if (el) el.textContent = sym;
  }
}

window.saveSettings = async function() {
  const pin = document.getElementById('s-pin').value;
  const pin2 = document.getElementById('s-pin2').value;

  if (pin || pin2) {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      document.getElementById('pin-status').textContent = '⚠ PIN must be exactly 4 digits.';
      document.getElementById('pin-status').style.color = 'var(--danger)';
      return;
    }
    if (pin !== pin2) {
      document.getElementById('pin-status').textContent = '⚠ PINs do not match.';
      document.getElementById('pin-status').style.color = 'var(--danger)';
      return;
    }
    // Simple hash
    let h = 0;
    for (let i = 0; i < pin.length; i++) h = Math.imul(31, h) + pin.charCodeAt(i) | 0;
    await window.api.setStore('pinHash', 'pm_' + Math.abs(h).toString(16).padStart(8,'0'));
    document.getElementById('pin-status').textContent = '✓ PIN saved.';
    document.getElementById('pin-status').style.color = 'var(--success)';
    document.getElementById('s-pin').value = '';
    document.getElementById('s-pin2').value = '';
  }

  const cur = document.getElementById('s-currency').value || '₱';
  const pricing = {
    bw: {
      letter: +document.getElementById('p-bw-letter').value,
      legal: +document.getElementById('p-bw-legal').value,
      a3: +document.getElementById('p-bw-a3').value
    },
    color: {
      letter: +document.getElementById('p-color-letter').value,
      legal: +document.getElementById('p-color-legal').value,
      a3: +document.getElementById('p-color-a3').value
    },
    defaultSize: document.getElementById('s-default-size').value
  };
  const bizName = document.getElementById('s-biz-name').value;
  const address = document.getElementById('s-address').value;
  const contact = document.getElementById('s-contact').value;
  const showTax = document.getElementById('s-show-tax').checked;
  const taxRate = +document.getElementById('s-tax-rate').value;
  const colorSensitivity = +document.getElementById('s-color-sensitivity').value;
  const theme = document.getElementById('s-dark').checked ? 'dark' : 'light';

  await window.api.setStore('businessName', bizName);
  await window.api.setStore('address', address);
  await window.api.setStore('contact', contact);
  await window.api.setStore('currency', cur);
  await window.api.setStore('pricing', pricing);
  await window.api.setStore('showTax', showTax);
  await window.api.setStore('taxRate', taxRate);
  await window.api.setStore('colorSensitivity', colorSensitivity);
  await window.api.setStore('theme', theme);

  state.pricing = pricing;
  state.currency = cur;
  state.settings = { ...state.settings, businessName:bizName, address, contact, currency:cur, pricing, showTax, taxRate, colorSensitivity, theme };

  document.getElementById('sb-biz-name').textContent = bizName || 'My Print Shop';
  document.getElementById('sb-biz-contact').textContent = contact || '';
  updateCurrencySymbols(cur);
  applyTheme(theme);
  toast('Settings saved!');
};

window.clearPin = async function() {
  if (!confirm('Remove PIN lock? The app will no longer require a PIN on startup.')) return;
  await window.api.setStore('pinHash', '');
  document.getElementById('pin-status').textContent = '✓ PIN removed.';
  document.getElementById('pin-status').style.color = 'var(--success)';
};

// ===== PAGE PREVIEW MODAL =====
let previewIdx = 0;

window.openPreview = function(idx) {
  previewIdx = idx;
  showPreview();
  document.getElementById('preview-modal').style.display = 'flex';
};

window.closePreview = function() {
  document.getElementById('preview-modal').style.display = 'none';
};

window.shiftPreview = function(dir) {
  const pages = activePdf()?.pages || [];
  previewIdx = Math.max(0, Math.min(pages.length - 1, previewIdx + dir));
  showPreview();
};

function showPreview() {
  const pages = activePdf()?.pages || [];
  const p = pages[previewIdx];
  if (!p) return;
  document.getElementById('preview-img').src = p.full || p.thumb;
  const isColor = effectiveColor(p);
  document.getElementById('preview-label').innerHTML =
    `Page ${p.num} of ${pages.length} &nbsp;·&nbsp;
     <span class="badge ${isColor ? 'badge-color' : 'badge-bw'}" style="font-size:12px;">
       ${isColor ? '🎨 Color' : '⬛ B&W'}
     </span> &nbsp;·&nbsp; ${sizeName(p.sizeKey)}`;
  document.getElementById('prev-pg').disabled = previewIdx === 0;
  document.getElementById('next-pg').disabled = previewIdx === pages.length - 1;
}

// keyboard nav for preview
document.addEventListener('keydown', e => {
  if (document.getElementById('preview-modal').style.display === 'flex') {
    if (e.key === 'ArrowLeft') shiftPreview(-1);
    if (e.key === 'ArrowRight') shiftPreview(1);
    if (e.key === 'Escape') closePreview();
  }
});

// ===== ABOUT =====
window.closeAbout = function() { document.getElementById('about-modal').style.display='none'; };

// ===== TOAST =====
window.toast = function(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
};

init();
