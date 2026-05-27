import os
import json
import base64
import requests
from datetime import datetime, timedelta

# ── Config from GitHub Secrets ──────────────────────────────────────────────
CLIENT_ID     = os.environ["OUTLOOK_CLIENT_ID"]
CLIENT_SECRET = os.environ["OUTLOOK_CLIENT_SECRET"]
EMAIL         = os.environ["OUTLOOK_EMAIL"]
SENDER        = "donotreply@interactivebrokers.com"
OUTPUT_PATH   = "data/portfolio.csv"

# ── Step 1: Get access token ─────────────────────────────────────────────────
def get_token():
    url = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
    data = {
        "grant_type":    "client_credentials",
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope":         "https://graph.microsoft.com/.default",
    }
    r = requests.post(url, data=data)
    r.raise_for_status()
    return r.json()["access_token"]

# ── Step 2: Find latest IBKR email with CSV attachment ───────────────────────
def find_latest_email(token):
    # Search last 2 days to be safe
    since = (datetime.utcnow() - timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")
    url = (
        f"https://graph.microsoft.com/v1.0/users/{EMAIL}/messages"
        f"?$filter=from/emailAddress/address eq '{SENDER}'"
        f" and receivedDateTime ge {since}"
        f" and hasAttachments eq true"
        f"&$orderby=receivedDateTime desc"
        f"&$top=1"
        f"&$select=id,subject,receivedDateTime"
    )
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(url, headers=headers)
    r.raise_for_status()
    msgs = r.json().get("value", [])
    if not msgs:
        raise Exception(f"No IBKR email found in the last 2 days from {SENDER}")
    msg = msgs[0]
    print(f"Found email: '{msg['subject']}' received {msg['receivedDateTime']}")
    return msg["id"]

# ── Step 3: Find CSV attachment (name may vary) ───────────────────────────────
def get_csv_attachment(token, message_id):
    url = f"https://graph.microsoft.com/v1.0/users/{EMAIL}/messages/{message_id}/attachments"
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(url, headers=headers)
    r.raise_for_status()
    attachments = r.json().get("value", [])

    csv_attachment = None
    for att in attachments:
        name = att.get("name", "").lower()
        if name.endswith(".csv"):
            csv_attachment = att
            print(f"Found CSV attachment: {att['name']}")
            break

    if not csv_attachment:
        names = [a.get("name") for a in attachments]
        raise Exception(f"No CSV attachment found. Attachments present: {names}")

    # Decode base64 content
    content = base64.b64decode(csv_attachment["contentBytes"]).decode("utf-8")
    return content

# ── Step 4: Save CSV ──────────────────────────────────────────────────────────
def save_csv(content):
    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Saved to {OUTPUT_PATH} ({len(content)} bytes)")

# ── Step 5: Write metadata (date of last update) ─────────────────────────────
def save_metadata():
    meta = {"last_updated": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")}
    os.makedirs("data", exist_ok=True)
    with open("data/meta.json", "w") as f:
        json.dump(meta, f)
    print(f"Metadata saved: {meta}")

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== Portfolio CSV Fetcher ===")
    print(f"Target email: {EMAIL}")
    print(f"Looking for emails from: {SENDER}")

    token      = get_token()
    message_id = find_latest_email(token)
    csv_content = get_csv_attachment(token, message_id)
    save_csv(csv_content)
    save_metadata()

    print("=== Done ===")
