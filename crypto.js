// crypto.js — Crypto Lots tab (5th tab)
// Matches the card style of lots.js exactly

const CRYPTO_JSON_URL = `https://raw.githubusercontent.com/shoma414/portfolio-analyzer/main/data/crypto_portfolio.json`;
const MANUAL_LOTS_URL = `https://raw.githubusercontent.com/shoma414/portfolio-analyzer/main/data/crypto_manual_lots.json`;
const GITHUB_API_URL  = `https://api.github.com/repos/shoma414/portfolio-analyzer/contents/data/crypto_manual_lots.json`;
const CRYPTO_COINS    = ["BTC","ETH","SOL","XRP","SUI","CRO","HBAR","ADA","AVAX"];

const COIN_COLORS = {
  BTC:"#f7931a", ETH:"#627eea", SOL:"#9945ff",
  XRP:"#00aae4", SUI:"#4da2ff", CRO:"#002d74",
  HBAR:"#222222", ADA:"#0033ad", AVAX:"#e84142",
};

let cryptoAllLots      = [];
let cryptoSignalFilter = "all";
let cryptoManualLots   = [];
let githubToken        = localStorage.getItem("gh_token") || "";

// ── Helpers ────────────────────────────────────────────────────────────────────
function cfmt(n, d=2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits:d, maximumFractionDigits:d });
}
function cfmtPrice(p) {
  if (!p || p <= 0) return "—";
  if (p >= 1000) return "$" + cfmt(p, 2);
  if (p >= 1)    return "$" + cfmt(p, 4);
  return "$" + cfmt(p, 6);
}

// ── Coin card (matches lotCardHtml style) ──────────────────────────────────────
function cryptoLotCardHtml(lot) {
  const pct     = lot.gain_pct;
  const pctStr  = (pct >= 0 ? "+" : "") + cfmt(pct, 1) + "%";
  const pnl     = (lot.current_price - lot.cost_usd) * lot.qty;
  const pnlStr  = (pnl >= 0 ? "+" : "") + "$" + Math.abs(pnl).toFixed(2);
  const invested = (lot.cost_usd * lot.qty).toFixed(2);
  const value    = lot.market_value ? lot.market_value.toFixed(2) : "—";
  const coinColor = COIN_COLORS[lot.coin] || "#888";
  const isManual  = lot.source === "manual";

  let badge = "", cardClass = "lot-card";
  if (lot.signal === "SELL") {
    badge = `<span class="badge badge-sell">Sell ↑</span>`;
    cardClass += " has-sell";
  } else if (lot.signal === "NEAR_SELL") {
    badge = `<span class="badge badge-near">Near sell</span>`;
    cardClass += " has-near";
  } else if (lot.signal === "BUY") {
    badge = `<span class="badge badge-buy">Buy ↓</span>`;
    cardClass += " has-buy";
  } else {
    badge = `<span class="badge badge-ok">Hold</span>`;
  }

  const note = lot.signal === "SELL"
    ? `Up ${cfmt(pct,1)}% from cost ${cfmtPrice(lot.cost_usd)}`
    : lot.signal === "NEAR_SELL"
    ? `${cfmt(10 - pct, 1)}% away from sell target`
    : lot.signal === "BUY"
    ? `${cfmt(Math.abs(pct),1)}% below cost — opportunity`
    : "";

  const coinIcon = `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${coinColor};color:#fff;font-size:9px;font-weight:700;margin-right:4px;">${lot.coin.slice(0,4)}</span>`;
  const manualTag = isManual ? `<span style="font-size:9px;background:#fff3cd;color:#856404;padding:1px 5px;border-radius:4px;margin-left:4px;">manual</span>` : "";

  return `<div class="${cardClass}">
    <div class="lot-card-top">
      <div style="display:flex;align-items:center;">
        ${coinIcon}
        <div>
          <div class="lot-sym">${lot.coin}${manualTag}</div>
          <div class="lot-acct">${lot.date}</div>
        </div>
      </div>
      <div class="badges">${badge}</div>
    </div>
    <div class="lot-grid">
      <div class="lot-field"><span class="lot-field-label">Quantity</span><span class="lot-field-val">${cfmt(lot.qty, 6)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Cost basis</span><span class="lot-field-val">${cfmtPrice(lot.cost_usd)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Price</span><span class="lot-field-val">${cfmtPrice(lot.current_price)}<span class="tag-live">LIVE</span></span></div>
      <div class="lot-field"><span class="lot-field-label">Change</span><span class="lot-field-val ${pct>=0?'pos':'neg'}">${pctStr}</span></div>
      <div class="lot-field"><span class="lot-field-label">Unreal. P&L</span><span class="lot-field-val ${pnl>=0?'pos':'neg'}">${pnlStr}</span></div>
      <div class="lot-field"><span class="lot-field-label">Invested</span><span class="lot-field-val">$${invested}</span></div>
      <div class="lot-field"><span class="lot-field-label">Value</span><span class="lot-field-val">$${value}</span></div>
    </div>
    ${note ? `<div class="lot-note">${note}</div>` : ""}
  </div>`;
}

// ── Buy opportunity card (matches buyCardHtml style) ──────────────────────────
function cryptoBuyCardHtml(coin, lots, currentPrice) {
  const lowestCost  = Math.min(...lots.map(l => l.cost_usd));
  const buyTrigger  = lowestCost * 0.95;
  const dropPct     = (((currentPrice - lowestCost) / lowestCost) * 100).toFixed(1);
  const totalQty    = lots.reduce((s,l) => s + l.qty, 0);
  const totalInvest = lots.reduce((s,l) => s + l.cost_usd * l.qty, 0);
  const totalValue  = lots.reduce((s,l) => s + l.market_value, 0);
  const totalPnl    = totalValue - totalInvest;
  const coinColor   = COIN_COLORS[coin] || "#888";

  const lotsRows = lots.map(l => {
    const lPct = (((currentPrice - l.cost_usd) / l.cost_usd) * 100).toFixed(1);
    const lPnl = ((currentPrice - l.cost_usd) * l.qty);
    return `<tr>
      <td>${l.date}</td>
      <td>${cfmtPrice(l.cost_usd)}</td>
      <td>${cfmt(l.qty,6)}</td>
      <td>$${(l.cost_usd * l.qty).toFixed(2)}</td>
      <td class="${lPct>=0?'pos':'neg'}">${lPct>=0?'+':''}${lPct}%</td>
      <td class="${lPnl>=0?'pos':'neg'}">${lPnl>=0?'+':''}$${Math.abs(lPnl).toFixed(2)}</td>
    </tr>`;
  }).join("");

  const totalsRow = `<tr style="border-top:2px solid #e0e0e0;font-weight:600;">
    <td>Total</td><td>—</td>
    <td>${cfmt(totalQty,6)}</td>
    <td>$${totalInvest.toFixed(2)}</td>
    <td>—</td>
    <td class="${totalPnl>=0?'pos':'neg'}">${totalPnl>=0?'+':''}$${Math.abs(totalPnl).toFixed(2)}</td>
  </tr>`;

  const coinIcon = `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${coinColor};color:#fff;font-size:9px;font-weight:700;margin-right:4px;">${coin.slice(0,4)}</span>`;

  return `<div class="buy-card">
    <div class="buy-card-top">
      <div style="display:flex;align-items:center;">
        ${coinIcon}
        <div><div class="buy-sym">${coin}</div><div class="buy-acct">${lots.length} lots</div></div>
      </div>
      <span class="badge badge-buy">Buy ↓</span>
    </div>
    <div class="buy-summary">
      <div class="lot-field"><span class="lot-field-label">Price</span><span class="lot-field-val">${cfmtPrice(currentPrice)}<span class="tag-live">LIVE</span></span></div>
      <div class="lot-field"><span class="lot-field-label">Lowest lot</span><span class="lot-field-val">${cfmtPrice(lowestCost)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Drop from lowest</span><span class="lot-field-val neg">${dropPct}%</span></div>
      <div class="lot-field"><span class="lot-field-label">Buy trigger ≤</span><span class="lot-field-val">${cfmtPrice(buyTrigger)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Total qty</span><span class="lot-field-val">${cfmt(totalQty,6)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Total P&L</span><span class="lot-field-val ${totalPnl>=0?'pos':'neg'}">${totalPnl>=0?'+':''}$${Math.abs(totalPnl).toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Total invested</span><span class="lot-field-val">$${totalInvest.toFixed(2)}</span></div>
      <div class="lot-field"><span class="lot-field-label">Current value</span><span class="lot-field-val ${totalValue>=totalInvest?'pos':'neg'}">$${totalValue.toFixed(2)}</span></div>
    </div>
    <div class="buy-lots-label">All lots</div>
    <table class="buy-lots-table">
      <thead><tr><th>Date</th><th>Cost</th><th>Qty</th><th>Invested</th><th>Chg%</th><th>P&L</th></tr></thead>
      <tbody>${lotsRows}${totalsRow}</tbody>
    </table>
  </div>`;
}

// ── Summary grid (matches renderAll summaryGrid) ───────────────────────────────
function renderCryptoSummary(lots, updatedUAE) {
  const sells = lots.filter(l => l.signal === "SELL").length;
  const nears = lots.filter(l => l.signal === "NEAR_SELL").length;
  const buys  = lots.filter(l => l.signal === "BUY").length;
  const totalValue = lots.reduce((s,l) => s + (l.market_value||0), 0);
  const totalCost  = lots.reduce((s,l) => s + (l.cost_usd>0 ? l.cost_usd*l.qty : 0), 0);
  const totalGain  = totalCost > 0 ? ((totalValue-totalCost)/totalCost*100) : 0;
  const gainColor  = totalGain >= 0 ? "c-buy" : "c-sell";

  document.getElementById("crypto-summary-grid").innerHTML = `
    <div class="metric"><div class="metric-label">Portfolio Value</div><div class="metric-val">$${cfmt(totalValue)}</div></div>
    <div class="metric"><div class="metric-label">Overall P&L</div><div class="metric-val ${gainColor}">${totalGain>=0?"+":""}${cfmt(totalGain)}%</div></div>
    <div class="metric"><div class="metric-label">Sell signals ≥10%</div><div class="metric-val c-sell">${sells}</div></div>
    <div class="metric"><div class="metric-label">Near sell ≥7%</div><div class="metric-val c-warn">${nears}</div></div>
    <div class="metric"><div class="metric-label">Buy signals</div><div class="metric-val c-buy">${buys}</div></div>
    <div class="metric"><div class="metric-label">Open lots</div><div class="metric-val">${lots.length}</div></div>`;

  document.getElementById("crypto-last-updated").textContent = `Prices last updated: ${updatedUAE} UAE`;
}

// ── Reconciliation ─────────────────────────────────────────────────────────────
function renderReconciliation(lots, exchangeBalances) {
  if (!exchangeBalances || Object.keys(exchangeBalances).length === 0) return "";
  const coins = [...new Set(lots.map(l => l.coin))].sort();
  let allMatch = true;
  let rows = "";

  for (const coin of coins) {
    const dashTotal  = lots.filter(l => l.coin === coin).reduce((s,l) => s + l.qty, 0);
    const exchBal    = exchangeBalances[coin] || 0;
    const diff       = Math.abs(dashTotal - exchBal);
    const diffPct    = exchBal > 0 ? (diff / exchBal * 100) : 0;
    const match      = diff <= exchBal * 0.001;
    if (!match) allMatch = false;
    const coinColor  = COIN_COLORS[coin] || "#888";
    const coinIcon   = `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${coinColor};color:#fff;font-size:8px;font-weight:700;">${coin.slice(0,4)}</span>`;
    const status = match
      ? `<span style="color:#27ae60;font-weight:600;">✅ Match</span>`
      : `<span style="color:#e74c3c;font-weight:600;">⚠️ ${diff.toFixed(6)} (${diffPct.toFixed(2)}%)</span>`;
    rows += `<tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:8px 12px;"><div style="display:flex;align-items:center;gap:6px;">${coinIcon}<span style="font-weight:600;font-size:13px;">${coin}</span></div></td>
      <td style="padding:8px 12px;text-align:right;font-size:13px;">${dashTotal.toFixed(6)}</td>
      <td style="padding:8px 12px;text-align:right;font-size:13px;">${exchBal.toFixed(6)}</td>
      <td style="padding:8px 12px;text-align:right;font-size:13px;">${status}</td>
    </tr>`;
  }

  const hColor = allMatch ? "#27ae60" : "#e74c3c";
  const hBg    = allMatch ? "#eafaf1" : "#fdecea";
  const hText  = allMatch ? "✅ All positions match Exchange" : "⚠️ Some positions don't match Exchange";

  return `<details style="margin-bottom:12px;border:1px solid ${hColor}33;border-radius:8px;overflow:hidden;">
    <summary style="padding:10px 14px;background:${hBg};color:${hColor};font-size:13px;font-weight:600;cursor:pointer;list-style:none;">${hText} ▾</summary>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f8f8f8;border-bottom:2px solid #eee;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;">Coin</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;">Dashboard</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;">Exchange</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </details>`;
}

// ── Render all cards ───────────────────────────────────────────────────────────
function renderCryptoCards() {
  const area = document.getElementById("crypto-card-area");
  if (!area) return;

  const lots = cryptoSignalFilter === "all"
    ? cryptoAllLots
    : cryptoAllLots.filter(l => l.signal === cryptoSignalFilter);

  if (lots.length === 0) {
    area.innerHTML = `<div class="no-data">No lots match the current filter.</div>`;
    return;
  }

  // Group buy signals as buy cards (per coin)
  const buyCoins = {};
  if (cryptoSignalFilter === "all" || cryptoSignalFilter === "BUY") {
    for (const lot of cryptoAllLots.filter(l => l.signal === "BUY")) {
      buyCoins[lot.coin] = buyCoins[lot.coin] || [];
      buyCoins[lot.coin].push(lot);
    }
  }

  // Sell/near sell/hold lots as individual cards
  const otherLots = lots.filter(l => l.signal !== "BUY");

  // Sort: SELL first, NEAR_SELL second, HOLD last
  otherLots.sort((a,b) => {
    const o = {SELL:0, NEAR_SELL:1, HOLD:2};
    if (o[a.signal] !== o[b.signal]) return o[a.signal] - o[b.signal];
    return a.coin.localeCompare(b.coin);
  });

  let html = "";

  // Buy cards section
  if (Object.keys(buyCoins).length && cryptoSignalFilter !== "SELL" && cryptoSignalFilter !== "NEAR_SELL" && cryptoSignalFilter !== "HOLD") {
    html += `<div class="section-head">🔵 Buy opportunities — ${Object.keys(buyCoins).length} coin${Object.keys(buyCoins).length>1?"s":""}</div>`;
    html += `<div class="section-wrap">`;
    for (const [coin, coinLots] of Object.entries(buyCoins)) {
      const price = coinLots[0].current_price;
      html += cryptoBuyCardHtml(coin, coinLots, price);
    }
    html += `</div>`;
  }

  // Other lots
  if (otherLots.length && cryptoSignalFilter !== "BUY") {
    if (Object.keys(buyCoins).length && cryptoSignalFilter === "all") {
      html += `<div class="section-head" style="margin-top:8px">📋 All lots</div>`;
    }
    html += `<div class="section-wrap">${otherLots.map(l => cryptoLotCardHtml(l)).join("")}</div>`;
  }

  if (!html) html = `<div class="no-data">No lots match the current filter.</div>`;
  area.innerHTML = html;
}

// ── Filter buttons ─────────────────────────────────────────────────────────────
function setCryptoFilter(f) {
  cryptoSignalFilter = f;
  ["all","SELL","NEAR_SELL","BUY","HOLD"].forEach(k => {
    const btn = document.getElementById("cf2-" + k);
    if (!btn) return;
    const isActive = f === k;
    if (k === "all") {
      btn.style.background  = isActive ? "#333" : "";
      btn.style.color       = isActive ? "#fff" : "";
    } else {
      const colors = {SELL:"#e74c3c", NEAR_SELL:"#e67e22", BUY:"#27ae60", HOLD:"#7f8c8d"};
      btn.style.background  = isActive ? colors[k] : "";
      btn.style.color       = isActive ? "#fff" : colors[k];
      btn.style.borderColor = colors[k];
    }
  });
  renderCryptoCards();
}

// ── Add Buy Modal ──────────────────────────────────────────────────────────────
function showAddBuyModal() {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("crypto-modal").style.display = "flex";
  document.getElementById("ab-date").value  = today;
  document.getElementById("ab-coin").value  = "BTC";
  document.getElementById("ab-qty").value   = "";
  document.getElementById("ab-price").value = "";
  document.getElementById("ab-status").textContent = "";
}
function hideAddBuyModal() { document.getElementById("crypto-modal").style.display = "none"; }

async function saveNewBuy() {
  const coin  = document.getElementById("ab-coin").value.trim().toUpperCase();
  const qty   = parseFloat(document.getElementById("ab-qty").value);
  const price = parseFloat(document.getElementById("ab-price").value);
  const date  = document.getElementById("ab-date").value;
  const status = document.getElementById("ab-status");

  if (!coin || !qty || !price || !date) { status.style.color="#e74c3c"; status.textContent="Please fill all fields."; return; }
  if (!CRYPTO_COINS.includes(coin)) { status.style.color="#e74c3c"; status.textContent=`${coin} is not a tracked coin.`; return; }

  const newLot = { coin, qty, cost_usd: price, date };
  cryptoManualLots.push(newLot);
  localStorage.setItem("crypto_manual_lots", JSON.stringify(cryptoManualLots));
  status.style.color="#27ae60"; status.textContent="✅ Saved locally!";

  if (githubToken) {
    status.textContent = "Saving to GitHub...";
    const saved = await saveToGitHub(cryptoManualLots);
    status.style.color = saved ? "#27ae60" : "#e67e22";
    status.textContent = saved ? "✅ Saved to GitHub!" : "✅ Saved locally. GitHub save failed.";
  }
  setTimeout(() => { hideAddBuyModal(); loadCryptoTab(); }, 1500);
}

async function saveToGitHub(lots) {
  try {
    const getResp = await fetch(GITHUB_API_URL, { headers:{"Authorization":`token ${githubToken}`,"User-Agent":"portfolio-analyzer"} });
    let sha = null;
    if (getResp.ok) sha = (await getResp.json()).sha;
    const content = btoa(JSON.stringify(lots, null, 2));
    const putResp = await fetch(GITHUB_API_URL, {
      method: "PUT",
      headers: {"Authorization":`token ${githubToken}`,"Content-Type":"application/json","User-Agent":"portfolio-analyzer"},
      body: JSON.stringify({ message:`Add manual lot: ${lots[lots.length-1].coin} on ${lots[lots.length-1].date}`, content, ...(sha?{sha}:{}) })
    });
    return putResp.ok;
  } catch(e) { return false; }
}

function showTokenModal() { document.getElementById("token-modal").style.display="flex"; document.getElementById("gh-token-input").value=githubToken; }
function hideTokenModal() { document.getElementById("token-modal").style.display="none"; }
function saveToken() { githubToken=document.getElementById("gh-token-input").value.trim(); localStorage.setItem("gh_token",githubToken); hideTokenModal(); }

// ── Modals ─────────────────────────────────────────────────────────────────────
function renderModals() {
  return `
    <div id="crypto-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:24px;width:90%;max-width:360px;">
        <h3 style="margin:0 0 20px;font-size:16px;font-weight:700;">+ Add Buy Order</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Coin</label>
            <select id="ab-coin" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
              ${CRYPTO_COINS.map(c=>`<option value="${c}">${c}</option>`).join("")}
            </select></div>
          <div><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Quantity</label>
            <input id="ab-qty" type="number" step="any" placeholder="e.g. 0.00814" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
          <div><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Price Paid (USD)</label>
            <input id="ab-price" type="number" step="any" placeholder="e.g. 61382.62" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
          <div><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Date</label>
            <input id="ab-date" type="date" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
          <div id="ab-status" style="font-size:13px;min-height:20px;text-align:center;"></div>
          <div style="display:flex;gap:8px;">
            <button onclick="hideAddBuyModal()" style="flex:1;padding:12px;border-radius:8px;border:1px solid #ddd;background:#f8f8f8;font-size:14px;cursor:pointer;">Cancel</button>
            <button onclick="saveNewBuy()" style="flex:2;padding:12px;border-radius:8px;border:none;background:#27ae60;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Save Buy Order</button>
          </div>
        </div>
      </div>
    </div>
    <div id="token-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:24px;width:90%;max-width:360px;">
        <h3 style="margin:0 0 8px;font-size:16px;font-weight:700;">⚙️ GitHub Token</h3>
        <p style="font-size:12px;color:#999;margin:0 0 16px;">Saves buy orders directly to GitHub so they persist across devices.</p>
        <input id="gh-token-input" type="password" placeholder="ghp_xxxxxxxxxxxx" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:12px;">
        <div style="display:flex;gap:8px;">
          <button onclick="hideTokenModal()" style="flex:1;padding:12px;border-radius:8px;border:1px solid #ddd;background:#f8f8f8;font-size:14px;cursor:pointer;">Cancel</button>
          <button onclick="saveToken()" style="flex:2;padding:12px;border-radius:8px;border:none;background:#333;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Save Token</button>
        </div>
      </div>
    </div>`;
}

// ── Main Load ──────────────────────────────────────────────────────────────────
async function loadCryptoTab() {
  cryptoSignalFilter = "all";
  document.getElementById("crypto-content").innerHTML = `<div class="no-data">Loading crypto lots…</div>`;

  try {
    const resp = await fetch(CRYPTO_JSON_URL + "?t=" + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    let lots = data.lots || [];
    const prices = data.prices || {};
    const exchangeBalances = data.exchange_balances || {};

    // Load manual lots
    try {
      const stored = localStorage.getItem("crypto_manual_lots");
      if (stored) cryptoManualLots = JSON.parse(stored);
    } catch(e) {}
    try {
      const mResp = await fetch(MANUAL_LOTS_URL + "?t=" + Date.now());
      if (mResp.ok) {
        const ghLots = await mResp.json();
        const ghKeys = new Set(ghLots.map(l=>`${l.coin}_${l.date}_${l.qty}`));
        const localExtras = cryptoManualLots.filter(l => !ghKeys.has(`${l.coin}_${l.date}_${l.qty}`));
        cryptoManualLots = [...ghLots, ...localExtras];
        localStorage.setItem("crypto_manual_lots", JSON.stringify(cryptoManualLots));
      }
    } catch(e) {}

    // Merge manual lots
    const existingKeys = new Set(lots.map(l=>`${l.coin}_${l.date}_${Math.round(l.qty*1e6)}`));
    for (const ml of cryptoManualLots) {
      const key = `${ml.coin}_${ml.date}_${Math.round(ml.qty*1e6)}`;
      if (existingKeys.has(key)) continue;
      const price    = prices[ml.coin] || 0;
      const gain_pct = ml.cost_usd > 0 && price > 0 ? ((price - ml.cost_usd) / ml.cost_usd * 100) : 0;
      const coinLots = lots.filter(l => l.coin === ml.coin);
      const lowestCost = coinLots.length > 0 ? Math.min(...coinLots.map(l=>l.cost_usd).filter(c=>c>0)) : ml.cost_usd;
      let signal = "HOLD";
      if (gain_pct >= 10) signal = "SELL";
      else if (gain_pct >= 7) signal = "NEAR_SELL";
      else if (price > 0 && price <= lowestCost * 0.95) signal = "BUY";
      lots.push({ coin:ml.coin, qty:ml.qty, cost_usd:ml.cost_usd, date:ml.date, source:"manual",
        current_price:price, gain_pct:Math.round(gain_pct*100)/100, signal,
        market_value: price>0 ? Math.round(price*ml.qty*100)/100 : 0 });
    }

    cryptoAllLots = lots;

    // Build layout
    document.getElementById("crypto-content").innerHTML = `
      ${renderModals()}
      <div class="header">
        <h1>₿ Crypto Lots</h1>
        <div style="display:flex;gap:8px;align-items:center;">
          <button onclick="showTokenModal()" class="refresh-btn" style="font-size:12px;">⚙️ Token</button>
          <button onclick="showAddBuyModal()" class="refresh-btn" style="background:#27ae60;color:#fff;border-color:#27ae60;">+ Add Buy</button>
        </div>
      </div>
      <div class="price-updated" id="crypto-last-updated"></div>
      <div class="summary-grid" id="crypto-summary-grid"></div>
      <div id="crypto-reconciliation">${renderReconciliation(lots, exchangeBalances)}</div>
      <div class="controls" style="margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:8px;">
          <button id="cf2-all"      onclick="setCryptoFilter('all')"      class="zone-filter-btn active-all">All</button>
          <button id="cf2-SELL"     onclick="setCryptoFilter('SELL')"     class="zone-filter-btn" style="color:#e74c3c;border-color:#e74c3c;">🔴 Sell</button>
          <button id="cf2-NEAR_SELL" onclick="setCryptoFilter('NEAR_SELL')" class="zone-filter-btn" style="color:#e67e22;border-color:#e67e22;">🟡 Near</button>
          <button id="cf2-BUY"      onclick="setCryptoFilter('BUY')"      class="zone-filter-btn" style="color:#27ae60;border-color:#27ae60;">🟢 Buy</button>
          <button id="cf2-HOLD"     onclick="setCryptoFilter('HOLD')"     class="zone-filter-btn" style="color:#7f8c8d;border-color:#7f8c8d;">⚪ Hold</button>
        </div>
      </div>
      <div id="crypto-card-area"></div>`;

    renderCryptoSummary(lots, data.updated_uae);
    renderCryptoCards();

  } catch(err) {
    document.getElementById("crypto-content").innerHTML = `
      <div style="padding:40px;text-align:center;color:#e74c3c;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-weight:600;">Failed to load crypto data</div>
        <div style="font-size:13px;color:#999;margin-top:8px;">${err.message}</div>
      </div>`;
  }
}

window.loadCryptoTab    = loadCryptoTab;
window.setCryptoFilter  = setCryptoFilter;
window.showAddBuyModal  = showAddBuyModal;
window.hideAddBuyModal  = hideAddBuyModal;
window.saveNewBuy       = saveNewBuy;
window.showTokenModal   = showTokenModal;
window.hideTokenModal   = hideTokenModal;
window.saveToken        = saveToken;
