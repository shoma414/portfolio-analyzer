// ══════════════════════════════════════════════════
// SIGNALS TAB — Quantamental Screener
// ══════════════════════════════════════════════════
let signalFilter = 'all';
let hideOwnedSignals = false;

function setSignalFilter(f) {
  signalFilter = f;
  document.getElementById('sfAll').className    = 'zone-filter-btn' + (f==='all'     ? ' active-all'   : '');
  document.getElementById('sfBuy').className    = 'zone-filter-btn' + (f==='buy'     ? ' active-buy'   : '');
  document.getElementById('sfWatch').className  = 'zone-filter-btn' + (f==='watch'   ? ' active-watch' : '');
  document.getElementById('sfAvoid').className  = 'zone-filter-btn' + (f==='avoid'   ? ' active-avoid' : '');
  renderSignals();
}

function toggleHideOwnedSignals() {
  hideOwnedSignals = !hideOwnedSignals;
  const btn = document.getElementById('hideOwnedSignalsBtn');
  btn.className = 'zone-filter-btn full' + (hideOwnedSignals ? ' active-owned' : '');
  btn.textContent = hideOwnedSignals ? '✅ Hiding stocks I already own' : '👜 Hide stocks I already own';
  renderSignals();
}

// ══════════════════════════════════════════════════
// QUANTAMENTAL SCORE CALCULATOR
// ══════════════════════════════════════════════════
function calcQuantamentalScore(d) {
  if (!d || !d.price) return null;

  const sections = {};
  let totalScore = 0;

  // ── Section 1: Business Quality (40pts) ────────────────────────────────────
  const bq = { label: 'Business Quality', max: 40, items: [] };

  // Revenue Growth (10pts)
  const rg = d.revenueGrowth;
  if (rg !== null && rg !== undefined) {
    const s = rg >= 15 ? 10 : rg >= 8 ? 7 : rg >= 3 ? 4 : 0;
    const r = s >= 7 ? 'green' : s >= 4 ? 'yellow' : 'red';
    bq.items.push({ label: 'Revenue Growth', value: `${rg?.toFixed(1)}%`, score: s, max: 10, rating: r,
      note: rg >= 15 ? 'Excellent (>15%)' : rg >= 8 ? 'Good (8-15%)' : rg >= 3 ? 'Moderate (3-8%)' : 'Weak (<3%)' });
    bq.score = (bq.score||0) + s;
  } else {
    bq.items.push({ label: 'Revenue Growth', value: 'N/A', score: 0, max: 10, rating: 'grey', note: 'No data' });
  }

  // EPS Growth (10pts)
  const eg = d.epsGrowth;
  if (eg !== null && eg !== undefined) {
    const s = eg >= 15 ? 10 : eg >= 8 ? 7 : eg >= 3 ? 4 : 0;
    const r = s >= 7 ? 'green' : s >= 4 ? 'yellow' : 'red';
    bq.items.push({ label: 'EPS Growth', value: `${eg?.toFixed(1)}%`, score: s, max: 10, rating: r,
      note: eg >= 15 ? 'Excellent (>15%)' : eg >= 8 ? 'Good (8-15%)' : eg >= 3 ? 'Moderate' : 'Weak' });
    bq.score = (bq.score||0) + s;
  } else {
    bq.items.push({ label: 'EPS Growth', value: 'N/A', score: 0, max: 10, rating: 'grey', note: 'No data' });
  }

  // ROIC / ROE (10pts)
  const roe = d.roe;
  if (roe !== null && roe !== undefined) {
    const s = roe >= 15 ? 10 : roe >= 10 ? 7 : roe >= 5 ? 4 : 0;
    const r = s >= 7 ? 'green' : s >= 4 ? 'yellow' : 'red';
    bq.items.push({ label: 'ROE (ROIC proxy)', value: `${roe?.toFixed(1)}%`, score: s, max: 10, rating: r,
      note: roe >= 15 ? 'Excellent (>15%)' : roe >= 10 ? 'Good (10-15%)' : roe >= 5 ? 'Moderate' : 'Weak' });
    bq.score = (bq.score||0) + s;
  } else {
    bq.items.push({ label: 'ROE (ROIC proxy)', value: 'N/A', score: 0, max: 10, rating: 'grey', note: 'No data' });
  }

  // Net Debt/EBITDA (10pts)
  const nd = d.netDebtEbitda;
  if (nd !== null && nd !== undefined) {
    const s = nd < 1.5 ? 10 : nd < 3.0 ? 7 : nd < 4.5 ? 4 : 0;
    const r = s >= 7 ? 'green' : s >= 4 ? 'yellow' : 'red';
    bq.items.push({ label: 'Net Debt/EBITDA', value: `${nd?.toFixed(1)}x`, score: s, max: 10, rating: r,
      note: nd < 1.5 ? 'Excellent (<1.5x)' : nd < 3.0 ? 'Safe (1.5-3x)' : nd < 4.5 ? 'Elevated' : 'Dangerous (>4.5x)' });
    bq.score = (bq.score||0) + s;
  } else {
    bq.items.push({ label: 'Net Debt/EBITDA', value: 'N/A', score: 0, max: 10, rating: 'grey', note: 'No data' });
  }

  bq.score = bq.score || 0;
  sections.businessQuality = bq;
  totalScore += bq.score;

  // ── Section 2: Valuation (30pts) ───────────────────────────────────────────
  const val = { label: 'Valuation', max: 30, score: 0, items: [] };

  // Forward P/E (10pts) — compare to trailing as proxy for historical avg
  const fpe = d.forwardPE;
  const tpe = d.trailingPE;
  if (fpe && tpe && tpe > 0) {
    const discount = ((tpe - fpe) / tpe) * 100;
    const s = discount >= 20 ? 10 : discount >= 10 ? 7 : discount >= -5 ? 4 : 0;
    const r = s >= 7 ? 'green' : s >= 4 ? 'yellow' : 'red';
    val.items.push({ label: 'Forward P/E vs Trailing', value: `${fpe?.toFixed(1)}x (trail: ${tpe?.toFixed(1)}x)`, score: s, max: 10, rating: r,
      note: discount >= 20 ? `${discount.toFixed(0)}% discount — great value` : discount >= 10 ? `${discount.toFixed(0)}% discount` : discount >= -5 ? 'Near average' : 'Trading at premium' });
    val.score += s;
  } else if (fpe) {
    const s = fpe < 15 ? 10 : fpe < 20 ? 7 : fpe < 30 ? 4 : 0;
    const r = s >= 7 ? 'green' : s >= 4 ? 'yellow' : 'red';
    val.items.push({ label: 'Forward P/E', value: `${fpe?.toFixed(1)}x`, score: s, max: 10, rating: r,
      note: fpe < 15 ? 'Cheap (<15x)' : fpe < 20 ? 'Fair (15-20x)' : fpe < 30 ? 'Elevated' : 'Expensive (>30x)' });
    val.score += s;
  } else {
    val.items.push({ label: 'Forward P/E', value: 'N/A', score: 0, max: 10, rating: 'grey', note: 'No data' });
  }

  // FCF Yield (10pts)
  const fcfy = d.fcfYield;
  if (fcfy !== null && fcfy !== undefined) {
    const s = fcfy >= 6 ? 10 : fcfy >= 4 ? 7 : fcfy >= 2 ? 4 : 0;
    const r = s >= 7 ? 'green' : s >= 4 ? 'yellow' : 'red';
    val.items.push({ label: 'FCF Yield', value: `${fcfy?.toFixed(1)}%`, score: s, max: 10, rating: r,
      note: fcfy >= 6 ? 'Excellent (>6%)' : fcfy >= 4 ? 'Good (4-6%)' : fcfy >= 2 ? 'Moderate (2-4%)' : 'Low (<2%)' });
    val.score += s;
  } else {
    val.items.push({ label: 'FCF Yield', value: 'N/A', score: 0, max: 10, rating: 'grey', note: 'No data' });
  }

  // EV/EBITDA vs Sector (10pts)
  const eve = d.evEbitda;
  const seve = d.sectorEvEbitda || 14;
  if (eve && eve > 0) {
    const discount = ((seve - eve) / seve) * 100;
    const s = discount >= 20 ? 10 : discount >= 10 ? 7 : discount >= -5 ? 4 : 0;
    const r = s >= 7 ? 'green' : s >= 4 ? 'yellow' : 'red';
    val.items.push({ label: 'EV/EBITDA vs Sector', value: `${eve?.toFixed(1)}x (sector: ${seve}x)`, score: s, max: 10, rating: r,
      note: discount >= 20 ? `${discount.toFixed(0)}% below sector` : discount >= 10 ? `${discount.toFixed(0)}% below sector` : discount >= -5 ? 'Near sector avg' : 'Above sector avg' });
    val.score += s;
  } else {
    val.items.push({ label: 'EV/EBITDA vs Sector', value: 'N/A', score: 0, max: 10, rating: 'grey', note: 'No data' });
  }

  sections.valuation = val;
  totalScore += val.score;

  // ── Section 3: Shareholder Return (20pts) ──────────────────────────────────
  const sr = { label: 'Shareholder Return', max: 20, score: 0, items: [] };

  // Dividend Yield (5pts)
  const dy = d.divYield;
  if (dy !== null && dy !== undefined) {
    const s = dy >= 4 ? 5 : dy >= 2 ? 3 : dy > 0 ? 1 : 0;
    const r = s >= 3 ? 'green' : s >= 1 ? 'yellow' : 'grey';
    sr.items.push({ label: 'Dividend Yield', value: `${dy?.toFixed(2)}%`, score: s, max: 5, rating: r,
      note: dy >= 4 ? 'High yield (>4%)' : dy >= 2 ? 'Good yield (2-4%)' : dy > 0 ? 'Low yield' : 'No dividend' });
    sr.score += s;
  } else {
    sr.items.push({ label: 'Dividend Yield', value: 'N/A', score: 0, max: 5, rating: 'grey', note: 'No data' });
  }

  // Payout Ratio (5pts) — Goldilocks 25-50%
  const pr = d.payoutRatio;
  if (pr !== null && pr !== undefined && pr > 0) {
    const s = (pr >= 25 && pr <= 50) ? 5 : (pr < 25 || (pr > 50 && pr <= 70)) ? 3 : (pr > 70 && pr <= 85) ? 1 : 0;
    const r = s >= 3 ? 'green' : s >= 1 ? 'yellow' : 'red';
    sr.items.push({ label: 'Payout Ratio', value: `${pr?.toFixed(0)}%`, score: s, max: 5, rating: r,
      note: (pr >= 25 && pr <= 50) ? 'Ideal (25-50%)' : pr < 25 ? 'Low — room to grow' : pr <= 70 ? 'Moderate' : pr <= 85 ? 'Elevated risk' : 'Danger zone (>85%)' });
    sr.score += s;
  } else {
    sr.items.push({ label: 'Payout Ratio', value: pr === 0 ? '0% (no div)' : 'N/A', score: 0, max: 5, rating: 'grey', note: 'No dividend paid' });
  }

  // Placeholder for Dividend Growth & Buyback (5+5pts) — yfinance limited
  sr.items.push({ label: 'Div Growth & Buybacks', value: 'See analysis', score: 5, max: 10, rating: 'grey',
    note: 'Use Claude analysis tab for detailed dividend growth & buyback data' });
  sr.score += 5; // neutral score — not penalized for missing data

  sections.shareholderReturn = sr;
  totalScore += sr.score;

  // ── Section 4: Technical Timing (10pts) ────────────────────────────────────
  const tech = { label: 'Technical Timing', max: 10, score: 0, items: [] };

  // Trend: MA50 vs MA200 (5pts)
  if (d.ma50 && d.ma200) {
    const cross = d.maCross;
    const s = (cross === 'golden' || cross === 'above') ? 5 : cross === 'below' ? 0 : 3;
    const r = s >= 5 ? 'green' : s >= 3 ? 'yellow' : 'red';
    tech.items.push({ label: 'Trend (MA50 vs MA200)', value: cross === 'golden' ? '✨ Golden Cross' : cross === 'above' ? '50MA > 200MA' : '50MA < 200MA',
      score: s, max: 5, rating: r, note: cross === 'golden' ? 'Fresh Golden Cross' : cross === 'above' ? 'Uptrend confirmed' : 'Downtrend — caution' });
    tech.score += s;
  } else {
    tech.items.push({ label: 'Trend', value: 'N/A', score: 0, max: 5, rating: 'grey', note: 'No MA data' });
  }

  // RSI (5pts) — 30-50 is ideal for entry
  const rsi = d.rsi;
  if (rsi !== null && rsi !== undefined) {
    const s = (rsi >= 30 && rsi <= 50) ? 5 : (rsi > 50 && rsi <= 70) ? 3 : 0;
    const r = s >= 5 ? 'green' : s >= 3 ? 'yellow' : 'red';
    tech.items.push({ label: 'RSI (14)', value: `${rsi}`, score: s, max: 5, rating: r,
      note: rsi < 30 ? 'Oversold — possible structural issue' : rsi <= 50 ? 'Ideal entry zone (30-50)' : rsi <= 70 ? 'Healthy momentum' : 'Overbought — wait' });
    tech.score += s;
  } else {
    tech.items.push({ label: 'RSI (14)', value: 'N/A', score: 0, max: 5, rating: 'grey', note: 'No data' });
  }

  sections.technicalTiming = tech;
  totalScore += tech.score;

  // ── Halal flag ──────────────────────────────────────────────────────────────
  const halalFlag = (d.debtToAssets > 33) || (d.interestPct > 5) ? 'review' : 'ok';

  // ── Final rating ────────────────────────────────────────────────────────────
  const rating = totalScore >= 85 ? 'strongbuy'
               : totalScore >= 70 ? 'buy'
               : totalScore >= 55 ? 'watch'
               : totalScore >= 40 ? 'weak'
               : 'avoid';

  return { score: Math.round(totalScore), rating, sections, halalFlag };
}

// ── Rating config ─────────────────────────────────────────────────────────────
const RATINGS = {
  strongbuy: { label: '🟢 Strong Buy', color: '#1a7a1a', bg: '#e6f4e6', zone: 'buy' },
  buy:       { label: '🟢 Buy',        color: '#2d7a2d', bg: '#f0f8f0', zone: 'buy' },
  watch:     { label: '🟡 Watch',      color: '#a06000', bg: '#fff8e6', zone: 'watch' },
  weak:      { label: '🟠 Weak',       color: '#c05000', bg: '#fff3eb', zone: 'avoid' },
  avoid:     { label: '🔴 Avoid',      color: '#c0392b', bg: '#fde8e8', zone: 'avoid' },
};

// ── Signal Card HTML ──────────────────────────────────────────────────────────
function signalCardHtml(sym, d) {
  if (d.loading) return `<div class="wl-card loading"><div class="wl-top"><div class="wl-sym">${sym}</div></div><div style="font-size:12px;color:#aaa">Loading...</div></div>`;
  if (d.error || !d.price) return `<div class="wl-card zone-wait"><div class="wl-top"><div><div class="wl-sym">${sym}</div></div><button class="remove-btn" onclick="removeWatchlistSymbol('${sym}')">✕</button></div><div style="font-size:12px;color:#aaa">Could not load price</div></div>`;

  const qs = calcQuantamentalScore(d);
  if (!qs) return '';

  const { score, rating, sections, halalFlag } = qs;
  const rc = RATINGS[rating] || RATINGS.watch;
  const ratingClass = r => r==='green'?'sig-green':r==='yellow'?'sig-yellow':r==='red'?'sig-red':'sig-grey';
  const scoreColor = rc.color;

  // Section HTML helper
  const sectionHtml = (sec) => {
    const secColor = sec.score >= sec.max*0.7 ? '#2d7a2d' : sec.score >= sec.max*0.4 ? '#a06000' : '#c0392b';
    const itemsHtml = sec.items.map(item => `
      <div class="signal-row" style="padding:4px 0">
        <div style="flex:1">
          <span style="font-size:12px">${item.label}</span>
          <span style="font-size:11px;color:#aaa;margin-left:6px">${item.value}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;color:#888">${item.note}</span>
          <span class="signal-badge ${ratingClass(item.rating)}">${item.score}/${item.max}</span>
        </div>
      </div>`).join('');
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:13px;font-weight:600">${sec.label}</span>
          <span style="font-size:13px;font-weight:700;color:${secColor}">${sec.score}/${sec.max}</span>
        </div>
        <div class="score-bar-wrap">
          <div class="score-bar-fill" style="width:${(sec.score/sec.max*100)}%;background:${secColor}"></div>
        </div>
        <div style="margin-top:6px">${itemsHtml}</div>
      </div>`;
  };

  const halalBadge = halalFlag === 'review'
    ? `<span style="font-size:10px;background:#fff3e0;color:#a06000;padding:2px 6px;border-radius:6px;margin-left:6px">☪️ Review</span>`
    : `<span style="font-size:10px;background:#e6f4e6;color:#2d7a2d;padding:2px 6px;border-radius:6px;margin-left:6px">☪️ OK</span>`;

  return `<div class="wl-card" style="border-left:3px solid ${rc.color}">
    <div class="wl-top">
      <div>
        <div class="wl-sym">${sym}${halalBadge}</div>
        <div style="font-size:11px;color:#aaa;margin-top:2px">${d.name||''} · ${d.sector||''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="text-align:right">
          <div style="font-size:22px;font-weight:700;color:${scoreColor}">${score}</div>
          <div style="font-size:10px;color:#aaa">/100</div>
        </div>
        <span class="badge" style="background:${rc.bg};color:${rc.color};font-size:11px">${rc.label}</span>
        <button class="remove-btn" onclick="removeWatchlistSymbol('${sym}')">✕</button>
      </div>
    </div>
    <div class="score-bar-wrap" style="margin-bottom:12px">
      <div class="score-bar-fill" style="width:${score}%;background:${scoreColor}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;font-size:12px">
      <div><span style="color:#aaa">Price</span> <strong>$${d.price.toFixed(2)}</strong></div>
      <div><span style="color:#aaa">FCF Yield</span> <strong>${d.fcfYield ? d.fcfYield.toFixed(1)+'%' : '—'}</strong></div>
      <div><span style="color:#aaa">Fwd P/E</span> <strong>${d.forwardPE ? d.forwardPE.toFixed(1)+'x' : '—'}</strong></div>
      <div><span style="color:#aaa">EV/EBITDA</span> <strong>${d.evEbitda ? d.evEbitda.toFixed(1)+'x' : '—'}</strong></div>
      <div><span style="color:#aaa">ROE</span> <strong>${d.roe ? d.roe.toFixed(1)+'%' : '—'}</strong></div>
      <div><span style="color:#aaa">Div Yield</span> <strong>${d.divYield ? d.divYield.toFixed(2)+'%' : '—'}</strong></div>
    </div>
    <div style="border-top:1px solid #f0f0f0;padding-top:10px">
      ${sectionHtml(sections.businessQuality)}
      ${sectionHtml(sections.valuation)}
      ${sectionHtml(sections.shareholderReturn)}
      ${sectionHtml(sections.technicalTiming)}
    </div>
  </div>`;
}

// ── Render Signals Tab ────────────────────────────────────────────────────────
function renderSignals() {
  const area = document.getElementById('sigArea');
  const grid = document.getElementById('sigSummaryGrid');
  if (!area || !grid) return;

  const list = getWatchlist();
  const ownedSymbols = getOwnedSymbols();

  const wlPU  = document.getElementById('wlPriceUpdated');
  const sigPU = document.getElementById('signalsPriceUpdated');
  if (wlPU && sigPU) sigPU.innerHTML = wlPU.innerHTML;

  if (Object.keys(wlData).length === 0) {
    area.innerHTML = `<div class="no-data">Loading data...</div>`;
    refreshWatchlist();
    return;
  }

  let strongBuy=0, buy=0, watch=0, avoid=0;
  const scored = list.map(sym => {
    const d = wlData[sym];
    if (!d || d.loading || d.error || !d.price) return { sym, d: d||{loading:true}, score:0, rating:'avoid' };
    const qs = calcQuantamentalScore(d);
    if (!qs) return { sym, d, score:0, rating:'avoid' };
    if (qs.rating === 'strongbuy' || qs.rating === 'buy') buy++;
    else if (qs.rating === 'watch') watch++;
    else avoid++;
    return { sym, d, score: qs.score, rating: qs.rating };
  }).sort((a,b) => b.score - a.score);

  grid.innerHTML = `
    <div class="metric"><div class="metric-label">Total screened</div><div class="metric-val">${list.length}</div></div>
    <div class="metric"><div class="metric-label">🟢 Buy signals</div><div class="metric-val c-sell">${buy}</div></div>
    <div class="metric"><div class="metric-label">🟡 Watch</div><div class="metric-val c-warn">${watch}</div></div>
    <div class="metric"><div class="metric-label">🔴 Avoid</div><div class="metric-val" style="color:#c0392b">${avoid}</div></div>`;

  const filtered = scored.filter(({ sym, rating }) => {
    if (hideOwnedSignals && ownedSymbols.has(sym)) return false;
    if (signalFilter === 'all') return true;
    if (signalFilter === 'buy') return rating === 'strongbuy' || rating === 'buy';
    if (signalFilter === 'watch') return rating === 'watch';
    if (signalFilter === 'avoid') return rating === 'weak' || rating === 'avoid';
    return true;
  });

  area.innerHTML = filtered.map(({ sym, d }) =>
    signalCardHtml(sym, d)
  ).join('') || `<div class="no-data">No stocks match the current filters.</div>`;
}
