// crypto.js — Crypto Lots tab (5th tab)

const CRYPTO_JSON_URL   = `https://raw.githubusercontent.com/shoma414/portfolio-analyzer/main/data/crypto_portfolio.json`;
const MANUAL_LOTS_URL   = `https://raw.githubusercontent.com/shoma414/portfolio-analyzer/main/data/crypto_manual_lots.json`;
const GITHUB_API_URL    = `https://api.github.com/repos/shoma414/portfolio-analyzer/contents/data/crypto_manual_lots.json`;
const TRACKED_COINS     = ["BTC","ETH","SOL","XRP","SUI","CRO","HBAR","ADA","AVAX"];

const SIGNAL_CONFIG = {
  SELL:      { label: "Sell",      color: "#e74c3c", bg: "#fdecea" },
  NEAR_SELL: { label: "Near Sell", color: "#e67e22", bg: "#fef3e2" },
  BUY:       { label: "Buy",       color: "#27ae60", bg: "#eafaf1" },
  HOLD:      { label: "Hold",      color: "#7f8c8d", bg: "#f4f4f4" },
};

const COIN_COLORS = {
  BTC:  "#f7931a", ETH:  "#627eea", SOL:  "#9945ff",
  XRP:  "#00aae4", SUI:  "#4da2ff", CRO:  "#002d74",
  HBAR: "#222222", ADA:  "#0033ad", AVAX: "#e84142",
};

let cryptoAllLots      = [];
let cryptoSignalFilter = "all";
let cryptoManualLots   = [];
let githubToken        = localStorage.getItem("gh_token") || "";

// ── Helpers ────────────────────────────────────────────────────────────────────
function getCoinIcon(coin) {
  const color = COIN_COLORS[coin] || "#888";
  return `<span style="
    display:inline-flex;align-items:center;justify-content:center;
    width:32px;height:32px;border-radius:50%;
    background:${color};color:#fff;
    font-size:10px;font-weight:700;flex-shrink:0;
  ">${coin.slice(0,4)}</span>`;
}

function fmt(n, d=2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits:d, maximumFractionDigits:d });
}

function fmtPrice(p) {
  if (!p || p <= 0) return "—";
  if (p >= 1000) return "$" + fmt(p, 2);
  if (p >= 1)    return "$" + fmt(p, 4);
  return "$" + fmt(p, 6);
}

// ── Filter ─────────────────────────────────────────────────────────────────────
function setCryptoFilter(f) {
  cryptoSignalFilter = f;
  ["all","SELL","NEAR_SELL","BUY","HOLD"].forEach(k => {
    const btn = document.getElementById("cf-" + k);
    if (!btn) return;
    const isActive = f === k;
    if (k === "all") {
      btn.style.background  = isActive ? "#333" : "transparent";
      btn.style.color       = isActive ? "#fff" : "#333";
      btn.style.borderColor = isActive ? "#333" : "#ddd";
    } else {
      const cfg = SIGNAL_CONFIG[k];
      btn.style.background  = isActive ? cfg.color : "transparent";
      btn.style.color       = isActive ? "#fff"    : cfg.color;
      btn.style.borderColor = cfg.color;
    }
  });
  renderCryptoTable();
}

// ── Add Buy Modal ──────────────────────────────────────────────────────────────
function showAddBuyModal() {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("crypto-modal").style.display = "flex";
  document.getElementById("ab-date").value = today;
  document.getElementById("ab-coin").value = "BTC";
  document.getElementById("ab-qty").value  = "";
  document.getElementById("ab-price").value = "";
  document.getElementById("ab-status").textContent = "";
}

function hideAddBuyModal() {
  document.getElementById("crypto-modal").style.display = "none";
}

async function saveNewBuy() {
  const coin  = document.getElementById("ab-coin").value.trim().toUpperCase();
  const qty   = parseFloat(document.getElementById("ab-qty").value);
  const price = parseFloat(document.getElementById("ab-price").value);
  const date  = document.getElementById("ab-date").value;
  const status = document.getElementById("ab-status");

  if (!coin || !qty || !price || !date) {
    status.style.color = "#e74c3c";
    status.textContent = "Please fill all fields.";
    return;
  }
  if (!TRACKED_COINS.includes(coin)) {
    status.style.color = "#e74c3c";
    status.textContent = `${coin} is not a tracked coin.`;
    return;
  }

  const newLot = { coin, qty, cost_usd: price, date };

  // Save to localStorage immediately
  cryptoManualLots.push(newLot);
  localStorage.setItem("crypto_manual_lots", JSON.stringify(cryptoManualLots));
  status.style.color = "#27ae60";
  status.textContent = "✅ Saved locally!";

  // Try to save to GitHub if token is set
  if (githubToken) {
    status.textContent = "Saving to GitHub...";
    const saved = await saveToGitHub(cryptoManualLots);
    if (saved) {
      status.style.color = "#27ae60";
      status.textContent = "✅ Saved to GitHub! Will appear after next workflow run.";
    } else {
      status.style.color = "#e67e22";
      status.textContent = "✅ Saved locally. GitHub save failed — check token.";
    }
  }

  // Refresh table with new lot included
  setTimeout(() => {
    hideAddBuyModal();
    loadCryptoTab();
  }, 1500);
}

async function saveToGitHub(lots) {
  try {
    // Get current file SHA
    const getResp = await fetch(GITHUB_API_URL, {
      headers: {
        "Authorization": `token ${githubToken}`,
        "User-Agent": "portfolio-analyzer",
      }
    });
    let sha = null;
    if (getResp.ok) {
      const data = await getResp.json();
      sha = data.sha;
    }

    const content = btoa(JSON.stringify(lots, null, 2));
    const body = {
      message: `Add manual lot: ${lots[lots.length-1].coin} on ${lots[lots.length-1].date}`,
      content,
      ...(sha ? { sha } : {}),
    };

    const putResp = await fetch(GITHUB_API_URL, {
      method: "PUT",
      headers: {
        "Authorization": `token ${githubToken}`,
        "Content-Type": "application/json",
        "User-Agent": "portfolio-analyzer",
      },
      body: JSON.stringify(body),
    });
    return putResp.ok;
  } catch(e) {
    console.error("GitHub save error:", e);
    return false;
  }
}

function showTokenModal() {
  document.getElementById("token-modal").style.display = "flex";
  document.getElementById("gh-token-input").value = githubToken;
}

function hideTokenModal() {
  document.getElementById("token-modal").style.display = "none";
}

function saveToken() {
  githubToken = document.getElementById("gh-token-input").value.trim();
  localStorage.setItem("gh_token", githubToken);
  hideTokenModal();
  document.getElementById("token-status").textContent = githubToken ? "🔑 Token set" : "";
}

// ── Summary Cards ──────────────────────────────────────────────────────────────
function renderSummaryCards(lots, updatedUAE) {
  const totalValue   = lots.reduce((s,l) => s + (l.market_value||0), 0);
  const totalCost    = lots.reduce((s,l) => s + (l.cost_usd>0 ? l.cost_usd*l.qty : 0), 0);
  const totalGainPct = totalCost > 0 ? ((totalValue-totalCost)/totalCost*100) : 0;
  const sellCount    = lots.filter(l => l.signal==="SELL").length;
  const nearCount    = lots.filter(l => l.signal==="NEAR_SELL").length;
  const buyCount     = lots.filter(l => l.signal==="BUY").length;
  const gainColor    = totalGainPct >= 0 ? "#27ae60" : "#e74c3c";

  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
      <div class="cr-card">
        <div class="cr-label">Portfolio Value</div>
        <div class="cr-value">$${fmt(totalValue)}</div>
        <div class="cr-sub" style="color:${gainColor}">${totalGainPct>=0?"+":""}${fmt(totalGainPct)}% overall</div>
      </div>
      <div class="cr-card">
        <div class="cr-label">Open Lots</div>
        <div class="cr-value">${lots.length}</div>
        <div class="cr-sub">${[...new Set(lots.map(l=>l.coin))].length} coins</div>
      </div>
      <div class="cr-card">
        <div class="cr-label">Sell Signals</div>
        <div class="cr-value" style="color:#e74c3c">${sellCount}</div>
        <div class="cr-sub" style="color:#e67e22">${nearCount} near sell</div>
      </div>
      <div class="cr-card">
        <div class="cr-label">Buy Signals</div>
        <div class="cr-value" style="color:#27ae60">${buyCount}</div>
        <div class="cr-sub">lots at opportunity</div>
      </div>
    </div>
    <div style="font-size:12px;color:#999;margin-bottom:12px;">Last updated: ${updatedUAE} UAE</div>`;
}

// ── Filter Bar ─────────────────────────────────────────────────────────────────
function renderFilterBar() {
  function btnStyle(k) {
    const isActive = cryptoSignalFilter === k;
    if (k === "all") return `id="cf-all" onclick="setCryptoFilter('all')" style="padding:6px 14px;border-radius:20px;border:1px solid #ddd;background:${isActive?"#333":"transparent"};color:${isActive?"#fff":"#333"};font-size:12px;font-weight:600;cursor:pointer;"`;
    const cfg = SIGNAL_CONFIG[k];
    return `id="cf-${k}" onclick="setCryptoFilter('${k}')" style="padding:6px 14px;border-radius:20px;border:1px solid ${cfg.color};background:${isActive?cfg.color:"transparent"};color:${isActive?"#fff":cfg.color};font-size:12px;font-weight:600;cursor:pointer;"`;
  }
  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
      <span style="font-size:13px;font-weight:600;color:#333;">Filter:</span>
      <button ${btnStyle("all")}>All</button>
      <button ${btnStyle("SELL")}>🔴 Sell</button>
      <button ${btnStyle("NEAR_SELL")}>🟡 Near Sell</button>
      <button ${btnStyle("BUY")}>🟢 Buy</button>
      <button ${btnStyle("HOLD")}>⚪ Hold</button>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
        <span id="token-status" style="font-size:11px;color:#27ae60;">${githubToken?"🔑 Token set":""}</span>
        <button onclick="showTokenModal()" style="padding:6px 12px;border-radius:8px;border:1px solid #ddd;background:#f8f8f8;font-size:12px;cursor:pointer;">⚙️ Token</button>
        <button onclick="showAddBuyModal()" style="padding:6px 14px;border-radius:8px;border:none;background:#27ae60;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">+ Add Buy</button>
      </div>
    </div>`;
}

// ── Table ──────────────────────────────────────────────────────────────────────
function renderCryptoTable() {
  const tableArea = document.getElementById("crypto-table-area");
  if (!tableArea) return;

  const lots = cryptoSignalFilter === "all"
    ? cryptoAllLots
    : cryptoAllLots.filter(l => l.signal === cryptoSignalFilter);

  if (lots.length === 0) {
    tableArea.innerHTML = `<div style="padding:40px;text-align:center;color:#999;font-size:13px;">No lots match the selected filter.</div>`;
    return;
  }

  const grouped = {};
  for (const lot of lots) {
    grouped[lot.coin] = grouped[lot.coin] || [];
    grouped[lot.coin].push(lot);
  }

  const sortedCoins = Object.keys(grouped).sort((a,b) => {
    const va = grouped[a].reduce((s,l)=>s+(l.market_value||0),0);
    const vb = grouped[b].reduce((s,l)=>s+(l.market_value||0),0);
    return vb - va;
  });

  for (const coin of sortedCoins) {
    grouped[coin].sort((a,b) => a.date.localeCompare(b.date));
  }

  let rows = "";
  for (const coin of sortedCoins) {
    const coinLots    = grouped[coin];
    const allCoinLots = cryptoAllLots.filter(l => l.coin === coin);

    coinLots.forEach((lot, i) => {
      const sig       = SIGNAL_CONFIG[lot.signal] || SIGNAL_CONFIG.HOLD;
      const gain      = lot.gain_pct;
      const gainColor = gain >= 0 ? "#27ae60" : "#e74c3c";
      const gainStr   = (gain >= 0 ? "+" : "") + fmt(gain) + "%";
      const isManual  = lot.source === "manual";
      const coinCell  = i === 0
        ? `<div style="display:flex;align-items:center;gap:8px;">
             ${getCoinIcon(lot.coin)}
             <div>
               <div style="font-weight:600;font-size:14px;">${lot.coin}</div>
               <div style="font-size:11px;color:#999;">${allCoinLots.length} lot${allCoinLots.length>1?"s":""}</div>
             </div>
           </div>`
        : `<div style="padding-left:40px;color:#bbb;font-size:12px;">↳</div>`;

      rows += `
        <tr style="border-bottom:1px solid #f0f0f0;${isManual?"background:#fffef0;":""}">
          <td style="padding:10px 12px;">${coinCell}</td>
          <td style="padding:10px 12px;font-size:13px;color:#555;">${lot.date}${isManual?' <span style="font-size:10px;color:#e67e22;">●manual</span>':''}</td>
          <td style="padding:10px 12px;text-align:right;font-size:13px;">${fmt(lot.qty,6)}</td>
          <td style="padding:10px 12px;text-align:right;font-size:13px;">${lot.cost_usd>0?fmtPrice(lot.cost_usd):"—"}</td>
          <td style="padding:10px 12px;text-align:right;font-size:13px;font-weight:500;">${fmtPrice(lot.current_price)}</td>
          <td style="padding:10px 12px;text-align:right;font-size:13px;font-weight:600;color:${gainColor};">${lot.cost_usd>0?gainStr:"—"}</td>
          <td style="padding:10px 12px;text-align:right;font-size:13px;">$${fmt(lot.market_value)}</td>
          <td style="padding:10px 12px;text-align:center;">
            <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;background:${sig.bg};color:${sig.color};border:1px solid ${sig.color}33;">${sig.label}</span>
          </td>
        </tr>`;
    });

    const totalVal  = coinLots.reduce((s,l)=>s+(l.market_value||0),0);
    const totalQty  = coinLots.reduce((s,l)=>s+l.qty,0);
    const totalCost = coinLots.reduce((s,l)=>s+(l.cost_usd>0?l.cost_usd*l.qty:0),0);
    const totalGain = totalCost>0?((totalVal-totalCost)/totalCost*100):0;
    const gc        = totalGain>=0?"#27ae60":"#e74c3c";
    rows += `
      <tr style="background:#fafafa;border-bottom:2px solid #e8e8e8;">
        <td colspan="2" style="padding:6px 12px 6px 52px;font-size:12px;color:#999;font-weight:600;">${coin} total</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;font-weight:600;color:#555;">${fmt(totalQty,6)}</td>
        <td colspan="2" style="padding:6px 12px;"></td>
        <td style="padding:6px 12px;"></td>
        <td style="padding:6px 12px;text-align:right;font-size:13px;font-weight:600;">$${fmt(totalVal)}</td>
        <td style="padding:6px 12px;text-align:center;font-size:12px;font-weight:600;color:${gc};">${totalCost>0?(totalGain>=0?"+":"")+ fmt(totalGain)+"%":"—"}</td>
      </tr>`;
  }

  tableArea.innerHTML = `
    <div style="overflow-x:auto;border:1px solid #eee;border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;min-width:700px;">
        <thead>
          <tr style="background:#f8f8f8;border-bottom:2px solid #eee;">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#666;font-weight:600;">Coin</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#666;font-weight:600;">Buy Date</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;">Quantity</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;">Cost/Unit</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;">Current</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;">Gain/Loss</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;">Value</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#666;font-weight:600;">Signal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Modals HTML ────────────────────────────────────────────────────────────────
function renderModals() {
  return `
    <!-- Add Buy Modal -->
    <div id="crypto-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:24px;width:90%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <h3 style="margin:0 0 20px;font-size:16px;font-weight:700;">+ Add Buy Order</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Coin</label>
            <select id="ab-coin" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
              ${TRACKED_COINS.map(c=>`<option value="${c}">${c}</option>`).join("")}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Quantity</label>
            <input id="ab-qty" type="number" step="any" placeholder="e.g. 0.00814" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Price Paid (USD)</label>
            <input id="ab-price" type="number" step="any" placeholder="e.g. 61382.62" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Date</label>
            <input id="ab-date" type="date" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          <div id="ab-status" style="font-size:13px;min-height:20px;text-align:center;"></div>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <button onclick="hideAddBuyModal()" style="flex:1;padding:12px;border-radius:8px;border:1px solid #ddd;background:#f8f8f8;font-size:14px;cursor:pointer;">Cancel</button>
            <button onclick="saveNewBuy()" style="flex:2;padding:12px;border-radius:8px;border:none;background:#27ae60;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Save Buy Order</button>
          </div>
        </div>
      </div>
    </div>

    <!-- GitHub Token Modal -->
    <div id="token-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:24px;width:90%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <h3 style="margin:0 0 8px;font-size:16px;font-weight:700;">⚙️ GitHub Token</h3>
        <p style="font-size:12px;color:#999;margin:0 0 16px;">Used to save buy orders directly to GitHub so they persist across devices and workflow runs.</p>
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
  document.getElementById("crypto-content").innerHTML = `
    <div style="padding:60px;text-align:center;color:#999;font-size:13px;">Loading crypto lots…</div>`;

  try {
    // Load main portfolio data
    const resp = await fetch(CRYPTO_JSON_URL + "?t=" + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    let lots = data.lots || [];

    // Load manual lots from localStorage
    try {
      const stored = localStorage.getItem("crypto_manual_lots");
      if (stored) {
        cryptoManualLots = JSON.parse(stored);
      }
    } catch(e) {}

    // Also try to load manual lots from GitHub (latest saved version)
    try {
      const mResp = await fetch(MANUAL_LOTS_URL + "?t=" + Date.now());
      if (mResp.ok) {
        const ghLots = await mResp.json();
        // Merge: GitHub lots take precedence, then localStorage extras
        const ghKeys = new Set(ghLots.map(l=>`${l.coin}_${l.date}_${l.qty}`));
        const localExtras = cryptoManualLots.filter(l => !ghKeys.has(`${l.coin}_${l.date}_${l.qty}`));
        cryptoManualLots = [...ghLots, ...localExtras];
        localStorage.setItem("crypto_manual_lots", JSON.stringify(cryptoManualLots));
      }
    } catch(e) {}

    // Merge manual lots into dashboard lots (add gain/loss using current prices)
    const prices = data.prices || {};
    const existingKeys = new Set(lots.map(l=>`${l.coin}_${l.date}_${Math.round(l.qty*1e6)}`));

    for (const ml of cryptoManualLots) {
      const key = `${ml.coin}_${ml.date}_${Math.round(ml.qty*1e6)}`;
      if (existingKeys.has(key)) continue; // already in pipeline output
      const price    = prices[ml.coin] || 0;
      const gain_pct = ml.cost_usd > 0 && price > 0 ? ((price - ml.cost_usd) / ml.cost_usd * 100) : 0;

      // Get lowest cost for this coin (for buy signal)
      const coinLots   = lots.filter(l => l.coin === ml.coin);
      const lowestCost = coinLots.length > 0
        ? Math.min(...coinLots.map(l=>l.cost_usd).filter(c=>c>0))
        : ml.cost_usd;
      const buyThresh  = lowestCost * 0.95;

      let signal = "HOLD";
      if (gain_pct >= 10)      signal = "SELL";
      else if (gain_pct >= 7)  signal = "NEAR_SELL";
      else if (price > 0 && price <= buyThresh) signal = "BUY";

      lots.push({
        coin:          ml.coin,
        qty:           ml.qty,
        cost_usd:      ml.cost_usd,
        date:          ml.date,
        source:        "manual",
        current_price: price,
        gain_pct:      Math.round(gain_pct * 100) / 100,
        signal,
        market_value:  price > 0 ? Math.round(price * ml.qty * 100) / 100 : 0,
      });
    }

    if (lots.length === 0) {
      document.getElementById("crypto-content").innerHTML = `
        <div style="padding:60px;text-align:center;color:#999;">No open lots found.</div>`;
      return;
    }

    cryptoAllLots = lots;

    document.getElementById("crypto-content").innerHTML = `
      ${renderModals()}
      <style>
        .cr-card{flex:1;min-width:130px;background:#f8f9fa;border-radius:8px;padding:14px 16px;}
        .cr-label{font-size:12px;color:#999;margin-bottom:4px;}
        .cr-value{font-size:22px;font-weight:600;color:#222;}
        .cr-sub{font-size:12px;color:#aaa;margin-top:2px;}
      </style>
      <div id="crypto-summary">${renderSummaryCards(cryptoAllLots, data.updated_uae)}</div>
      <div id="crypto-filter-bar">${renderFilterBar()}</div>
      <div id="crypto-table-area"></div>`;

    renderCryptoTable();

  } catch(err) {
    document.getElementById("crypto-content").innerHTML = `
      <div style="padding:40px;text-align:center;color:#e74c3c;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-weight:600;">Failed to load crypto data</div>
        <div style="font-size:13px;color:#999;margin-top:8px;">${err.message}</div>
      </div>`;
  }
}

window.loadCryptoTab   = loadCryptoTab;
window.setCryptoFilter = setCryptoFilter;
window.showAddBuyModal = showAddBuyModal;
window.hideAddBuyModal = hideAddBuyModal;
window.saveNewBuy      = saveNewBuy;
window.showTokenModal  = showTokenModal;
window.hideTokenModal  = hideTokenModal;
window.saveToken       = saveToken;
