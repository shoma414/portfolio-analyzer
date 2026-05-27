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

# ── Step 5: Fetch prices using yfinance ──────────────────────────────────────
def fetch_yfinance_data(symbols, fields=('regularMarketPrice',)):
    import yfinance as yf
    result = {}
    need_52w = 'fiftyTwoWeekLow' in fields

    # For price only: use fast batch download (much faster)
    # For 52W data: use individual ticker.info (only way to get 52W reliably)
    if not need_52w:
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
    else:
        # Need 52W data — use ticker.info for each symbol
        for sym in symbols:
            try:
                t = yf.Ticker(sym)
                info = t.info
                price = float(info.get('regularMarketPrice') or info.get('currentPrice') or 0)
                low52 = float(info.get('fiftyTwoWeekLow') or 0)
                high52= float(info.get('fiftyTwoWeekHigh') or 0)
                if price > 0 and low52 > 0:
                    result[sym] = {
                        'price': round(price, 4),
                        'low52': round(low52, 4),
                        'high52': round(high52, 4)
                    }
                    print(f"  {sym}: ${price:.2f} (52W low: ${low52:.2f})")
                elif price > 0:
                    result[sym] = {'price': round(price,4), 'low52': 0, 'high52': 0}
                    print(f"  {sym}: ${price:.2f} (no 52W data)")
            except Exception as e:
                print(f"  {sym}: skip ({e})")
    return result

# ── Step 6: Save all files ────────────────────────────────────────────────────
def save_files(csv_content, portfolio_data, watchlist_data):
    os.makedirs("data", exist_ok=True)
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    # CSV
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

    # Meta
    with open("data/meta.json", "w") as f:
        json.dump({"last_updated": now_str}, f)

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== Portfolio Fetcher ===")

    # Email
    token       = get_access_token()
    message_id  = find_latest_email(token)
    csv_content = get_csv_attachment(token, message_id)
    port_syms   = extract_symbols(csv_content)

    # Prices
    print("\n-- Portfolio prices --")
    portfolio_data = fetch_yfinance_data(port_syms, fields=('regularMarketPrice',))

    print("\n-- Watchlist prices + 52W data --")
    watchlist_data = fetch_yfinance_data(WATCHLIST, fields=('regularMarketPrice','fiftyTwoWeekLow'))

    save_files(csv_content, portfolio_data, watchlist_data)
    print("\n=== Done ✓ ===")
