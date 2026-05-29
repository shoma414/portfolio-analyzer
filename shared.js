// ══════════════════════════════════════════════════
// SHARED STATE
// ══════════════════════════════════════════════════
const EXCLUDED_SYMBOLS = ["UAVS", "IDEXQ.OLD", "AXLA", "APTX.OLD"];
const GITHUB_USER = "shoma414";
const GITHUB_REPO = "portfolio-analyzer";
const CSV_URL    = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/data/portfolio.csv`;
const META_URL   = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/data/meta.json`;
const PRICES_URL    = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/data/prices.json`;
const WATCHLIST_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/data/watchlist.json`;
const PRICE_REFRESH_MS = 10 * 60 * 1000;

// ── UAE time helper ─────────────────────────────────────────────────────────
function toUAETime(utcStr) {
  // Accepts "2026-05-27 23:04 UTC" or ISO string
  try {
    const clean = utcStr.replace(' UTC', '').replace(' ', 'T') + (utcStr.includes('T') ? '' : ':00Z');
    const d = new Date(clean.endsWith('Z') ? clean : clean + 'Z');
    return d.toLocaleString('en-GB', {
      timeZone: 'Asia/Dubai',
      day:   '2-digit', month: 'short', year: 'numeric',
      hour:  '2-digit', minute: '2-digit', hour12: true
    }) + ' UAE';
  } catch(e) { return utcStr; }
}

function nowUAE() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit', minute: '2-digit', hour12: true
  }) + ' UAE';
}

let allRows = [], processedData = { lots: [], buyGroups: [] };
let livePrices = {};
let priceTimer = null;
let currentTab = 'lots';
let zoneFilter = 'all';
let hideOwned = false;
let currentStrategy = '52w';

function setStrategy(s) {
  currentStrategy = s;
  document.getElementById('strat52w').className      = 'strategy-btn' + (s==='52w'      ? ' active' : '');
  document.getElementById('stratCombined').className = 'strategy-btn' + (s==='combined' ? ' active' : '');
  renderWatchlist();
}

// ── Combined Score Calculator ─────────────────────────────────────────────────
function calcCombinedScore(d, buyZonePct, watchZonePct) {
  if (!d || d.loading || d.error || !d.price) return null;
  let score = 0;
  const signals = [];

  // Signal 1: 52W Low proximity (30% weight)
  if (d.low52 > 0) {
    const aboveLow = (d.price - d.low52) / d.low52 * 100;
    const buyThreshold   = d.low52 * (buyZonePct/100);
    const watchThreshold = d.low52 * (watchZonePct/100);
    if (d.price <= buyThreshold) {
      score += 30;
      signals.push({ label: '52W Low', note: `${aboveLow.toFixed(1)}% above low`, rating: 'green' });
    } else if (d.price <= watchThreshold) {
      score += 15;
      signals.push({ label: '52W Low', note: `${aboveLow.toFixed(1)}% above low`, rating: 'yellow' });
    } else {
      score += 0;
      signals.push({ label: '52W Low', note: `${aboveLow.toFixed(1)}% above low`, rating: 'red' });
    }
  }

  // Signal 2: RSI (25% weight)
  if (d.rsi !== undefined && d.rsi !== null) {
    if (d.rsi < 30) {
      score += 25;
      signals.push({ label: 'RSI', note: `${d.rsi} — Oversold`, rating: 'green' });
    } else if (d.rsi < 45) {
      score += 12;
      signals.push({ label: 'RSI', note: `${d.rsi} — Approaching oversold`, rating: 'yellow' });
    } else if (d.rsi < 70) {
      score += 5;
      signals.push({ label: 'RSI', note: `${d.rsi} — Neutral`, rating: 'grey' });
    } else {
      score += 0;
      signals.push({ label: 'RSI', note: `${d.rsi} — Overbought`, rating: 'red' });
    }
  }

  // Signal 3: Price vs 200MA (25% weight)
  if (d.ma200) {
    const vsMA200 = (d.price - d.ma200) / d.ma200 * 100;
    if (vsMA200 < -10) {
      score += 25;
      signals.push({ label: 'vs 200MA', note: `${vsMA200.toFixed(1)}% below MA200`, rating: 'green' });
    } else if (vsMA200 < -5) {
      score += 15;
      signals.push({ label: 'vs 200MA', note: `${vsMA200.toFixed(1)}% below MA200`, rating: 'yellow' });
    } else if (vsMA200 < 0) {
      score += 8;
      signals.push({ label: 'vs 200MA', note: `${vsMA200.toFixed(1)}% below MA200`, rating: 'yellow' });
    } else {
      score += 0;
      signals.push({ label: 'vs 200MA', note: `+${vsMA200.toFixed(1)}% above MA200`, rating: 'grey' });
    }
  }

  // Signal 4: MA Cross (20% weight)
  if (d.maCross) {
    if (d.maCross === 'golden') {
      score += 20;
      signals.push({ label: 'MA Cross', note: 'Golden Cross ✨', rating: 'green' });
    } else if (d.maCross === 'above') {
      score += 8;
      signals.push({ label: 'MA Cross', note: '50MA above 200MA', rating: 'yellow' });
    } else {
      score += 0;
      signals.push({ label: 'MA Cross', note: 'Death Cross ⚠️', rating: 'red' });
    }
  }

  // Bollinger Band bonus (no extra weight, enhances RSI signal)
  if (d.bbLower && d.price <= d.bbLower) {
    score = Math.min(100, score + 5);
    signals.push({ label: 'Bollinger', note: 'Below lower band', rating: 'green' });
  }

  const zone = score >= 70 ? 'buy' : score >= 45 ? 'watch' : 'wait';
  return { score: Math.round(score), zone, signals };
}

// Watchlist storage key
const WL_KEY = 'watchlist_symbols';

// Default watchlist
const DEFAULT_WATCHLIST = ["NEM","WDC","STX","NXPI","SLV","AMKR","RL","PEP","ENFR","ACN","ODFL","CHRW","BIRK","SAP","SEZL","EFX","PANW","ADI","B","HIMS","SNY","BMNR","YOU","ISRG","VRSN","SMGB","JKHY","GEV","ECL","SYK","FICO","DKS","GRMN","LLY","SPGI","FTNT","DECK","PODD","WSM","PH","PAYX","ROK","CROX","GILD","TMO","ZTS","AOS","LTRX","NIO","CPRT","APP","DHI","WST","CL","NUTX","LIN","NOW","NVO","CELH","CLX","KVUE","ABBV","ADM","SHOP","TTD","GSK","SWKS","LOW","ABT","FIX","VLO","ANET","ON","CNQ","UNP","ONON","CTRE","POOL","WULF","DVN","FAST","UBER","APD","KMB","MSCI","CUBE","MAA","ADP","EOG","WM","CMI","KO","RIO","SMCI","IBM","WSO","KLAC","AMAT","GOOGL","ADSK","CRM","PG","ELF","QCOM","CAT","MRK","LULU","AVGO","MDLZ","ULTA","ASML","LRCX","V","CVX","COP","MA","GPC","HSY","ORCL","MSTR","MDT","LEN","TXN","TSLA","AAPL","NVDA","XOM","ARM","ADBE","AMD","SBUX","META","PATH","SLB","BTC-USD","HD","NKE","TSM","CRWD","MMM","AEO","MU","JNJ","UPS","ATKR","MSFT","CSCO"];

// Watchlist data: { sym -> {price, low52, high52, loaded} }
let wlData = {};

// ══════════════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════════════
function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tab-lots').style.display      = tab === 'lots'      ? 'block' : 'none';
  document.getElementById('tab-watchlist').style.display = tab === 'watchlist' ? 'block' : 'none';
  document.getElementById('tab-signals').style.display   = tab === 'signals'   ? 'block' : 'none';
  document.querySelectorAll('.tab-btn').forEach((b,i) => {
    b.classList.toggle('active',
      (i===0 && tab==='lots') ||
      (i===1 && tab==='watchlist') ||
      (i===2 && tab==='signals')
    );
  });
  if ((tab === 'watchlist' || tab === 'signals') && Object.keys(wlData).length === 0) refreshWatchlist();
}

// ══════════════════════════════════════════════════