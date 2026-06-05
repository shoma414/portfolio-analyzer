// crypto.js — Crypto Lots tab (5th tab)
// Reads data/crypto_portfolio.json and renders lot-level buy/sell signals

const PROXY = "https://portfolio-analyzer-api.msrz740.workers.dev";

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

function getCoinIcon(coin) {
  const color = COIN_COLORS[coin] || "#888";
  return `<span style="
    display:inline-flex; align-items:center; justify-content:center;
    width:32px; height:32px; border-radius:50%;
    background:${color}; color:#fff;
    font-size:10px; font-weight:700; flex-shrink:0;
  ">${coin.slice(0,3)}</span>`;
}

function formatNumber(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPrice(price) {
  if (price >= 1000) return "$" + formatNumber(price, 2);
  if (price >= 1)    return "$" + formatNumber(price, 4);
  return "$" + formatNumber(price, 6);
}

function renderSummaryCards(lots, updatedUAE) {
  const totalValue    = lots.reduce((s, l) => s + (l.market_value || 0), 0);
  const totalCost     = lots.reduce((s, l) => s + (l.cost_usd * l.qty), 0);
  const totalGainPct  = totalCost > 0 ? ((totalValue - totalCost) / totalCost * 100) : 0;
  const sellCount     = lots.filter(l => l.signal === "SELL").length;
  const nearSellCount = lots.filter(l => l.signal === "NEAR_SELL").length;
  const buyCount      = lots.filter(l => l.signal === "BUY").length;
  const gainColor     = totalGainPct >= 0 ? "#27ae60" : "#e74c3c";

  return `
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px;">
      <div class="summary-card">
        <div class="summary-label">Portfolio Value</div>
        <div class="summary-value">$${formatNumber(totalValue)}</div>
        <div class="summary-sub" style="color:${gainColor}">
          ${totalGainPct >= 0 ? "+" : ""}${formatNumber(totalGainPct)}% overall
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Open Lots</div>
        <div class="summary-value">${lots.length}</div>
        <div class="summary-sub">${[...new Set(lots.map(l => l.coin))].length} coins</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Sell Signals</div>
        <div class="summary-value" style="color:#e74c3c">${sellCount}</div>
        <div class="summary-sub" style="color:#e67e22">${nearSellCount} near sell</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Buy Signals</div>
        <div class="summary-value" style="color:#27ae60">${buyCount}</div>
        <div class="summary-sub">lots at opportunity</div>
      </div>
    </div>
    <div style="font-size:12px; color:#999; margin-bottom:16px;">
      Last updated: ${updatedUAE} UAE
    </div>
  `;
}

function renderLotRow(lot, isFirst, coinLotCount) {
  const sig    = SIGNAL_CONFIG[lot.signal] || SIGNAL_CONFIG.HOLD;
  const gain   = lot.gain_pct;
  const gainColor = gain >= 0 ? "#27ae60" : "#e74c3c";
  const gainStr   = (gain >= 0 ? "+" : "") + formatNumber(gain) + "%";

  // Show coin icon only on first lot of that coin
  const coinCell = isFirst
    ? `<div style="display:flex; align-items:center; gap:8px;">
         ${getCoinIcon(lot.coin)}
         <div>
           <div style="font-weight:600; font-size:14px;">${lot.coin}</div>
           <div style="font-size:11px; color:#999;">${coinLotCount} lot${coinLotCount > 1 ? "s" : ""}</div>
         </div>
       </div>`
    : `<div style="padding-left:40px; color:#bbb; font-size:12px;">↳ lot</div>`;

  return `
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:10px 12px;">${coinCell}</td>
      <td style="padding:10px 12px; font-size:13px; color:#555;">${lot.date}</td>
      <td style="padding:10px 12px; text-align:right; font-size:13px;">
        ${formatNumber(lot.qty, 6)}
      </td>
      <td style="padding:10px 12px; text-align:right; font-size:13px;">
        ${formatPrice(lot.cost_usd)}
      </td>
      <td style="padding:10px 12px; text-align:right; font-size:13px; font-weight:500;">
        ${formatPrice(lot.current_price)}
      </td>
      <td style="padding:10px 12px; text-align:right; font-size:13px; font-weight:600; color:${gainColor};">
        ${gainStr}
      </td>
      <td style="padding:10px 12px; text-align:right; font-size:13px; color:#555;">
        $${formatNumber(lot.market_value)}
      </td>
      <td style="padding:10px 12px; text-align:center;">
        <span style="
          display:inline-block; padding:3px 10px; border-radius:12px;
          font-size:11px; font-weight:600;
          background:${sig.bg}; color:${sig.color};
          border:1px solid ${sig.color}33;
        ">${sig.label}</span>
      </td>
    </tr>
  `;
}

function renderLotsTable(lots) {
  // Group by coin, sort each group by date asc
  const grouped = {};
  for (const lot of lots) {
    grouped[lot.coin] = grouped[lot.coin] || [];
    grouped[lot.coin].push(lot);
  }

  // Sort coins by total market value desc
  const sortedCoins = Object.keys(grouped).sort((a, b) => {
    const va = grouped[a].reduce((s, l) => s + l.market_value, 0);
    const vb = grouped[b].reduce((s, l) => s + l.market_value, 0);
    return vb - va;
  });

  // Sort lots within each coin by date asc
  for (const coin of sortedCoins) {
    grouped[coin].sort((a, b) => a.date.localeCompare(b.date));
  }

  let rows = "";
  for (const coin of sortedCoins) {
    const coinLots = grouped[coin];
    coinLots.forEach((lot, i) => {
      rows += renderLotRow(lot, i === 0, coinLots.length);
    });
    // Coin subtotal row
    const totalVal  = coinLots.reduce((s, l) => s + l.market_value, 0);
    const totalCost = coinLots.reduce((s, l) => s + l.cost_usd * l.qty, 0);
    const totalGain = totalCost > 0 ? ((totalVal - totalCost) / totalCost * 100) : 0;
    const gainColor = totalGain >= 0 ? "#27ae60" : "#e74c3c";
    rows += `
      <tr style="background:#fafafa; border-bottom:2px solid #e8e8e8;">
        <td colspan="6" style="padding:6px 12px; font-size:12px; color:#999; padding-left:52px;">
          ${coin} total
        </td>
        <td style="padding:6px 12px; text-align:right; font-size:13px; font-weight:600;">
          $${formatNumber(totalVal)}
        </td>
        <td style="padding:6px 12px; text-align:center; font-size:12px; font-weight:600; color:${gainColor};">
          ${totalGain >= 0 ? "+" : ""}${formatNumber(totalGain)}%
        </td>
      </tr>
    `;
  }

  return `
    <div style="overflow-x:auto; border:1px solid #eee; border-radius:8px;">
      <table style="width:100%; border-collapse:collapse; min-width:700px;">
        <thead>
          <tr style="background:#f8f8f8; border-bottom:2px solid #eee;">
            <th style="padding:10px 12px; text-align:left; font-size:12px; color:#666; font-weight:600;">Coin</th>
            <th style="padding:10px 12px; text-align:left; font-size:12px; color:#666; font-weight:600;">Buy Date</th>
            <th style="padding:10px 12px; text-align:right; font-size:12px; color:#666; font-weight:600;">Quantity</th>
            <th style="padding:10px 12px; text-align:right; font-size:12px; color:#666; font-weight:600;">Cost/Unit</th>
            <th style="padding:10px 12px; text-align:right; font-size:12px; color:#666; font-weight:600;">Current</th>
            <th style="padding:10px 12px; text-align:right; font-size:12px; color:#666; font-weight:600;">Gain/Loss</th>
            <th style="padding:10px 12px; text-align:right; font-size:12px; color:#666; font-weight:600;">Value</th>
            <th style="padding:10px 12px; text-align:center; font-size:12px; color:#666; font-weight:600;">Signal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderError(msg) {
  document.getElementById("crypto-content").innerHTML = `
    <div style="padding:40px; text-align:center; color:#e74c3c;">
      <div style="font-size:32px; margin-bottom:12px;">⚠️</div>
      <div style="font-weight:600;">Failed to load crypto data</div>
      <div style="font-size:13px; color:#999; margin-top:8px;">${msg}</div>
    </div>
  `;
}

function renderLoading() {
  document.getElementById("crypto-content").innerHTML = `
    <div style="padding:60px; text-align:center; color:#999;">
      <div style="font-size:13px;">Loading crypto lots…</div>
    </div>
  `;
}

async function loadCryptoTab() {
  renderLoading();
  try {
    const url  = `${PROXY}?file=data/crypto_portfolio.json&t=${Date.now()}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const lots = data.lots || [];
    if (lots.length === 0) {
      document.getElementById("crypto-content").innerHTML = `
        <div style="padding:60px; text-align:center; color:#999;">
          No open lots found. Check that fetch_crypto.py ran successfully.
        </div>
      `;
      return;
    }

    const html = `
      <style>
        .summary-card {
          flex:1; min-width:140px;
          background:#f8f9fa; border-radius:8px;
          padding:14px 16px;
        }
        .summary-label { font-size:12px; color:#999; margin-bottom:4px; }
        .summary-value { font-size:22px; font-weight:600; color:#222; }
        .summary-sub   { font-size:12px; color:#aaa; margin-top:2px; }
      </style>
      ${renderSummaryCards(lots, data.updated_uae)}
      <div style="margin-bottom:12px; display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
        <div style="font-size:13px; font-weight:600; color:#333;">
          ${lots.length} open lots across ${[...new Set(lots.map(l => l.coin))].length} coins
        </div>
        <div style="margin-left:auto; display:flex; gap:8px; font-size:12px;">
          ${Object.entries(SIGNAL_CONFIG).map(([k, v]) =>
            `<span style="padding:3px 10px; border-radius:10px; background:${v.bg}; color:${v.color}; border:1px solid ${v.color}33; font-weight:600;">${v.label}</span>`
          ).join("")}
        </div>
      </div>
      ${renderLotsTable(lots)}
    `;
    document.getElementById("crypto-content").innerHTML = html;
  } catch (err) {
    renderError(err.message);
  }
}

// Expose for tab switching
window.loadCryptoTab = loadCryptoTab;
