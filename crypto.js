// crypto.js — Crypto Lots tab (5th tab)

const CRYPTO_JSON_URL = `https://raw.githubusercontent.com/shoma414/portfolio-analyzer/main/data/crypto_portfolio.json`;

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
    display:inline-flex;align-items:center;justify-content:center;
    width:32px;height:32px;border-radius:50%;
    background:${color};color:#fff;
    font-size:10px;font-weight:700;flex-shrink:0;
  ">${coin.slice(0,4)}</span>`;
}

function fmt(n, d=2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d, maximumFractionDigits: d
  });
}

function fmtPrice(p) {
  if (p >= 1000) return "$" + fmt(p, 2);
  if (p >= 1)    return "$" + fmt(p, 4);
  return "$" + fmt(p, 6);
}

function renderSummaryCards(lots, updatedUAE) {
  const totalValue   = lots.reduce((s,l) => s + (l.market_value||0), 0);
  const totalCost    = lots.reduce((s,l) => s + (l.cost_usd * l.qty), 0);
  const totalGainPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost * 100) : 0;
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
    <div style="font-size:12px;color:#999;margin-bottom:16px;">Last updated: ${updatedUAE} UAE</div>
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
  const sortedCoins = Object.keys(grouped).sort((a,b) => {
    const va = grouped[a].reduce((s,l)=>s+l.market_value,0);
    const vb = grouped[b].reduce((s,l)=>s+l.market_value,0);
    return vb - va;
  });

  for (const coin of sortedCoins) {
    grouped[coin].sort((a,b) => a.date.localeCompare(b.date));
  }

  let rows = "";
  for (const coin of sortedCoins) {
    const coinLots = grouped[coin];
    coinLots.forEach((lot, i) => {
      const sig       = SIGNAL_CONFIG[lot.signal] || SIGNAL_CONFIG.HOLD;
      const gain      = lot.gain_pct;
      const gainColor = gain >= 0 ? "#27ae60" : "#e74c3c";
      const gainStr   = (gain >= 0 ? "+" : "") + fmt(gain) + "%";
      const coinCell  = i === 0
        ? `<div style="display:flex;align-items:center;gap:8px;">
             ${getCoinIcon(lot.coin)}
             <div>
               <div style="font-weight:600;font-size:14px;">${lot.coin}</div>
               <div style="font-size:11px;color:#999;">${coinLots.length} lot${coinLots.length>1?"s":""}</div>
             </div>
           </div>`
        : `<div style="padding-left:40px;color:#bbb;font-size:12px;">↳</div>`;

      rows += `
        <tr style="border-bottom:1px solid #f0f0f0;">
          <td style="padding:10px 12px;">${coinCell}</td>
          <td style="padding:10px 12px;font-size:13px;color:#555;">${lot.date}</td>
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

    // Coin subtotal
    const totalVal  = coinLots.reduce((s,l)=>s+l.market_value,0);
    const totalCost = coinLots.reduce((s,l)=>s+l.cost_usd*l.qty,0);
    const totalGain = totalCost>0?((totalVal-totalCost)/totalCost*100):0;
    const gc        = totalGain>=0?"#27ae60":"#e74c3c";
    rows += `
      <tr style="background:#fafafa;border-bottom:2px solid #e8e8e8;">
        <td colspan="6" style="padding:6px 12px 6px 52px;font-size:12px;color:#999;">${coin} total</td>
        <td style="padding:6px 12px;text-align:right;font-size:13px;font-weight:600;">$${fmt(totalVal)}</td>
        <td style="padding:6px 12px;text-align:center;font-size:12px;font-weight:600;color:${gc};">${totalGain>=0?"+":""}${fmt(totalGain)}%</td>
      </tr>`;
  }

  return `
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

async function loadCryptoTab() {
  document.getElementById("crypto-content").innerHTML = `
    <div style="padding:60px;text-align:center;color:#999;font-size:13px;">Loading crypto lots…</div>`;
  try {
    const resp = await fetch(CRYPTO_JSON_URL + "?t=" + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const lots = data.lots || [];

    if (lots.length === 0) {
      document.getElementById("crypto-content").innerHTML = `
        <div style="padding:60px;text-align:center;color:#999;">
          No open lots found.
        </div>`;
      return;
    }

    document.getElementById("crypto-content").innerHTML = `
      <style>
        .cr-card{flex:1;min-width:130px;background:#f8f9fa;border-radius:8px;padding:14px 16px;}
        .cr-label{font-size:12px;color:#999;margin-bottom:4px;}
        .cr-value{font-size:22px;font-weight:600;color:#222;}
        .cr-sub{font-size:12px;color:#aaa;margin-top:2px;}
      </style>
      ${renderSummaryCards(lots, data.updated_uae)}
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <div style="font-size:13px;font-weight:600;color:#333;">
          ${lots.length} open lots · ${[...new Set(lots.map(l=>l.coin))].length} coins
        </div>
        <div style="margin-left:auto;display:flex;gap:6px;font-size:11px;">
          ${Object.entries(SIGNAL_CONFIG).map(([k,v])=>
            `<span style="padding:3px 8px;border-radius:10px;background:${v.bg};color:${v.color};border:1px solid ${v.color}33;font-weight:600;">${v.label}</span>`
          ).join("")}
        </div>
      </div>
      ${renderLotsTable(lots)}`;
  } catch(err) {
    document.getElementById("crypto-content").innerHTML = `
      <div style="padding:40px;text-align:center;color:#e74c3c;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-weight:600;">Failed to load crypto data</div>
        <div style="font-size:13px;color:#999;margin-top:8px;">${err.message}</div>
      </div>`;
  }
}

window.loadCryptoTab = loadCryptoTab;
