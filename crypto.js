// crypto.js — Crypto Lots tab (5th tab)

const CRYPTO_JSON_URL = `https://raw.githubusercontent.com/shoma414/portfolio-analyzer/main/data/crypto_portfolio.json`;
const MANUAL_LOTS_URL = `https://raw.githubusercontent.com/shoma414/portfolio-analyzer/main/data/crypto_manual_lots.json`;
const GITHUB_API_URL  = `https://api.github.com/repos/shoma414/portfolio-analyzer/contents/data/crypto_manual_lots.json`;
const CRYPTO_COINS    = ["BTC","ETH","SOL","XRP","SUI","CRO","HBAR","ADA","AVAX"];

const COIN_COLORS = {
  BTC:"#f7931a", ETH:"#627eea", SOL:"#9945ff",
  XRP:"#00aae4", SUI:"#4da2ff", CRO:"#002d74",
  HBAR:"#222222", ADA:"#0033ad", AVAX:"#e84142",
};

const SIG_CONFIG = {
  SELL:      { label:"Sell",      color:"#e74c3c", bg:"#fdecea", short:"🔴" },
  NEAR_SELL: { label:"Near Sell", color:"#e67e22", bg:"#fef3e2", short:"🟡" },
  BUY:       { label:"Buy",       color:"#27ae60", bg:"#eafaf1", short:"🟢" },
  HOLD:      { label:"Hold",      color:"#7f8c8d", bg:"#f4f4f4", short:"⚪" },
};

let cryptoAllLots      = [];
let cryptoSignalFilter = "all";
let cryptoCoinFilter   = "all";
let cryptoManualLots   = [];
let githubToken        = localStorage.getItem("gh_token") || "";

// ── Helpers ────────────────────────────────────────────────────────────────────
function cfmt(n, d=2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits:d, maximumFractionDigits:d });
}

function cfmtQty(n) {
  // Smart quantity — trim trailing zeros but keep meaningful precision
  if (!n && n !== 0) return "—";
  const s = parseFloat(n.toFixed(8)).toString();
  return s;
}

function cfmtPrice(p) {
  if (!p || p <= 0) return "—";
  if (p >= 1000) return "$" + cfmt(p, 2);
  if (p >= 1)    return "$" + cfmt(p, 4);
  return "$" + parseFloat(p.toFixed(8)).toString();
}

function coinIcon(coin, size=28) {
  const color = COIN_COLORS[coin] || "#888";
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${color};color:#fff;font-size:${Math.round(size*0.32)}px;font-weight:700;flex-shrink:0;">${coin.slice(0,4)}</span>`;
}

// ── Coin card (one per coin, with lot table inside) ────────────────────────────
function cryptoCoinCardHtml(coin, allCoinLots, signalFilter) {
  const price      = allCoinLots[0]?.current_price || 0;
  const totalQty   = allCoinLots.reduce((s,l) => s + l.qty, 0);
  const totalInvest= allCoinLots.reduce((s,l) => s + (l.cost_usd > 0 ? l.cost_usd * l.qty : 0), 0);
  const totalValue = allCoinLots.reduce((s,l) => s + (l.market_value || 0), 0);
  const totalPnl   = totalValue - totalInvest;
  const avgCost    = totalInvest > 0 ? totalInvest / totalQty : 0;
  const overallPct = totalInvest > 0 ? ((totalValue - totalInvest) / totalInvest * 100) : 0;

  // Signal counts across ALL lots for this coin
  const sigCounts = { SELL:0, NEAR_SELL:0, BUY:0, HOLD:0 };
  for (const l of allCoinLots) sigCounts[l.signal] = (sigCounts[l.signal] || 0) + 1;

  // Signal badge — show counts of each signal type
  const badgeParts = [];
  if (sigCounts.SELL)      badgeParts.push(`<span style="color:#e74c3c;font-weight:700;">🔴 ${sigCounts.SELL}</span>`);
  if (sigCounts.NEAR_SELL) badgeParts.push(`<span style="color:#e67e22;font-weight:700;">🟡 ${sigCounts.NEAR_SELL}</span>`);
  if (sigCounts.BUY)       badgeParts.push(`<span style="color:#27ae60;font-weight:700;">🟢 ${sigCounts.BUY}</span>`);
  if (sigCounts.HOLD)      badgeParts.push(`<span style="color:#7f8c8d;font-weight:700;">⚪ ${sigCounts.HOLD}</span>`);
  const signalBadges = `<div style="display:flex;gap:8px;align-items:center;font-size:13px;">${badgeParts.join("")}</div>`;

  // Card border color — worst signal
  let borderColor = "#e8e8e8";
  if (sigCounts.SELL)           borderColor = "#e74c3c";
  else if (sigCounts.NEAR_SELL) borderColor = "#e67e22";
  else if (sigCounts.BUY)       borderColor = "#27ae60";

  // Lots to show in table — filtered by signal if filter is active
  const visibleLots = signalFilter === "all"
    ? allCoinLots
    : allCoinLots.filter(l => l.signal === signalFilter);

  if (visibleLots.length === 0) return ""; // coin has no lots matching filter

  // Sort lots: biggest loss first (most negative gain%) → biggest gain last
  const sortedLots = [...visibleLots].sort((a,b) => a.gain_pct - b.gain_pct);

  // Individual lot rows
  const lotRows = sortedLots.map(lot => {
    const sig      = SIG_CONFIG[lot.signal];
    const pct      = lot.gain_pct;
    const pnl      = (lot.current_price - lot.cost_usd) * lot.qty;
    const isManual = lot.source === "manual";
    return `
      <tr style="border-bottom:1px solid #f5f5f5;">
        <td style="padding:8px 10px;font-size:12px;color:#555;">${lot.date}${isManual?` <span style="font-size:9px;background:#fff3cd;color:#856404;padding:1px 4px;border-radius:3px;">manual</span>`:""}</td>
        <td style="padding:8px 10px;text-align:right;font-size:12px;">${cfmtQty(lot.qty)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:12px;">${cfmtPrice(lot.cost_usd)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:12px;font-weight:600;color:${pct>=0?"#27ae60":"#e74c3c"};">${pct>=0?"+":""}${cfmt(pct,1)}%</td>
        <td style="padding:8px 10px;text-align:right;font-size:12px;color:${pnl>=0?"#27ae60":"#e74c3c"};">${pnl>=0?"+":""}$${Math.abs(pnl).toFixed(2)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:12px;">$${(lot.market_value||0).toFixed(2)}</td>
        <td style="padding:8px 10px;text-align:center;">
          <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${sig.bg};color:${sig.color};">${sig.label}</span>
        </td>
      </tr>`;
  }).join("");

  // Totals row for visible lots
  const visTotal     = visibleLots.reduce((s,l) => s + l.qty, 0);
  const visTotalVal  = visibleLots.reduce((s,l) => s + (l.market_value||0), 0);
  const visTotalInv  = visibleLots.reduce((s,l) => s + (l.cost_usd>0?l.cost_usd*l.qty:0), 0);
  const visTotalPnl  = visTotalVal - visTotalInv;

  const totalsRow = `
    <tr style="border-top:2px solid #e0e0e0;background:#fafafa;font-weight:600;">
      <td style="padding:8px 10px;font-size:12px;color:#666;">${signalFilter==="all"?"All lots":`${visibleLots.length} filtered lot${visibleLots.length>1?"s":""}`}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;">${cfmtQty(visTotal)}</td>
      <td style="padding:8px 10px;"></td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;color:${visTotalPnl>=0?"#27ae60":"#e74c3c"};">${visTotalPnl>=0?"+":""}${visTotalInv>0?cfmt((visTotalPnl/visTotalInv*100),1)+"%":"—"}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;color:${visTotalPnl>=0?"#27ae60":"#e74c3c"};">${visTotalPnl>=0?"+":""}$${Math.abs(visTotalPnl).toFixed(2)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;">$${visTotalVal.toFixed(2)}</td>
      <td></td>
    </tr>`;

  return `
    <div class="lot-card" style="border-left:3px solid ${borderColor};margin-bottom:12px;">
      <!-- Card header -->
      <div class="lot-card-top">
        <div style="display:flex;align-items:center;gap:10px;">
          ${coinIcon(coin, 36)}
          <div>
            <div class="lot-sym">${coin}</div>
            <div class="lot-acct">${allCoinLots.length} lot${allCoinLots.length>1?"s":""}</div>
          </div>
        </div>
        ${signalBadges}
      </div>

      <!-- Coin summary grid -->
      <div class="lot-grid">
        <div class="lot-field"><span class="lot-field-label">Total Qty</span><span class="lot-field-val">${cfmtQty(totalQty)}</span></div>
        <div class="lot-field"><span class="lot-field-label">Avg Cost</span><span class="lot-field-val">${cfmtPrice(avgCost)}</span></div>
        <div class="lot-field"><span class="lot-field-label">Price</span><span class="lot-field-val">${cfmtPrice(price)}<span class="tag-live">LIVE</span></span></div>
        <div class="lot-field"><span class="lot-field-label">Overall P&L %</span><span class="lot-field-val ${overallPct>=0?"pos":"neg"}">${overallPct>=0?"+":""}${cfmt(overallPct,1)}%</span></div>
        <div class="lot-field"><span class="lot-field-label">Total P&L $</span><span class="lot-field-val ${totalPnl>=0?"pos":"neg"}">${totalPnl>=0?"+":""}$${Math.abs(totalPnl).toFixed(2)}</span></div>
        <div class="lot-field"><span class="lot-field-label">Invested</span><span class="lot-field-val">$${totalInvest.toFixed(2)}</span></div>
        <div class="lot-field"><span class="lot-field-label">Current Value</span><span class="lot-field-val ${totalValue>=totalInvest?"pos":"neg"}">$${totalValue.toFixed(2)}</span></div>
      </div>

      <!-- Individual lots table -->
      <div class="buy-lots-label">Individual lots${signalFilter!=="all"?` — ${SIG_CONFIG[signalFilter]?.label} only`:""}</div>
      <div style="overflow-x:auto;">
        <table class="buy-lots-table" style="width:100%;">
          <thead>
            <tr>
              <th>Date</th>
              <th style="text-align:right;">Qty</th>
              <th style="text-align:right;">Cost</th>
              <th style="text-align:right;">Gain%</th>
              <th style="text-align:right;">P&L</th>
              <th style="text-align:right;">Value</th>
              <th style="text-align:center;">Signal</th>
            </tr>
          </thead>
          <tbody>${lotRows}${totalsRow}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Summary grid ───────────────────────────────────────────────────────────────
function renderCryptoSummary(lots, updatedUAE) {
  const sells  = lots.filter(l => l.signal==="SELL").length;
  const nears  = lots.filter(l => l.signal==="NEAR_SELL").length;
  const buys   = lots.filter(l => l.signal==="BUY").length;
  const totalValue  = lots.reduce((s,l) => s+(l.market_value||0), 0);
  const totalCost   = lots.reduce((s,l) => s+(l.cost_usd>0?l.cost_usd*l.qty:0), 0);
  const totalGain   = totalCost>0 ? ((totalValue-totalCost)/totalCost*100) : 0;
  const gainClass   = totalGain>=0 ? "c-buy" : "c-sell";

  document.getElementById("crypto-summary-grid").innerHTML = `
    <div class="metric"><div class="metric-label">Portfolio Value</div><div class="metric-val">$${cfmt(totalValue)}</div></div>
    <div class="metric"><div class="metric-label">Overall P&L</div><div class="metric-val ${gainClass}">${totalGain>=0?"+":""}${cfmt(totalGain)}%</div></div>
    <div class="metric"><div class="metric-label">Sell signals</div><div class="metric-val c-sell">${sells}</div></div>
    <div class="metric"><div class="metric-label">Near sell</div><div class="metric-val c-warn">${nears}</div></div>
    <div class="metric"><div class="metric-label">Buy signals</div><div class="metric-val c-buy">${buys}</div></div>
    <div class="metric"><div class="metric-label">Open lots</div><div class="metric-val">${lots.length}</div></div>`;

  document.getElementById("crypto-last-updated").textContent = `Prices last updated: ${updatedUAE} UAE`;
}

// ── Reconciliation ─────────────────────────────────────────────────────────────
function renderReconciliation(lots, exchangeBalances) {
  if (!exchangeBalances || Object.keys(exchangeBalances).length===0) return "";
  const coins = [...new Set(lots.map(l=>l.coin))].sort();
  let allMatch = true;
  let rows = "";
  for (const coin of coins) {
    const dashTotal = lots.filter(l=>l.coin===coin).reduce((s,l)=>s+l.qty,0);
    const exchBal   = exchangeBalances[coin] || 0;
    const diff      = Math.abs(dashTotal - exchBal);
    const diffPct   = exchBal>0 ? (diff/exchBal*100) : 0;
    const match     = diff <= exchBal*0.001;
    if (!match) allMatch = false;
    const status = match
      ? `<span style="color:#27ae60;font-weight:600;">✅ Match</span>`
      : `<span style="color:#e74c3c;font-weight:600;">⚠️ ${cfmtQty(diff)} (${diffPct.toFixed(2)}%)</span>`;
    rows += `<tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:8px 12px;"><div style="display:flex;align-items:center;gap:6px;">${coinIcon(coin,22)}<span style="font-weight:600;font-size:13px;">${coin}</span></div></td>
      <td style="padding:8px 12px;text-align:right;font-size:13px;">${cfmtQty(dashTotal)}</td>
      <td style="padding:8px 12px;text-align:right;font-size:13px;">${cfmtQty(exchBal)}</td>
      <td style="padding:8px 12px;text-align:right;font-size:13px;">${status}</td>
    </tr>`;
  }
  const hColor = allMatch?"#27ae60":"#e74c3c";
  const hBg    = allMatch?"#eafaf1":"#fdecea";
  const hText  = allMatch?"✅ All positions match Exchange":"⚠️ Some positions don't match Exchange";
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

// ── Render cards ───────────────────────────────────────────────────────────────
function renderCryptoCards() {
  const area = document.getElementById("crypto-card-area");
  if (!area) return;

  // Apply coin filter first
  const coinFiltered = cryptoCoinFilter==="all"
    ? cryptoAllLots
    : cryptoAllLots.filter(l => l.coin===cryptoCoinFilter);

  // Group by coin
  const grouped = {};
  for (const lot of coinFiltered) {
    grouped[lot.coin] = grouped[lot.coin] || [];
    grouped[lot.coin].push(lot);
  }

  // Sort coins: those with sell signals first, then near sell, then buy, then hold
  const sigPriority = coin => {
    const lots = grouped[coin];
    if (lots.some(l=>l.signal==="SELL"))      return 0;
    if (lots.some(l=>l.signal==="NEAR_SELL")) return 1;
    if (lots.some(l=>l.signal==="BUY"))       return 2;
    return 3;
  };
  const sortedCoins = Object.keys(grouped).sort((a,b) => sigPriority(a)-sigPriority(b));

  let html = "";
  for (const coin of sortedCoins) {
    const cardHtml = cryptoCoinCardHtml(coin, grouped[coin], cryptoSignalFilter);
    if (cardHtml) html += cardHtml;
  }

  if (!html) html = `<div class="no-data">No lots match the current filters.</div>`;
  area.innerHTML = html;
}

// ── Filter handlers ────────────────────────────────────────────────────────────
function setCryptoFilter(f) {
  cryptoSignalFilter = f;
  ["all","SELL","NEAR_SELL","BUY","HOLD"].forEach(k => {
    const btn = document.getElementById("cf-sig-"+k);
    if (!btn) return;
    const isActive = f===k;
    const colors = {SELL:"#e74c3c",NEAR_SELL:"#e67e22",BUY:"#27ae60",HOLD:"#7f8c8d"};
    if (k==="all") {
      btn.style.background = isActive?"#333":"";
      btn.style.color      = isActive?"#fff":"";
    } else {
      btn.style.background = isActive?colors[k]:"";
      btn.style.color      = isActive?"#fff":colors[k];
      btn.style.borderColor = colors[k];
    }
  });
  renderCryptoCards();
}

function setCryptoCoinFilter(coin) {
  cryptoCoinFilter = coin;
  // Update coin filter buttons
  ["all",...CRYPTO_COINS].forEach(c => {
    const btn = document.getElementById("cf-coin-"+c);
    if (!btn) return;
    const isActive = coin===c;
    const color = COIN_COLORS[c] || "#333";
    btn.style.background  = isActive ? (c==="all"?"#333":color) : "";
    btn.style.color       = isActive ? "#fff" : (c==="all"?"#333":color);
    btn.style.borderColor = c==="all" ? "#333" : color;
  });
  renderCryptoCards();
}

// ── Add Buy Modal ──────────────────────────────────────────────────────────────
function showAddBuyModal() {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("crypto-modal").style.display="flex";
  document.getElementById("ab-date").value=today;
  document.getElementById("ab-coin").value="BTC";
  document.getElementById("ab-qty").value="";
  document.getElementById("ab-price").value="";
  document.getElementById("ab-status").textContent="";
}
function hideAddBuyModal() { document.getElementById("crypto-modal").style.display="none"; }

async function saveNewBuy() {
  const coin  = document.getElementById("ab-coin").value.trim().toUpperCase();
  const qty   = parseFloat(document.getElementById("ab-qty").value);
  const price = parseFloat(document.getElementById("ab-price").value);
  const date  = document.getElementById("ab-date").value;
  const status = document.getElementById("ab-status");
  if (!coin||!qty||!price||!date) { status.style.color="#e74c3c"; status.textContent="Please fill all fields."; return; }
  if (!CRYPTO_COINS.includes(coin)) { status.style.color="#e74c3c"; status.textContent=`${coin} is not a tracked coin.`; return; }
  const newLot = { coin, qty, cost_usd:price, date };
  cryptoManualLots.push(newLot);
  localStorage.setItem("crypto_manual_lots", JSON.stringify(cryptoManualLots));
  status.style.color="#27ae60"; status.textContent="✅ Saved locally!";
  if (githubToken) {
    status.textContent="Saving to GitHub...";
    const saved = await saveToGitHub(cryptoManualLots);
    status.style.color=saved?"#27ae60":"#e67e22";
    status.textContent=saved?"✅ Saved to GitHub!":"✅ Saved locally. GitHub save failed.";
  }
  setTimeout(()=>{ hideAddBuyModal(); loadCryptoTab(); }, 1500);
}

async function saveToGitHub(lots) {
  try {
    const getResp = await fetch(GITHUB_API_URL,{headers:{"Authorization":`token ${githubToken}`,"User-Agent":"portfolio-analyzer"}});
    let sha=null;
    if (getResp.ok) sha=(await getResp.json()).sha;
    const content = btoa(JSON.stringify(lots,null,2));
    const putResp = await fetch(GITHUB_API_URL,{
      method:"PUT",
      headers:{"Authorization":`token ${githubToken}`,"Content-Type":"application/json","User-Agent":"portfolio-analyzer"},
      body:JSON.stringify({message:`Add manual lot: ${lots[lots.length-1].coin} on ${lots[lots.length-1].date}`,content,...(sha?{sha}:{})})
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
        <p style="font-size:12px;color:#999;margin:0 0 16px;">Saves buy orders to GitHub so they persist across devices.</p>
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
  cryptoCoinFilter   = "all";
  document.getElementById("crypto-content").innerHTML = `<div class="no-data">Loading crypto lots…</div>`;

  try {
    const resp = await fetch(CRYPTO_JSON_URL + "?t=" + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    let lots = data.lots || [];
    const prices = data.prices || {};
    const exchangeBalances = data.exchange_balances || {};

    // Load manual lots from localStorage
    try { const s=localStorage.getItem("crypto_manual_lots"); if(s) cryptoManualLots=JSON.parse(s); } catch(e){}
    // Sync with GitHub
    try {
      const mResp = await fetch(MANUAL_LOTS_URL+"?t="+Date.now());
      if (mResp.ok) {
        const ghLots = await mResp.json();
        const ghKeys = new Set(ghLots.map(l=>`${l.coin}_${l.date}_${l.qty}`));
        const localExtras = cryptoManualLots.filter(l=>!ghKeys.has(`${l.coin}_${l.date}_${l.qty}`));
        cryptoManualLots = [...ghLots, ...localExtras];
        localStorage.setItem("crypto_manual_lots", JSON.stringify(cryptoManualLots));
      }
    } catch(e){}

    // Merge manual lots
    const existingKeys = new Set(lots.map(l=>`${l.coin}_${l.date}_${Math.round(l.qty*1e6)}`));
    for (const ml of cryptoManualLots) {
      const key = `${ml.coin}_${ml.date}_${Math.round(ml.qty*1e6)}`;
      if (existingKeys.has(key)) continue;
      const price    = prices[ml.coin]||0;
      const gain_pct = ml.cost_usd>0&&price>0 ? ((price-ml.cost_usd)/ml.cost_usd*100) : 0;
      const coinLots = lots.filter(l=>l.coin===ml.coin);
      const lowestCost = coinLots.length>0 ? Math.min(...coinLots.map(l=>l.cost_usd).filter(c=>c>0)) : ml.cost_usd;
      let signal="HOLD";
      if (gain_pct>=10) signal="SELL";
      else if (gain_pct>=7) signal="NEAR_SELL";
      else if (price>0&&price<=lowestCost*0.95) signal="BUY";
      lots.push({coin:ml.coin,qty:ml.qty,cost_usd:ml.cost_usd,date:ml.date,source:"manual",
        current_price:price,gain_pct:Math.round(gain_pct*100)/100,signal,
        market_value:price>0?Math.round(price*ml.qty*100)/100:0});
    }

    cryptoAllLots = lots;

    // Coin filter buttons
    const coinFilterBtns = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <button id="cf-coin-all" onclick="setCryptoCoinFilter('all')"
          style="padding:5px 12px;border-radius:16px;border:1px solid #333;background:#333;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">All</button>
        ${CRYPTO_COINS.filter(c=>lots.some(l=>l.coin===c)).map(c=>`
          <button id="cf-coin-${c}" onclick="setCryptoCoinFilter('${c}')"
            style="padding:5px 12px;border-radius:16px;border:1px solid ${COIN_COLORS[c]||'#888'};background:transparent;color:${COIN_COLORS[c]||'#888'};font-size:12px;font-weight:600;cursor:pointer;">${c}</button>
        `).join("")}
      </div>`;

    // Signal filter buttons
    const sigFilterBtns = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
        <button id="cf-sig-all"       onclick="setCryptoFilter('all')"       class="zone-filter-btn active-all">All</button>
        <button id="cf-sig-SELL"      onclick="setCryptoFilter('SELL')"      class="zone-filter-btn" style="color:#e74c3c;border-color:#e74c3c;">🔴 Sell</button>
        <button id="cf-sig-NEAR_SELL" onclick="setCryptoFilter('NEAR_SELL')" class="zone-filter-btn" style="color:#e67e22;border-color:#e67e22;">🟡 Near</button>
        <button id="cf-sig-BUY"       onclick="setCryptoFilter('BUY')"       class="zone-filter-btn" style="color:#27ae60;border-color:#27ae60;">🟢 Buy</button>
        <button id="cf-sig-HOLD"      onclick="setCryptoFilter('HOLD')"      class="zone-filter-btn" style="color:#7f8c8d;border-color:#7f8c8d;">⚪ Hold</button>
      </div>`;

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
        ${coinFilterBtns}
        ${sigFilterBtns}
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

window.loadCryptoTab       = loadCryptoTab;
window.setCryptoFilter     = setCryptoFilter;
window.setCryptoCoinFilter = setCryptoCoinFilter;
window.showAddBuyModal     = showAddBuyModal;
window.hideAddBuyModal     = hideAddBuyModal;
window.saveNewBuy          = saveNewBuy;
window.showTokenModal      = showTokenModal;
window.hideTokenModal      = hideTokenModal;
window.saveToken           = saveToken;
