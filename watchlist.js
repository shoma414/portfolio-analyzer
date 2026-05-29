// WATCHLIST TAB
// ══════════════════════════════════════════════════
function getWatchlist() {
  try {
    const saved = localStorage.getItem(WL_KEY);
    return saved ? JSON.parse(saved) : [...DEFAULT_WATCHLIST];
  } catch(e) { return [...DEFAULT_WATCHLIST]; }
}

function saveWatchlist(list) {
  try { localStorage.setItem(WL_KEY, JSON.stringify(list)); } catch(e) {}
}

function addWatchlistSymbol() {
  const input = document.getElementById('wlAddInput');
  const sym = input.value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g,'');
  if (!sym) return;
  const list = getWatchlist();
  if (list.includes(sym)) { input.value=''; return; }
  list.push(sym);
  saveWatchlist(list);
  input.value='';
  wlData[sym] = { loading: true };
  renderWatchlist();
  fetchWatchlistPrices([sym]);
}

function removeWatchlistSymbol(sym) {
  const list = getWatchlist().filter(s => s !== sym);
  saveWatchlist(list);
  delete wlData[sym];
  renderWatchlist();
}

function getOwnedSymbols() {
  // Extract unique symbols from the loaded lots CSV
  return new Set(allRows.map(r => r.Symbol).filter(Boolean));
}

function toggleHideOwned() {
  hideOwned = !hideOwned;
  const btn = document.getElementById('hideOwnedBtn');
  if (hideOwned) {
    btn.className = 'zone-filter-btn full active-owned';
    btn.textContent = '✅ Hiding stocks I already own';
  } else {
    btn.className = 'zone-filter-btn full';
    btn.textContent = '👜 Hide stocks I already own';
  }
  renderWatchlist();
}

function setZoneFilter(f) {
  zoneFilter = f;
  document.getElementById('zfAll').className   = 'zone-filter-btn' + (f==='all'?'   active-all':'');
  document.getElementById('zfBuy').className   = 'zone-filter-btn' + (f==='buy'?'   active-buy':'');
  document.getElementById('zfWatch').className = 'zone-filter-btn' + (f==='watch'?' active-watch':'');
  renderWatchlist();
  if (currentTab === 'signals') renderSignals();
  if (currentTab === 'support') renderSupport();
}

async function refreshWatchlist() {
  const list = getWatchlist();
  document.getElementById('wlPriceUpdated').textContent = 'Fetching prices...';
  wlData = {};
  list.forEach(s => wlData[s] = { loading: true });
  renderWatchlist();
  await fetchWatchlistPrices(list);
}

async function fetchWatchlistPrices(symbols) {
  try {
    const res = await fetch(WATCHLIST_URL + "?t=" + Date.now());
    if (!res.ok) throw new Error("watchlist.json not found");
    const data = await res.json();
    if (!data.data || !Object.keys(data.data).length) throw new Error("Empty watchlist data");

    // Merge fetched data into wlData
    const list = getWatchlist();
    list.forEach(sym => {
      const key = sym === 'BTC' ? 'BTC-USD' : sym;
      const d = data.data[key] || data.data[sym];
      if (d && d.price) {
        wlData[sym] = {
          // Price & range
          price:          d.price,
          low52:          d.low52          || 0,
          high52:         d.high52         || 0,
          name:           d.name           || sym,
          sector:         d.sector         || '',
          // Technical
          rsi:            d.rsi            ?? null,
          ma20:           d.ma20           || null,
          ma50:           d.ma50           || null,
          ma200:          d.ma200          || null,
          bbUpper:        d.bbUpper        || null,
          bbLower:        d.bbLower        || null,
          bbMid:          d.bbMid          || null,
          maCross:        d.maCross        || null,
          // Business Quality
          revenueGrowth:  d.revenueGrowth  ?? null,
          epsGrowth:      d.epsGrowth      ?? null,
          roe:            d.roe            ?? null,
          netDebtEbitda:  d.netDebtEbitda  ?? null,
          // Valuation
          forwardPE:      d.forwardPE      ?? null,
          trailingPE:     d.trailingPE     ?? null,
          fcfYield:       d.fcfYield       ?? null,
          evEbitda:       d.evEbitda       ?? null,
          sectorEvEbitda: d.sectorEvEbitda ?? null,
          // Shareholder Return
          divYield:       d.divYield       ?? null,
          payoutRatio:    d.payoutRatio    ?? null,
          // Halal
          debtToAssets:   d.debtToAssets   ?? null,
          interestPct:    d.interestPct    ?? null,
          loading: false
        };
      } else {
        wlData[sym] = { loading: false, error: true };
      }
    });

    document.getElementById('wlPriceUpdated').innerHTML =
      `<span class="live-dot"></span>Watchlist prices last updated: ${toUAETime(data.last_updated)}`;
  } catch(e) {
    console.error('Watchlist fetch error:', e);
    const list = getWatchlist();
    list.forEach(sym => { if (wlData[sym]?.loading) wlData[sym] = { loading: false, error: true }; });
    document.getElementById('wlPriceUpdated').textContent =
      "⚠ Could not load prices — run workflow manually to generate watchlist.json";
  }
  renderWatchlist();
  if (currentTab === 'signals') renderSignals();
  if (currentTab === 'support') renderSupport();
}

function getZone(price, low52, buyZonePct, watchZonePct) {
  const buyThreshold   = low52 * (buyZonePct / 100);
  const watchThreshold = low52 * (watchZonePct / 100);
  if (price <= buyThreshold)   return 'buy';
  if (price <= watchThreshold) return 'watch';
  return 'wait';
}

function wlCardHtml(sym, d, buyZonePct, watchZonePct) {
  if (d.loading) return `<div class="wl-card loading"><div class="wl-top"><div class="wl-sym">${sym}</div></div><div style="font-size:12px;color:#aaa">Loading...</div></div>`;
  if (d.error)   return `<div class="wl-card zone-wait"><div class="wl-top"><div><div class="wl-sym">${sym}</div></div><button class="remove-btn" onclick="removeWatchlistSymbol('${sym}')">✕ Remove</button></div><div style="font-size:12px;color:#aaa">Could not load price</div></div>`;

  const zone = getZone(d.price, d.low52, buyZonePct, watchZonePct);
  const buyThreshold   = d.low52 * (buyZonePct / 100);
  const watchThreshold = d.low52 * (watchZonePct / 100);
  const distPct = ((d.price - d.low52) / d.low52 * 100).toFixed(1);
  const distToBuy = ((d.price - buyThreshold) / buyThreshold * 100).toFixed(1);

  let badgeClass='badge-zone-wait', badgeLabel='⚪ Wait', cardClass='wl-card zone-wait';
  if (zone==='buy')  { badgeClass='badge-zone-buy';  badgeLabel='🟢 Buy zone';  cardClass='wl-card zone-buy'; }
  if (zone==='watch'){ badgeClass='badge-zone-watch'; badgeLabel='🟡 Watch';     cardClass='wl-card zone-watch'; }

  return `<div class="${cardClass}">
    <div class="wl-top">
      <div>
        <div class="wl-sym">${sym}</div>
        <div style="font-size:11px;color:#aaa;margin-top:2px">${d.name||''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="badge ${badgeClass}">${badgeLabel}</span>
        <button class="remove-btn" onclick="removeWatchlistSymbol('${sym}')">✕</button>
      </div>
    </div>
    <div class="wl-grid">
      <div class="lot-field"><span class="lot-field-label">Current price</span><span class="lot-field-val">$${d.price.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">52W low</span><span class="lot-field-val">$${d.low52.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">52W high</span><span class="lot-field-val">$${d.high52.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Above 52W low</span><span class="lot-field-val ${distPct<=10?'pos':'neg'}">+${distPct}%</span></div>
      <div class="lot-field"><span class="lot-field-label">🟢 Buy trigger ≤</span><span class="lot-field-val">$${buyThreshold.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">🟡 Watch trigger ≤</span><span class="lot-field-val">$${watchThreshold.toFixed(2)}</span></div>
    </div>
    ${zone!=='buy'?`<div class="lot-note">${distToBuy>0?`$${(d.price-buyThreshold).toFixed(2)} (${distToBuy}%) above buy zone`:`In buy zone!`}</div>`:'<div class="lot-note">✅ Price is in the buy zone — consider buying</div>'}
  </div>`;
}

function renderWatchlist() {
  const list = getWatchlist();
  const buyZonePct   = parseFloat(document.getElementById('buyZonePct').value)   || 105;
  const watchZonePct = parseFloat(document.getElementById('watchZonePct').value) || 110;
  const ownedSymbols = getOwnedSymbols();

  // Sync signals tab price timestamp if it exists
  try {
    const sigUpd = document.getElementById('sigPriceUpdated');
    const wlUpd  = document.getElementById('wlPriceUpdated');
    if (sigUpd && wlUpd) sigUpd.innerHTML = wlUpd.innerHTML;
  } catch(e) {}

  // Count zones
  let buyCount=0, watchCount=0, waitCount=0;
  list.forEach(sym => {
    const d = wlData[sym];
    if (!d || d.loading || d.error || !d.price) return;
    let z;
    z = getZone(d.price, d.low52, buyZonePct, watchZonePct);
    if (z==='buy') buyCount++;
    else if (z==='watch') watchCount++;
    else waitCount++;
  });

  const stratLabel = '🟢 Buy zone';
  document.getElementById('wlSummaryGrid').innerHTML = `
    <div class="metric"><div class="metric-label">Watchlist total</div><div class="metric-val">${list.length}</div></div>
    <div class="metric"><div class="metric-label">${stratLabel}</div><div class="metric-val c-sell">${buyCount}</div></div>
    <div class="metric"><div class="metric-label">🟡 Watch zone</div><div class="metric-val c-warn">${watchCount}</div></div>
    <div class="metric"><div class="metric-label">⚪ Wait</div><div class="metric-val c-wait">${waitCount}</div></div>`;

  // Sort
  const zoneOrder = { buy:0, watch:1, wait:2 };
  const sorted = [...list].sort((a,b) => {
    const da=wlData[a], db=wlData[b];
    if (!da||da.loading) return 1; if (!db||db.loading) return -1;
    if (da.error) return 1; if (db.error) return -1;
    const za=getZone(da.price,da.low52,buyZonePct,watchZonePct);
      const zb=getZone(db.price,db.low52,buyZonePct,watchZonePct);
      if (zoneOrder[za]!==zoneOrder[zb]) return zoneOrder[za]-zoneOrder[zb];
      return ((da.price-da.low52)/da.low52) - ((db.price-db.low52)/db.low52);
  });

  // Filter
  const filtered = sorted.filter(sym => {
    if (hideOwned && ownedSymbols.has(sym)) return false;
    const d = wlData[sym];
    if (!d || d.loading || d.error) return zoneFilter === 'all';
    if (zoneFilter === 'all') return true;
    let z;
    z = getZone(d.price, d.low52, buyZonePct, watchZonePct);
    return z === zoneFilter;
  });

  const html = filtered.map(sym => wlCardHtml(sym, wlData[sym]||{loading:true}, buyZonePct, watchZonePct)).join('');
  document.getElementById('wlArea').innerHTML = html || `<div class="no-data">No stocks match the current filters.</div>`;
}

function combinedCardHtml(sym, d, buyZonePct, watchZonePct) {
  if (d.loading) return `<div class="wl-card loading"><div class="wl-top"><div class="wl-sym">${sym}</div></div><div style="font-size:12px;color:#aaa">Loading...</div></div>`;
  if (d.error || !d.price) return `<div class="wl-card zone-wait"><div class="wl-top"><div><div class="wl-sym">${sym}</div></div><button class="remove-btn" onclick="removeWatchlistSymbol('${sym}')">✕</button></div><div style="font-size:12px;color:#aaa">Could not load price</div></div>`;

  const cs = calcCombinedScore(d, buyZonePct, watchZonePct);
  if (!cs) return wlCardHtml(sym, d, buyZonePct, watchZonePct);

  const { score, zone, signals } = cs;
  const scoreColor = score >= 70 ? '#2d7a2d' : score >= 45 ? '#a06000' : '#888';
  const badgeClass = zone==='buy' ? 'badge-zone-buy' : zone==='watch' ? 'badge-zone-watch' : 'badge-zone-wait';
  const badgeLabel = zone==='buy' ? '🟢 Buy' : zone==='watch' ? '🟡 Watch' : '⚪ Wait';
  const ratingClass = r => r==='green'?'sig-green':r==='yellow'?'sig-yellow':r==='red'?'sig-red':'sig-grey';

  const signalsHtml = signals.map(s => `
    <div class="signal-row"><span>${s.label}</span><span class="signal-badge ${ratingClass(s.rating)}">${s.note}</span></div>`).join('');

  return `<div class="wl-card zone-${zone}">
    <div class="wl-top">
      <div><div class="wl-sym">${sym}</div><div style="font-size:11px;color:#aaa;margin-top:2px">${d.name||''}</div></div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="text-align:right">
          <div style="font-size:22px;font-weight:700;color:${scoreColor}">${score}</div>
          <div style="font-size:10px;color:#aaa">/100</div>
        </div>
        <span class="badge ${badgeClass}">${badgeLabel}</span>
        <button class="remove-btn" onclick="removeWatchlistSymbol('${sym}')">✕</button>
      </div>
    </div>
    <div class="score-bar-wrap" style="margin-bottom:10px">
      <div class="score-bar-fill" style="width:${score}%;background:${scoreColor}"></div>
    </div>
    <div class="lot-grid" style="margin-bottom:10px">
      <div class="lot-field"><span class="lot-field-label">Price</span><span class="lot-field-val">$${d.price.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">RSI (14)</span><span class="lot-field-val ${d.rsi<30?'pos':d.rsi>70?'neg':''}">${d.rsi ?? '—'}</span></div>
      <div class="lot-field"><span class="lot-field-label">MA50</span><span class="lot-field-val">${d.ma50 ? '$'+d.ma50.toFixed(2) : '—'}</span></div>
      <div class="lot-field"><span class="lot-field-label">MA200</span><span class="lot-field-val">${d.ma200 ? '$'+d.ma200.toFixed(2) : '—'}</span></div>
      <div class="lot-field"><span class="lot-field-label">52W Low</span><span class="lot-field-val">${d.low52 ? '$'+d.low52.toFixed(2) : '—'}</span></div>
      <div class="lot-field"><span class="lot-field-label">BB Lower</span><span class="lot-field-val">${d.bbLower ? '$'+d.bbLower.toFixed(2) : '—'}</span></div>
    </div>
    <div style="border-top:1px solid #f0f0f0;padding-top:8px">${signalsHtml}</div>
  </div>`;
}


['buyZonePct','watchZonePct'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderWatchlist)
);

// ══════════════════════════════════════════════════