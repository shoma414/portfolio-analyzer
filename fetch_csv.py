import os
import json
import base64
import requests
from datetime import datetime, timedelta

# ── Config from GitHub Secrets ──────────────────────────────────────────────
CLIENT_ID     = os.environ["OUTLOOK_CLIENT_ID"]
CLIENT_SECRET = os.environ["OUTLOOK_CLIENT_SECRET"]
REFRESH_TOKEN = os.environ["OUTLOOK_REFRESH_TOKEN"]
EMAIL         = os.environ["OUTLOOK_EMAIL"]
SENDER        = "donotreply@interactivebrokers.com"
CSV_PATH      = "data/portfolio.csv"
PRICES_PATH   = "data/prices.json"
WATCHLIST_PATH= "data/watchlist.json"

REDIRECT_URI  = "http://localhost"
SCOPE         = "Mail.Read offline_access"
TOKEN_URL     = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"

WATCHLIST = [
  "NEM","WDC","STX","NXPI","SLV","AMKR","RL","PEP","ENFR","ACN","ODFL","CHRW",
  "BIRK","SAP","SEZL","EFX","PANW","ADI","B","HIMS","SNY","BMNR","YOU","ISRG",
  "VRSN","SMGB","JKHY","GEV","ECL","SYK","FICO","DKS","GRMN","LLY","SPGI","FTNT",
  "DECK","PODD","WSM","PH","PAYX","ROK","CROX","GILD","TMO","ZTS","AOS","LTRX",
  "NIO","CPRT","APP","DHI","WST","CL","NUTX","LIN","NOW","NVO","CELH","CLX","KVUE",
  "ABBV","ADM","SHOP","TTD","GSK","SWKS","LOW","ABT","FIX","VLO","ANET","ON","CNQ",
  "UNP","ONON","CTRE","POOL","WULF","DVN","FAST","UBER","APD","KMB","MSCI","CUBE",
  "MAA","ADP","EOG","WM","CMI","KO","RIO","SMCI","IBM","WSO","KLAC","AMAT","GOOGL",
  "ADSK","CRM","PG","ELF","QCOM","CAT","MRK","LULU","AVGO","MDLZ","ULTA","ASML",
  "LRCX","V","CVX","COP","MA","GPC","HSY","ORCL","MSTR","MDT","LEN","TXN","TSLA",
  "AAPL","NVDA","XOM","ARM","ADBE","AMD","SBUX","META","PATH","SLB","BTC-USD","HD",
  "NKE","TSM","CRWD","MMM","AEO","MU","JNJ","UPS","ATKR","MSFT","CSCO"
]

# ── Step 1: Get access token ─────────────────────────────────────────────────
def get_access_token():
    r = requests.post(TOKEN_URL, data={
        "grant_type":    "refresh_token",
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": REFRESH_TOKEN,
        "scope":         SCOPE,
        "redirect_uri":  REDIRECT_URI,
    })
    if r.status_code != 200:
        print(f"Token error: {r.status_code} {r.text}")
        r.raise_for_status()
    print("✓ Access token obtained")
    return r.json()["access_token"]

# ── Step 2: Find latest IBKR email ───────────────────────────────────────────
def find_latest_email(token):
    since = (datetime.utcnow() - timedelta(days=3)).strftime("%Y-%m-%dT00:00:00Z")
    url = (
        "https://graph.microsoft.com/v1.0/me/messages"
        f"?$filter=from/emailAddress/address eq '{SENDER}'"
        f" and receivedDateTime ge {since}"
        f" and hasAttachments eq true"
        f"&$top=10&$select=id,subject,receivedDateTime"
    )
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(url, headers=headers)
    r.raise_for_status()
    msgs = r.json().get("value", [])
    if not msgs:
        raise Exception(f"No IBKR email found in the last 3 days")
    msgs.sort(key=lambda m: m["receivedDateTime"], reverse=True)
    msg = msgs[0]
    print(f"✓ Found email: '{msg['subject']}'")
    return msg["id"]

# ── Step 3: Get CSV attachment ────────────────────────────────────────────────
def get_csv_attachment(token, message_id):
    url = f"https://graph.microsoft.com/v1.0/me/messages/{message_id}/attachments"
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(url, headers=headers)
    r.raise_for_status()
    for att in r.json().get("value", []):
        if att.get("name", "").lower().endswith(".csv"):
            print(f"✓ Found CSV: {att['name']}")
            return base64.b64decode(att["contentBytes"]).decode("utf-8")
    raise Exception("No CSV attachment found")

# ── Step 4: Extract symbols from CSV ─────────────────────────────────────────
def extract_symbols(csv_content):
    excluded = {"UAVS", "IDEXQ.OLD", "AXLA", "APTX.OLD"}
    symbols = set()
    for line in csv_content.split('\n'):
        t = line.strip()
        if not t or 'Symbol' in t: continue
        sym = t.split(',')[0].strip().strip('"')
        if sym and sym not in excluded:
            symbols.add(sym)
    print(f"✓ Portfolio symbols: {len(symbols)}")
    return sorted(symbols)

# ── Step 5: Fetch prices + technical indicators using yfinance ───────────────
def calculate_rsi(closes, period=14):
    """Calculate RSI from a list of closing prices."""
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    gains  = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period-1) + gains[i]) / period
        avg_loss = (avg_loss * (period-1) + losses[i]) / period
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)

def fetch_portfolio_prices(symbols):
    """Fast price fetch for portfolio symbols."""
    import yfinance as yf
    result = {}
    batch_size = 50
    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i+batch_size]
        try:
            tickers = yf.Tickers(' '.join(batch))
            for sym in batch:
                try:
                    info = tickers.tickers[sym].fast_info
                    price = float(info.last_price or 0)
                    if price > 0:
                        result[sym] = {'price': round(price, 4)}
                        print(f"  {sym}: ${price:.2f}")
                except Exception as e:
                    print(f"  {sym}: skip ({e})")
        except Exception as e:
            print(f"Batch error: {e}")
    return result

# Sector average EV/EBITDA benchmarks for scoring
SECTOR_EV_EBITDA = {
    'Technology': 22, 'Information Technology': 22,
    'Healthcare': 16, 'Health Care': 16,
    'Consumer Discretionary': 14, 'Consumer Staples': 14,
    'Financials': 12, 'Financial Services': 12,
    'Energy': 8, 'Materials': 10,
    'Industrials': 13, 'Utilities': 11,
    'Real Estate': 18, 'Communication Services': 15,
    'default': 14
}

def fetch_watchlist_data(symbols):
    """Fetch full data including 52W, technicals, and fundamentals for watchlist."""
    import yfinance as yf
    result = {}
    for sym in symbols:
        try:
            t = yf.Ticker(sym)
            info = t.info
            price  = float(info.get('regularMarketPrice') or info.get('currentPrice') or 0)
            low52  = float(info.get('fiftyTwoWeekLow') or 0)
            high52 = float(info.get('fiftyTwoWeekHigh') or 0)
            name   = info.get('shortName') or info.get('longName') or sym
            sector = info.get('sector') or 'default'

            if price <= 0:
                print(f"  {sym}: no price")
                continue

            # ── Fundamentals ──────────────────────────────────────────────
            market_cap    = float(info.get('marketCap') or 0)
            total_debt    = float(info.get('totalDebt') or 0)
            total_cash    = float(info.get('totalCash') or 0)
            ebitda        = float(info.get('ebitda') or 0)
            free_cashflow = float(info.get('freeCashflow') or 0)
            revenue_growth= float(info.get('revenueGrowth') or 0) * 100  # as %
            earnings_growth=float(info.get('earningsGrowth') or info.get('earningsQuarterlyGrowth') or 0) * 100
            roe           = float(info.get('returnOnEquity') or 0) * 100  # as %
            forward_pe    = float(info.get('forwardPE') or 0)
            trailing_pe   = float(info.get('trailingPE') or 0)
            ev_ebitda     = float(info.get('enterpriseToEbitda') or 0)
            div_yield     = float(info.get('dividendYield') or 0) * 100  # as %
            payout_ratio  = float(info.get('payoutRatio') or 0) * 100   # as %
            shares_out    = float(info.get('sharesOutstanding') or 0)
            float_shares  = float(info.get('floatShares') or 0)
            debt_to_equity= float(info.get('debtToEquity') or 0)

            # Net Debt / EBITDA
            net_debt = total_debt - total_cash
            net_debt_ebitda = round(net_debt / ebitda, 2) if ebitda > 0 else None

            # FCF Yield = FCF / Market Cap
            fcf_yield = round((free_cashflow / market_cap) * 100, 2) if market_cap > 0 else None

            # Sector EV/EBITDA average
            sector_ev_ebitda = SECTOR_EV_EBITDA.get(sector, SECTOR_EV_EBITDA['default'])

            # Halal quick check
            total_assets = float(info.get('totalAssets') or 0)
            debt_to_assets = round((total_debt / total_assets) * 100, 2) if total_assets > 0 else None
            interest_expense = abs(float(info.get('interestExpense') or 0))
            total_revenue = float(info.get('totalRevenue') or 0)
            interest_pct = round((interest_expense / total_revenue) * 100, 2) if total_revenue > 0 else None

            entry = {
                'price':          round(price, 4),
                'low52':          round(low52, 4),
                'high52':         round(high52, 4),
                'name':           name,
                'sector':         sector,
                # Business Quality
                'revenueGrowth':  round(revenue_growth, 2),
                'epsGrowth':      round(earnings_growth, 2),
                'roe':            round(roe, 2),
                'netDebtEbitda':  net_debt_ebitda,
                # Valuation
                'forwardPE':      round(forward_pe, 2) if forward_pe else None,
                'trailingPE':     round(trailing_pe, 2) if trailing_pe else None,
                'fcfYield':       fcf_yield,
                'evEbitda':       round(ev_ebitda, 2) if ev_ebitda else None,
                'sectorEvEbitda': sector_ev_ebitda,
                # Shareholder Return
                'divYield':       round(div_yield, 2),
                'payoutRatio':    round(payout_ratio, 2),
                # Halal
                'debtToAssets':   debt_to_assets,
                'interestPct':    interest_pct,
            }

            # ── Technical indicators ──────────────────────────────────────
            try:
                hist = t.history(period='1y')
                if len(hist) >= 20:
                    closes = hist['Close'].tolist()
                    ma50  = round(sum(closes[-50:])  / min(50,  len(closes)), 4) if len(closes) >= 50  else None
                    ma200 = round(sum(closes[-200:]) / min(200, len(closes)), 4) if len(closes) >= 100 else None
                    ma20  = round(sum(closes[-20:])  / 20, 4)
                    rsi   = calculate_rsi(closes[-30:], period=14)

                    if len(closes) >= 20:
                        recent   = closes[-20:]
                        mean     = sum(recent) / 20
                        std      = (sum((x-mean)**2 for x in recent) / 20) ** 0.5
                        bb_upper = round(mean + 2*std, 4)
                        bb_lower = round(mean - 2*std, 4)
                        bb_mid   = round(mean, 4)
                    else:
                        bb_upper = bb_lower = bb_mid = None

                    cross = None
                    if ma50 and ma200:
                        if ma50 > ma200:
                            if len(closes) >= 220:
                                old_ma50  = sum(closes[-70:-20]) / 50
                                old_ma200 = sum(closes[-220:-20]) / 200
                                cross = 'golden' if old_ma50 <= old_ma200 else 'above'
                            else:
                                cross = 'above'
                        else:
                            cross = 'below'

                    entry.update({
                        'ma20': ma20, 'ma50': ma50, 'ma200': ma200,
                        'rsi': rsi, 'bbUpper': bb_upper,
                        'bbLower': bb_lower, 'bbMid': bb_mid, 'maCross': cross,
                    })
            except Exception as e:
                print(f"  {sym}: technical calc failed ({e})")

            result[sym] = entry
            print(f"  {sym}: ${price:.2f} ROE:{roe:.0f}% FCFy:{fcf_yield}% RSI:{entry.get('rsi','?')}")

        except Exception as e:
            print(f"  {sym}: skip ({e})")
    return result

def fetch_yfinance_data(symbols, fields=('regularMarketPrice',)):
    """Backwards-compatible wrapper."""
    if 'fiftyTwoWeekLow' in fields:
        return fetch_watchlist_data(symbols)
    else:
        return fetch_portfolio_prices(symbols)

# ── Step 6: Save all files ────────────────────────────────────────────────────
def save_files(csv_content, portfolio_data, watchlist_data):
    os.makedirs("data", exist_ok=True)
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    fetch_email = os.environ.get("FETCH_EMAIL", "true").lower() == "true"

    # CSV — only update timestamp if email was fetched
    if csv_content and fetch_email:
        with open(CSV_PATH, "w", encoding="utf-8") as f:
            f.write(csv_content)
        print(f"✓ CSV saved")

    # Portfolio prices (price only)
    with open(PRICES_PATH, "w") as f:
        json.dump({"prices": {s: d['price'] for s,d in portfolio_data.items()}, "last_updated": now_str}, f)
    print(f"✓ prices.json saved ({len(portfolio_data)} symbols)")

    # Watchlist (price + 52W low/high)
    with open(WATCHLIST_PATH, "w") as f:
        json.dump({"data": watchlist_data, "last_updated": now_str}, f)
    print(f"✓ watchlist.json saved ({len(watchlist_data)} symbols)")

    # Meta — separate CSV and price timestamps
    meta = {"prices_updated": now_str}
    # Preserve existing csv_updated if this is price-only run
    if fetch_email:
        meta["csv_updated"] = now_str
    else:
        try:
            with open("data/meta.json", "r") as f:
                existing = json.load(f)
                meta["csv_updated"] = existing.get("csv_updated", now_str)
        except:
            meta["csv_updated"] = now_str
    meta["last_updated"] = now_str  # keep for backwards compat
    with open("data/meta.json", "w") as f:
        json.dump(meta, f)

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== Portfolio Fetcher ===")
    fetch_email = os.environ.get("FETCH_EMAIL", "true").lower() == "true"

    if fetch_email:
        print("Mode: Full update (email + prices)")
        token       = get_access_token()
        message_id  = find_latest_email(token)
        csv_content = get_csv_attachment(token, message_id)
        port_syms   = extract_symbols(csv_content)
    else:
        print("Mode: Price refresh only (no email fetch)")
        if os.path.exists(CSV_PATH):
            with open(CSV_PATH, 'r', encoding='utf-8') as f:
                csv_content = f.read()
            port_syms = extract_symbols(csv_content)
        else:
            csv_content = None
            port_syms = []

    if port_syms:
        print("\n-- Portfolio prices --")
        portfolio_data = fetch_yfinance_data(port_syms, fields=('regularMarketPrice',))
    else:
        portfolio_data = {}

    print("\n-- Watchlist prices + 52W data --")
    watchlist_data = fetch_yfinance_data(WATCHLIST, fields=('regularMarketPrice','fiftyTwoWeekLow'))

    save_files(csv_content or '', portfolio_data, watchlist_data)
    print("\n=== Done ✓ ===")
