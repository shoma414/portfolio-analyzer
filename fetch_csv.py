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

REDIRECT_URI  = "http://localhost"
SCOPE         = "Mail.Read offline_access"
TOKEN_URL     = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"

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
        f"&$top=10"
        f"&$select=id,subject,receivedDateTime"
    )
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(url, headers=headers)
    if r.status_code != 200:
        print(f"Email search error: {r.status_code} {r.text}")
        r.raise_for_status()
    msgs = r.json().get("value", [])
    if not msgs:
        raise Exception(f"No IBKR email found in the last 3 days from {SENDER}")
    msgs.sort(key=lambda m: m["receivedDateTime"], reverse=True)
    msg = msgs[0]
    print(f"✓ Found email: '{msg['subject']}' received {msg['receivedDateTime']}")
    return msg["id"]

# ── Step 3: Get CSV attachment ────────────────────────────────────────────────
def get_csv_attachment(token, message_id):
    url = f"https://graph.microsoft.com/v1.0/me/messages/{message_id}/attachments"
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(url, headers=headers)
    if r.status_code != 200:
        print(f"Attachment error: {r.status_code} {r.text}")
        r.raise_for_status()
    attachments = r.json().get("value", [])
    for att in attachments:
        if att.get("name", "").lower().endswith(".csv"):
            print(f"✓ Found CSV: {att['name']}")
            return base64.b64decode(att["contentBytes"]).decode("utf-8")
    names = [a.get("name") for a in attachments]
    raise Exception(f"No CSV attachment found. Files: {names}")

# ── Step 4: Extract symbols from CSV ─────────────────────────────────────────
def extract_symbols(csv_content):
    symbols = set()
    excluded = {"UAVS", "IDEXQ", "AXLA", "APTX"}
    for line in csv_content.split('\n'):
        t = line.strip()
        if not t or t.startswith('"Symbol"') or t.startswith('Symbol'): continue
        sym = t.split(',')[0].strip().strip('"')
        if sym and sym not in excluded:
            symbols.add(sym)
    print(f"✓ Found {len(symbols)} symbols: {sorted(symbols)}")
    return sorted(symbols)

# ── Step 5: Fetch live prices via yfinance ────────────────────────────────────
def fetch_prices(symbols):
    try:
        import yfinance as yf
        prices = {}
        # Batch fetch all symbols at once
        tickers = yf.Tickers(' '.join(symbols))
        for sym in symbols:
            try:
                price = tickers.tickers[sym].fast_info.get('lastPrice') or \
                        tickers.tickers[sym].fast_info.get('regularMarketPrice')
                if price:
                    prices[sym] = round(float(price), 4)
                    print(f"  {sym}: ${price:.2f}")
            except Exception as e:
                print(f"  {sym}: failed ({e})")
        print(f"✓ Fetched {len(prices)}/{len(symbols)} prices")
        return prices
    except Exception as e:
        print(f"⚠ yfinance error: {e}")
        return {}

# ── Step 6: Save files ────────────────────────────────────────────────────────
def save_files(csv_content, prices):
    os.makedirs("data", exist_ok=True)

    with open(CSV_PATH, "w", encoding="utf-8") as f:
        f.write(csv_content)
    print(f"✓ CSV saved ({len(csv_content)} bytes)")

    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    payload = {
        "prices": prices,
        "last_updated": now_str,
        "count": len(prices)
    }
    with open(PRICES_PATH, "w") as f:
        json.dump(payload, f)
    print(f"✓ Prices saved: {now_str}")

    meta = {"last_updated": now_str}
    with open("data/meta.json", "w") as f:
        json.dump(meta, f)

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== Portfolio Fetcher ===")
    token       = get_access_token()
    message_id  = find_latest_email(token)
    csv_content = get_csv_attachment(token, message_id)
    symbols     = extract_symbols(csv_content)
    prices      = fetch_prices(symbols)
    save_files(csv_content, prices)
    print("=== Done ✓ ===")
