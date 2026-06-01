// LOTS TAB
// ══════════════════════════════════════════════════
function setStatus(msg, type) {
  const bar = document.getElementById("statusBar");
  bar.textContent = msg; bar.className = "status-bar " + type;
}

async function loadFromRepo() {
  setStatus("Fetching portfolio data...", "loading");
  try {
    try {
      const metaRes = await fetch(META_URL + "?t=" + Date.now());
      if (metaRes.ok) {
        const meta = await metaRes.json();
        document.getElementById("lastUpdated").textContent = "CSV updated: " + toUAETime(meta.csv_updated || meta.last_updated);
      }
    } catch(e) {}
    const csvRes = await fetch(CSV_URL + "?t=" + Date.now());
    if (!csvRes.ok) throw new Error("CSV not found yet. Upload manually or wait for first run.");
    allRows = parseCSV(await csvRes.text());
    populateAcctFilter();
    setStatus("✓ Portfolio loaded — fetching live prices...", "success");
    await fetchLivePrices();
  } catch(err) {
    setStatus("⚠ " + err.message, "error");
    document.getElementById("lastUpdated").textContent = "Could not load — upload CSV manually below";
    renderAll();
  }
}

async function fetchLivePrices() {
  try {
    const res = await fetch(PRICES_URL + "?t=" + Date.now());
    if (!res.ok) throw new Error("prices.json not found");
    const data = await res.json();
    if (data.prices && Object.keys(data.prices).length > 0) {
      // Store flat prices for backwards compat
      livePrices = {};
      Object.entries(data.prices).forEach(([sym, val]) => {
        livePrices[sym] = typeof val === 'object' ? val.price : val;
      });
      // Store full price data (with pre/post)
      window.livePricesData = data.prices;
      document.getElementById("priceUpdated").innerHTML =
        `<span class="live-dot"></span>Prices last updated: ${toUAETime(data.last_updated)} (CSV: ${toUAETime(data.csv_updated || data.last_updated)})`;
      setStatus("✓ Live prices loaded", "success");
      setTimeout(() => document.getElementById("statusBar").style.display = "none", 2000);
    } else throw new Error("No prices");
  } catch(e) {
    document.getElementById("priceUpdated").textContent = "Using CSV prices — live prices update at 2 PM UAE daily";
  }
  renderAll();
  if (priceTimer) clearTimeout(priceTimer);
  priceTimer = setTimeout(fetchLivePrices, PRICE_REFRESH_MS);
}

async function manualRefresh() {
  if (priceTimer) clearTimeout(priceTimer);
  if (!allRows.length) { await loadFromRepo(); return; }
  setStatus("Refreshing...", "loading");
  await fetchLivePrices();
}

function parseCSV(text) {
  const rows = []; let headers = null;
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t) continue;
    const cols = []; let cur = '', inQ = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else cur += ch;
    }
    cols.push(cur);
    if (!headers || cols[0] === 'Symbol') { headers = cols; continue; }
    if (cols.length < 7) continue;
    const obj = {}; headers.forEach((h,i) => obj[h] = (cols[i]||'').trim());
    if (EXCLUDED_SYMBOLS.includes(obj.Symbol)) continue;
    rows.push(obj);
  }
  return rows;
}

function processLots(rows, sellPct, buyPct, nearPct) {
  const groups = {};
  for (const r of rows) {
    const k = r.Symbol + '||' + r.ClientAccountID;
    const cost = parseFloat(r.CostBasisPrice);
    if (!isNaN(cost) && cost > 0) { if (!groups[k]) groups[k] = []; groups[k].push(cost); }
  }
  const lots = rows.map(r => {
    const sym = r.Symbol, acct = r.ClientAccountID;
    const cost = parseFloat(r.CostBasisPrice);
    const isLive = !!livePrices[sym];
    const basePrice = livePrices[sym] || parseFloat(r.MarkPrice);
    // Get pre/post market data from livePrices object
    const lp = livePricesData[sym] || {};
    const smartP = getSmartPrice(basePrice, lp.prePrice, lp.preChangePct, lp.postPrice, lp.postChangePct);
    const mark = smartP.price;
    const priceSession = smartP;
    const qty = parseFloat(r.Quantity), pnl = parseFloat(r.FifoPnlUnrealized);
    if (isNaN(cost)||isNaN(mark)||cost<=0) return null;
    const k = sym+'||'+acct;
    const lowestCost = Math.min(...(groups[k]||[cost]));
    const buyTrigger = lowestCost*(1-buyPct/100);
    const buySignal = mark <= buyTrigger;
    const pct = ((mark-cost)/cost)*100;
    const livePnl = (mark-cost)*qty;
    let signal = 'OK';
    if (pct >= sellPct) signal = 'SELL';
    else if (pct >= nearPct) signal = 'NEAR_SELL';
    return {sym,acct,cost,mark,qty,pnl:livePnl,pct,date:r.OpenDateTime,signal,lowestCost,buyTrigger,buySignal,isLive,priceSession};
  }).filter(Boolean);

  const buyGroups = {};
  for (const lot of lots) {
    if (!lot.buySignal) continue;
    const k = lot.sym+'||'+lot.acct;
    if (!buyGroups[k]) buyGroups[k] = {sym:lot.sym,acct:lot.acct,mark:lot.mark,lowestCost:lot.lowestCost,buyTrigger:lot.buyTrigger,lots:[],totalQty:0,totalPnl:0,isLive:lot.isLive};
    buyGroups[k].lots.push(lot);
    buyGroups[k].totalQty += lot.qty;
    buyGroups[k].totalPnl += lot.pnl;
  }
  return { lots, buyGroups: Object.values(buyGroups) };
}

function getP() {
  return {
    sellPct: parseFloat(document.getElementById('sellPct').value)||10,
    buyPct:  parseFloat(document.getElementById('buyPct').value)||5,
    nearPct: parseFloat(document.getElementById('nearPct').value)||7,
  };
}

function populateAcctFilter() {
  const accts = [...new Set(allRows.map(r=>r.ClientAccountID).filter(Boolean))].sort();
  const sel = document.getElementById('acctFilter');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All accounts</option>';
  accts.forEach(a => { const o=document.createElement('option'); o.value=a; o.textContent=a; if(a===prev)o.selected=true; sel.appendChild(o); });
}

function fmtDate(dt) {
  if(!dt) return ''; const d=dt.split(';')[0];
  return d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8);
}

function applyFilters(lots, buyGroups) {
  const acctF = document.getElementById('acctFilter').value.trim();
  const sigF  = document.getElementById('signalFilter').value;
  const symF  = document.getElementById('symFilter').value.trim().toUpperCase();
  const filteredLots = lots.filter(d => {
    if (acctF && d.acct !== acctF) return false;
    if (symF  && !d.sym.includes(symF)) return false;
    if (sigF==='BUY') return false;
    if (sigF==='SELL') return d.signal==='SELL';
    if (sigF==='NEAR_SELL') return d.signal==='NEAR_SELL';
    return true;
  });
  const filteredBuys = (sigF==='SELL'||sigF==='NEAR_SELL') ? [] : buyGroups.filter(d => {
    if (acctF && d.acct !== acctF) return false;
    if (symF  && !d.sym.includes(symF)) return false;
    return true;
  });
  return { filteredLots, filteredBuys };
}

function buyCardHtml(d, p) {
  const dropPct = (((d.mark-d.lowestCost)/d.lowestCost)*100).toFixed(1);
  const lotsRows = d.lots.map(l => {
    const lPct=(((l.mark-l.cost)/l.cost)*100).toFixed(1);
    const lPnl=(l.pnl>=0?'+':'')+'$'+Math.abs(l.pnl).toFixed(0);
    return `<tr><td>${fmtDate(l.date)}</td><td>$${l.cost.toFixed(2)}</td><td>${l.qty}</td><td class="${l.pct>=0?'pos':'neg'}">${lPct}%</td><td class="${l.pnl>=0?'pos':'neg'}">${lPnl}</td></tr>`;
  }).join('');
  const sp2 = d.lots && d.lots[0]?.priceSession;
  const changeBadge = sp2?.changePct ? `<span style="font-size:10px;margin-left:3px;color:${sp2.changePct>0?'#2d7a2d':'#c0392b'}">${sp2.changePct>0?'+':''}${sp2.changePct.toFixed(2)}%</span>` : '';
  const priceTag = d.isLive ? '<span class="tag-live">LIVE</span>' : '<span class="tag-csv">CSV</span>';
  return `<div class="buy-card">
    <div class="buy-card-top">
      <div><div class="buy-sym">${d.sym}</div><div class="buy-acct">${d.acct}</div></div>
      <span class="badge badge-buy">Buy ↓</span>
    </div>
    <div class="buy-summary">
      <div class="lot-field"><span class="lot-field-label">Price</span><span class="lot-field-val">$${d.mark.toFixed(2)}${priceTag}${changeBadge}</span></div>
      <div class="lot-field"><span class="lot-field-label">Lowest lot</span><span class="lot-field-val">$${d.lowestCost.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Drop from lowest</span><span class="lot-field-val neg">${dropPct}%</span></div>
      <div class="lot-field"><span class="lot-field-label">Buy trigger ≤</span><span class="lot-field-val">$${d.buyTrigger.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Total qty</span><span class="lot-field-val">${d.totalQty.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Total P&L</span><span class="lot-field-val ${d.totalPnl>=0?'pos':'neg'}">${d.totalPnl>=0?'+':''}$${Math.abs(d.totalPnl).toFixed(0)}</span></div>
    </div>
    <div class="buy-lots-label">All lots</div>
    <table class="buy-lots-table">
      <thead><tr><th>Opened</th><th>Cost</th><th>Qty</th><th>Chg%</th><th>P&L</th></tr></thead>
      <tbody>${lotsRows}</tbody>
    </table>
  </div>`;
}

function lotCardHtml(d, p) {
  const pctStr=(d.pct>=0?'+':'')+d.pct.toFixed(1)+'%';
  const pnlStr=(d.pnl>=0?'+':'')+'$'+Math.abs(d.pnl).toFixed(0);
  let badge='', cardClass='lot-card';
  if(d.signal==='SELL'){badge=`<span class="badge badge-sell">Sell ↑</span>`;cardClass+=' has-sell';}
  else if(d.signal==='NEAR_SELL'){badge=`<span class="badge badge-near">Near sell</span>`;cardClass+=' has-near';}
  else badge=`<span class="badge badge-ok">Hold</span>`;
  const note=d.signal==='SELL'?`Up ${d.pct.toFixed(1)}% from cost $${d.cost.toFixed(2)}`:d.signal==='NEAR_SELL'?`${(p.sellPct-d.pct).toFixed(1)}% away from sell target`:'';
  const sess = d.priceSession;
  const sessionLabel = sess?.label === 'PRE' ? 'PRE-MKT' : sess?.label === 'POST' ? 'AFTER-HRS' : d.isLive ? 'LIVE' : 'CSV';
  const sessionStyle = sess?.color ? `background:${sess.color}15;color:${sess.color}` : '';
  const priceTag = `<span class="tag-live" style="${sessionStyle}">${sessionLabel}</span>`;
  const changeBadge = sess?.changePct ? `<span style="font-size:10px;margin-left:3px;color:${sess.changePct>0?'#2d7a2d':'#c0392b'}">${sess.changePct>0?'+':''}${sess.changePct.toFixed(2)}%</span>` : '';
  return `<div class="${cardClass}">
    <div class="lot-card-top">
      <div><div class="lot-sym">${d.sym}</div><div class="lot-acct">${d.acct}</div></div>
      <div class="badges">${badge}</div>
    </div>
    <div class="lot-grid">
      <div class="lot-field"><span class="lot-field-label">Qty</span><span class="lot-field-val">${d.qty}</span></div>
      <div class="lot-field"><span class="lot-field-label">Cost basis</span><span class="lot-field-val">$${d.cost.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Price</span><span class="lot-field-val">$${d.mark.toFixed(2)}${priceTag}${changeBadge}</span></div>
      <div class="lot-field"><span class="lot-field-label">Change</span><span class="lot-field-val ${d.pct>=0?'pos':'neg'}">${pctStr}</span></div>
      <div class="lot-field"><span class="lot-field-label">Unreal. P&L</span><span class="lot-field-val ${d.pnl>=0?'pos':'neg'}">${pnlStr}</span></div>
      <div class="lot-field"><span class="lot-field-label">Opened</span><span class="lot-field-val">${fmtDate(d.date)}</span></div>
    </div>
    ${note?`<div class="lot-note">${note}</div>`:''}
  </div>`;
}

function renderAll() {
  const p = getP();
  processedData = processLots(allRows, p.sellPct, p.buyPct, p.nearPct);
  const sigF = document.getElementById('signalFilter').value;
  const { filteredLots, filteredBuys } = applyFilters(processedData.lots, processedData.buyGroups);
  const sells=filteredLots.filter(d=>d.signal==='SELL').length;
  const nears=filteredLots.filter(d=>d.signal==='NEAR_SELL').length;
  document.getElementById('summaryGrid').innerHTML=`
    <div class="metric"><div class="metric-label">Lots shown</div><div class="metric-val">${filteredLots.length}</div></div>
    <div class="metric"><div class="metric-label">Sell signals ≥${p.sellPct}%</div><div class="metric-val c-sell">${sells}</div></div>
    <div class="metric"><div class="metric-label">Near sell ≥${p.nearPct}%</div><div class="metric-val c-warn">${nears}</div></div>
    <div class="metric"><div class="metric-label">Buy opportunities</div><div class="metric-val c-buy">${filteredBuys.length}</div></div>`;
  filteredLots.sort((a,b)=>{const o={SELL:0,NEAR_SELL:1,OK:2};if(o[a.signal]!==o[b.signal])return o[a.signal]-o[b.signal];return a.sym.localeCompare(b.sym);});
  filteredBuys.sort((a,b)=>a.sym.localeCompare(b.sym));
  let html='';
  if(!allRows.length){html=`<div class="no-data">Loading data...</div>`;}
  else{
    if(filteredBuys.length&&sigF!=='SELL'&&sigF!=='NEAR_SELL')
      html+=`<div class="section-head">🔵 Buy opportunities — ${filteredBuys.length} stock${filteredBuys.length>1?'s':''}</div><div class="section-wrap">${filteredBuys.map(d=>buyCardHtml(d,p)).join('')}</div>`;
    if(filteredLots.length&&sigF!=='BUY'){
      if(filteredBuys.length&&sigF!=='SELL'&&sigF!=='NEAR_SELL')html+=`<div class="section-head" style="margin-top:8px">📋 All lots</div>`;
      html+=`<div class="section-wrap">${filteredLots.map(d=>lotCardHtml(d,p)).join('')}</div>`;
    }
    if(!filteredLots.length&&!filteredBuys.length)html=`<div class="no-data">No lots match the current filters.</div>`;
  }
  document.getElementById('tableArea').innerHTML=html;
}

document.getElementById('csvFile').addEventListener('change', e => {
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async ev=>{
    allRows=parseCSV(ev.target.result);
    document.getElementById("lastUpdated").textContent="Loaded: "+file.name;
    setStatus("✓ CSV loaded — fetching live prices...","success");
    populateAcctFilter();
    await fetchLivePrices();
  };
  reader.readAsText(file);
});

['acctFilter','signalFilter'].forEach(id=>document.getElementById(id).addEventListener('change',renderAll));
document.getElementById('symFilter').addEventListener('input',renderAll);
['sellPct','buyPct','nearPct'].forEach(id=>document.getElementById(id).addEventListener('change',renderAll));

// ══════════════════════════════════════════════════