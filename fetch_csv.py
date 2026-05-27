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
OUTPUT_PATH   = "data/portfolio.csv"

REDIRECT_URI  = "http://localhost"
SCOPE         = "Mail.Read offline_access"
TOKEN_URL     = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"

# ── Step 1: Get fresh access token using refresh token ───────────────────────
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
    data = r.json()
    print("✓ Access token obtained")
    return data["access_token"]

# ── Step 2: Find latest IBKR email with CSV attachment ───────────────────────
def find_latest_email(token):
    since = (datetime.utcnow() - timedelta(days=3)).strftime("%Y-%m-%dT00:00:00Z")
    url = (
        "https://graph.microsoft.com/v1.0/me/messages"
        f"?$filter=from/emailAddress/address eq '{SENDER}'"
        f" and receivedDateTime ge {since}"
        f" and hasAttachments eq true"
        f"&$orderby=receivedDateTime desc"
        f"&$top=1"
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
    msg = msgs[0]
    print(f"✓ Found email: '{msg['subject']}' received {msg['receivedDateTime']}")
    return msg["id"]

# ── Step 3: Find CSV attachment (name may vary) ───────────────────────────────
def get_csv_attachment(token, message_id):
    url = f"https://graph.microsoft.com/v1.0/me/messages/{message_id}/attachments"
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(url, headers=headers)
    if r.status_code != 200:
        print(f"Attachment error: {r.status_code} {r.text}")
        r.raise_for_status()
    attachments = r.json().get("value", [])

    csv_attachment = None
    for att in attachments:
        name = att.get("name", "").lower()
        if name.endswith(".csv"):
            csv_attachment = att
            print(f"✓ Found CSV attachment: {att['name']}")
            break

    if not csv_attachment:
        names = [a.get("name") for a in attachments]
        raise Exception(f"No CSV attachment found. Files in email: {names}")

    content = base64.b64decode(csv_attachment["contentBytes"]).decode("utf-8")
    return content

# ── Step 4: Save CSV ──────────────────────────────────────────────────────────
def save_csv(content):
    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"✓ Saved to {OUTPUT_PATH} ({len(content)} bytes)")

# ── Step 5: Save metadata ─────────────────────────────────────────────────────
def save_metadata():
    meta = {"last_updated": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")}
    os.makedirs("data", exist_ok=True)
    with open("data/meta.json", "w") as f:
        json.dump(meta, f)
    print(f"✓ Metadata saved: {meta}")

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== Portfolio CSV Fetcher ===")
    print(f"Looking for emails from: {SENDER}")

    token       = get_access_token()
    message_id  = find_latest_email(token)
    csv_content = get_csv_attachment(token, message_id)
    save_csv(csv_content)
    save_metadata()

    print("=== Done ✓ ===")
