// SIGNALS TAB
// ══════════════════════════════════════════════════
let sigZoneFilter = 'all';
let sigHideOwned  = false;

function setSigFilter(f) {
  sigZoneFilter = f;
  document.getElementById('sigZfAll').className   = 'zone-filter-btn' + (f==='all'  ? ' active-all'   : '');
  document.getElementById('sigZfBuy').className   = 'zone-filter-btn' + (f==='buy'  ? ' active-buy'   : '');
  document.getElementById('sigZfWatch').className = 'zone-filter-btn' + (f==='watch'? ' active-watch' : '');
  renderSignals();
}

function toggleSigHideOwned() {
  sigHideOwned = !sigHideOwned;
  const btn = document.getElementById('sigHideOwnedBtn');
  btn.className = 'zone-filter-btn full' + (sigHideOwned ? ' active-owned' : '');
  btn.textContent = sigHideOwned ? '✅ Hiding stocks I already own' : '👜 Hide stocks I already own';
  renderSignals();
}

function renderSignals() {
  const list = getWatchlist();
  const buyZonePct   = parseFloat(document.getElementById('buyZonePct')?.value  || 105);
  const watchZonePct = parseFloat(document.getElementById('watchZonePct')?.value || 110);
  const ownedSymbols = getOwnedSymbols();

  // Update price timestamp
  const wlUpdEl = document.getElementById('wlPriceUpdated');
  const sigUpdEl = document.getElementById('sigPriceUpdated');
  if (wlUpdEl && sigUpdEl) sigUpdEl.innerHTML = wlUpdEl.innerHTML;

  // Score all stocks
  let buyCount=0, watchCount=0, waitCount=0;
  const scored = list.map(sym => {
    const d = wlData[sym];
    if (!d || d.loading || d.error || !d.price) return { sym, d: d||{loading:true}, score:0, zone:'wait' };
    const cs = calcCombinedScore(d, buyZonePct, watchZonePct);
    const zone = cs ? cs.zone : 'wait';
    if (zone==='buy') buyCount++;
    else if (zone==='watch') watchCount++;
    else waitCount++;
    return { sym, d, score: cs?.score||0, zone, cs };
  });

  document.getElementById('sigSummaryGrid').innerHTML = `
    <div class="metric"><div class="metric-label">Total screened</div><div class="metric-val">${list.length}</div></div>
    <div class="metric"><div class="metric-label">🟢 Score ≥70</div><div class="metric-val c-sell">${buyCount}</div></div>
    <div class="metric"><div class="metric-label">🟡 Score ≥45</div><div class="metric-val c-warn">${watchCount}</div></div>
    <div class="metric"><div class="metric-label">⚪ Below 45</div><div class="metric-val c-wait">${waitCount}</div></div>`;

  // Sort by score descending
  scored.sort((a,b) => b.score - a.score);

  // Filter
  const filtered = scored.filter(item => {
    if (sigHideOwned && ownedSymbols.has(item.sym)) return false;
    if (sigZoneFilter === 'all') return true;
    return item.zone === sigZoneFilter;
  });

  const html = filtered.map(item =>
    combinedCardHtml(item.sym, item.d, buyZonePct, watchZonePct)
  ).join('');

  document.getElementById('sigArea').innerHTML = html || `<div class="no-data">No stocks match the current filters.</div>`;
}

// ══════════════════════════════════════════════════
// SIGNALS TAB
// ══════════════════════════════════════════════════
let signalFilter = 'all';
let hideOwnedSignals = false;

function setSignalFilter(f) {
  signalFilter = f;
  document.getElementById('sfAll').className   = 'zone-filter-btn' + (f==='all'?'   active-all':'');
  document.getElementById('sfBuy').className   = 'zone-filter-btn' + (f==='buy'?'   active-buy':'');
  document.getElementById('sfWatch').className = 'zone-filter-btn' + (f==='watch'?' active-watch':'');
  renderSignals();
}

function toggleHideOwnedSignals() {
  hideOwnedSignals = !hideOwnedSignals;
  const btn = document.getElementById('hideOwnedSignalsBtn');
  if (hideOwnedSignals) {
    btn.className = 'zone-filter-btn full active-owned';
    btn.textContent = '✅ Hiding stocks I already own';
  } else {
    btn.className = 'zone-filter-btn full';
    btn.textContent = '👜 Hide stocks I already own';
  }
  renderSignals();
}

function renderSignals() {
  const signalsArea = document.getElementById('signalsArea');
  const summaryGrid = document.getElementById('signalsSummaryGrid');
  if (!signalsArea || !summaryGrid) return;

  const list = getWatchlist();
  const buyZonePct   = parseFloat(document.getElementById('sigBuyZonePct')?.value)   || 105;
  const watchZonePct = parseFloat(document.getElementById('sigWatchZonePct')?.value) || 110;
  const ownedSymbols = getOwnedSymbols();

  // Update price updated label
  const wlPU = document.getElementById('wlPriceUpdated');
  const sigPU = document.getElementById('signalsPriceUpdated');
  if (wlPU && sigPU) sigPU.innerHTML = wlPU.innerHTML;

  // Score all stocks
  let buyCount=0, watchCount=0, waitCount=0;
  const scored = list.map(sym => {
    const d = wlData[sym];
    if (!d || d.loading || d.error || !d.price) return { sym, d: d||{loading:true}, score: -1, zone: 'wait' };
    const cs = calcCombinedScore(d, buyZonePct, watchZonePct);
    const score = cs ? cs.score : 0;
    const zone  = cs ? cs.zone  : 'wait';
    if (zone==='buy') buyCount++;
    else if (zone==='watch') watchCount++;
    else waitCount++;
    return { sym, d, score, zone, cs };
  }).sort((a,b) => b.score - a.score);

  summaryGrid.innerHTML = `
    <div class="metric"><div class="metric-label">Stocks tracked</div><div class="metric-val">${list.length}</div></div>
    <div class="metric"><div class="metric-label">🟢 Score ≥70</div><div class="metric-val c-sell">${buyCount}</div></div>
    <div class="metric"><div class="metric-label">🟡 Score ≥45</div><div class="metric-val c-warn">${watchCount}</div></div>
    <div class="metric"><div class="metric-label">⚪ Below 45</div><div class="metric-val c-wait">${waitCount}</div></div>`;

  const filtered = scored.filter(({ sym, zone }) => {
    if (hideOwnedSignals && ownedSymbols.has(sym)) return false;
    if (signalFilter === 'all') return true;
    return zone === signalFilter;
  });

  const html = filtered.map(({ sym, d, cs }) =>
    combinedCardHtml(sym, d, buyZonePct, watchZonePct)
  ).join('');

  signalsArea.innerHTML = html || `<div class="no-data">No stocks match the current filters.</div>`;
}

['sigBuyZonePct','sigWatchZonePct'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', renderSignals);
});

// ══════════════════════════════════════════════════