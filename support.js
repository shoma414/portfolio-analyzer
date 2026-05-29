// ══════════════════════════════════════════════════
// SUPPORT TAB
// ══════════════════════════════════════════════════
let supportFilter = 'all';
let hideOwnedSupport = false;

function setSupportFilter(f) {
  supportFilter = f;
  document.getElementById('supAll').className   = 'zone-filter-btn' + (f==='all'    ? ' active-all'   : '');
  document.getElementById('supStrong').className= 'zone-filter-btn' + (f==='strong' ? ' active-buy'   : '');
  document.getElementById('supNear').className  = 'zone-filter-btn' + (f==='near'   ? ' active-watch' : '');
  renderSupport();
}

function toggleHideOwnedSupport() {
  hideOwnedSupport = !hideOwnedSupport;
  const btn = document.getElementById('hideOwnedSupportBtn');
  btn.className = 'zone-filter-btn full' + (hideOwnedSupport ? ' active-owned' : '');
  btn.textContent = hideOwnedSupport ? '✅ Hiding stocks I already own' : '👜 Hide stocks I already own';
  renderSupport();
}

// ── Support Score Calculator ──────────────────────────────────────────────────
function calcSupportScore(d) {
  if (!d || !d.price) return null;

  let score = 0;
  const signals = [];
  const price = d.price;

  // Signal 1: Near MA200 (40pts)
  if (d.ma200) {
    const diff = (price - d.ma200) / d.ma200 * 100;
    if (diff >= -5 && diff <= 2) {
      score += 40;
      signals.push({ label: 'MA200 Support', note: `${diff.toFixed(1)}% from MA200 $${d.ma200.toFixed(2)}`, rating: 'green' });
    } else if (diff >= -10 && diff < -5) {
      score += 20;
      signals.push({ label: 'MA200 Support', note: `${diff.toFixed(1)}% from MA200 $${d.ma200.toFixed(2)}`, rating: 'yellow' });
    } else if (diff > 2) {
      signals.push({ label: 'MA200 Support', note: `+${diff.toFixed(1)}% above MA200`, rating: 'grey' });
    } else {
      signals.push({ label: 'MA200 Support', note: `${diff.toFixed(1)}% — far below MA200`, rating: 'red' });
    }
  }

  // Signal 2: Near MA50 (35pts)
  if (d.ma50) {
    const diff = (price - d.ma50) / d.ma50 * 100;
    if (diff >= -5 && diff <= 2) {
      score += 35;
      signals.push({ label: 'MA50 Support', note: `${diff.toFixed(1)}% from MA50 $${d.ma50.toFixed(2)}`, rating: 'green' });
    } else if (diff >= -10 && diff < -5) {
      score += 15;
      signals.push({ label: 'MA50 Support', note: `${diff.toFixed(1)}% from MA50 $${d.ma50.toFixed(2)}`, rating: 'yellow' });
    } else if (diff > 2) {
      signals.push({ label: 'MA50 Support', note: `+${diff.toFixed(1)}% above MA50`, rating: 'grey' });
    } else {
      signals.push({ label: 'MA50 Support', note: `${diff.toFixed(1)}% — far below MA50`, rating: 'red' });
    }
  }

  // Signal 3: RSI oversold (25pts)
  if (d.rsi !== null && d.rsi !== undefined) {
    if (d.rsi < 30) {
      score += 25;
      signals.push({ label: 'RSI', note: `${d.rsi} — Oversold`, rating: 'green' });
    } else if (d.rsi < 35) {
      score += 15;
      signals.push({ label: 'RSI', note: `${d.rsi} — Near oversold`, rating: 'yellow' });
    } else if (d.rsi < 50) {
      score += 5;
      signals.push({ label: 'RSI', note: `${d.rsi} — Neutral`, rating: 'grey' });
    } else {
      signals.push({ label: 'RSI', note: `${d.rsi} — No oversold signal`, rating: 'grey' });
    }
  }

  const zone = score >= 70 ? 'strong' : score >= 40 ? 'near' : 'none';
  return { score: Math.min(100, Math.round(score)), zone, signals };
}

// ── Support Card HTML ─────────────────────────────────────────────────────────
function supportCardHtml(sym, d) {
  if (d.loading) return `<div class="wl-card loading"><div class="wl-top"><div class="wl-sym">${sym}</div></div><div style="font-size:12px;color:#aaa">Loading...</div></div>`;
  if (d.error || !d.price) return `<div class="wl-card zone-wait"><div class="wl-top"><div><div class="wl-sym">${sym}</div></div><button class="remove-btn" onclick="removeWatchlistSymbol('${sym}')">✕</button></div><div style="font-size:12px;color:#aaa">Could not load price</div></div>`;

  const cs = calcSupportScore(d);
  if (!cs) return '';

  const { score, zone, signals } = cs;
  const scoreColor  = score >= 70 ? '#2d7a2d' : score >= 40 ? '#a06000' : '#888';
  const cardBorder  = zone === 'strong' ? '#2d7a2d' : zone === 'near' ? '#a06000' : '#ddd';
  const badgeClass  = zone === 'strong' ? 'badge-zone-buy' : zone === 'near' ? 'badge-zone-watch' : 'badge-zone-wait';
  const badgeLabel  = zone === 'strong' ? '🟢 Strong support' : zone === 'near' ? '🟡 Approaching' : '⚪ No support';
  const ratingClass = r => r==='green'?'sig-green':r==='yellow'?'sig-yellow':r==='red'?'sig-red':'sig-grey';

  const signalsHtml = signals.map(s => `
    <div class="signal-row">
      <span>${s.label}</span>
      <span class="signal-badge ${ratingClass(s.rating)}">${s.note}</span>
    </div>`).join('');

  return `<div class="wl-card" style="border-left:3px solid ${cardBorder}">
    <div class="wl-top">
      <div>
        <div class="wl-sym">${sym}</div>
        <div style="font-size:11px;color:#aaa;margin-top:2px">${d.name||''}</div>
      </div>
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
      <div class="lot-field"><span class="lot-field-label">MA50</span><span class="lot-field-val">${d.ma50 ? '$'+d.ma50.toFixed(2) : '—'}</span></div>
      <div class="lot-field"><span class="lot-field-label">MA200</span><span class="lot-field-val">${d.ma200 ? '$'+d.ma200.toFixed(2) : '—'}</span></div>
      <div class="lot-field"><span class="lot-field-label">RSI (14)</span><span class="lot-field-val ${d.rsi<35?'pos':d.rsi>70?'neg':''}">${d.rsi ?? '—'}</span></div>
      <div class="lot-field"><span class="lot-field-label">52W Low</span><span class="lot-field-val">${d.low52 ? '$'+d.low52.toFixed(2) : '—'}</span></div>
      <div class="lot-field"><span class="lot-field-label">52W High</span><span class="lot-field-val">${d.high52 ? '$'+d.high52.toFixed(2) : '—'}</span></div>
    </div>
    <div style="border-top:1px solid #f0f0f0;padding-top:8px">${signalsHtml}</div>
  </div>`;
}

// ── Render Support Tab ────────────────────────────────────────────────────────
function renderSupport() {
  const area = document.getElementById('supArea');
  const grid = document.getElementById('supSummaryGrid');
  if (!area || !grid) return;

  const list = getWatchlist();
  const ownedSymbols = getOwnedSymbols();

  // Sync price timestamp
  const wlPU  = document.getElementById('wlPriceUpdated');
  const supPU = document.getElementById('supportPriceUpdated');
  if (wlPU && supPU) supPU.innerHTML = wlPU.innerHTML;

  // Load data if empty
  if (Object.keys(wlData).length === 0) {
    area.innerHTML = `<div class="no-data">Loading watchlist data...</div>`;
    refreshWatchlist();
    return;
  }

  // Score all stocks
  let strongCount=0, nearCount=0, noneCount=0;
  const scored = list.map(sym => {
    const d = wlData[sym];
    if (!d || d.loading || d.error || !d.price) return { sym, d: d||{loading:true}, score:0, zone:'none' };
    const cs = calcSupportScore(d);
    const zone = cs ? cs.zone : 'none';
    if (zone==='strong') strongCount++;
    else if (zone==='near') nearCount++;
    else noneCount++;
    return { sym, d, score: cs?.score||0, zone };
  }).sort((a,b) => b.score - a.score);

  grid.innerHTML = `
    <div class="metric"><div class="metric-label">Total screened</div><div class="metric-val">${list.length}</div></div>
    <div class="metric"><div class="metric-label">🟢 Strong support</div><div class="metric-val c-sell">${strongCount}</div></div>
    <div class="metric"><div class="metric-label">🟡 Approaching</div><div class="metric-val c-warn">${nearCount}</div></div>
    <div class="metric"><div class="metric-label">⚪ No support</div><div class="metric-val c-wait">${noneCount}</div></div>`;

  const filtered = scored.filter(({ sym, zone }) => {
    if (hideOwnedSupport && ownedSymbols.has(sym)) return false;
    if (supportFilter === 'all') return true;
    return zone === supportFilter;
  });

  area.innerHTML = filtered.map(({ sym, d }) =>
    supportCardHtml(sym, d)
  ).join('') || `<div class="no-data">No stocks match the current filters.</div>`;
}
