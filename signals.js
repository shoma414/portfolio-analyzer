// ══════════════════════════════════════════════════
// SIGNALS TAB
// ══════════════════════════════════════════════════
let signalFilter = 'all';
let hideOwnedSignals = false;

function setSignalFilter(f) {
  signalFilter = f;
  document.getElementById('sfAll').className   = 'zone-filter-btn' + (f==='all'  ? ' active-all'   : '');
  document.getElementById('sfBuy').className   = 'zone-filter-btn' + (f==='buy'  ? ' active-buy'   : '');
  document.getElementById('sfWatch').className = 'zone-filter-btn' + (f==='watch'? ' active-watch' : '');
  renderSignals();
}

function toggleHideOwnedSignals() {
  hideOwnedSignals = !hideOwnedSignals;
  const btn = document.getElementById('hideOwnedSignalsBtn');
  btn.className = 'zone-filter-btn full' + (hideOwnedSignals ? ' active-owned' : '');
  btn.textContent = hideOwnedSignals ? '✅ Hiding stocks I already own' : '👜 Hide stocks I already own';
  renderSignals();
}

function renderSignals() {
  const area = document.getElementById('sigArea');
  const grid = document.getElementById('sigSummaryGrid');
  if (!area || !grid) return;

  const list = getWatchlist();
  const buyZonePct   = parseFloat(document.getElementById('sigBuyZonePct')?.value)   || 105;
  const watchZonePct = parseFloat(document.getElementById('sigWatchZonePct')?.value) || 110;
  const ownedSymbols = getOwnedSymbols();

  // Sync price timestamp from watchlist tab
  const wlPU  = document.getElementById("wlPriceUpdated");
  const sigPU = document.getElementById("signalsPriceUpdated");
  if (wlPU && sigPU) sigPU.innerHTML = wlPU.innerHTML;

  // If wlData is empty, trigger a load first
  if (Object.keys(wlData).length === 0) {
    area.innerHTML = `<div class="no-data">Loading watchlist data...</div>`;
    refreshWatchlist();
    return;
  }

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
  }).sort((a,b) => b.score - a.score);

  grid.innerHTML = `
    <div class="metric"><div class="metric-label">Total screened</div><div class="metric-val">${list.length}</div></div>
    <div class="metric"><div class="metric-label">🟢 Score ≥70</div><div class="metric-val c-sell">${buyCount}</div></div>
    <div class="metric"><div class="metric-label">🟡 Score ≥45</div><div class="metric-val c-warn">${watchCount}</div></div>
    <div class="metric"><div class="metric-label">⚪ Below 45</div><div class="metric-val c-wait">${waitCount}</div></div>`;

  const filtered = scored.filter(({ sym, zone }) => {
    if (hideOwnedSignals && ownedSymbols.has(sym)) return false;
    if (signalFilter === 'all') return true;
    return zone === signalFilter;
  });

  area.innerHTML = filtered.map(({ sym, d }) =>
    combinedCardHtml(sym, d, buyZonePct, watchZonePct)
  ).join('') || `<div class="no-data">No stocks match the current filters.</div>`;
}

['sigBuyZonePct','sigWatchZonePct'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', renderSignals);
});
