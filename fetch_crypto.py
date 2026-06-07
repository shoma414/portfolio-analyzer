#!/usr/bin/env python3
"""
fetch_crypto.py
- Reads crypto_transactions.xlsx from data/ for lot-level cost basis
- Fetches live balances from Crypto.com Exchange API for reconciliation
- Fetches live prices from Crypto.com Exchange API
- Reconstructs open lots using LIFO, reconciled to actual Exchange balance
- Saves data/crypto_portfolio.json
"""

import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone

import requests

try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

# ── Config ─────────────────────────────────────────────────────────────────────
API_KEY    = os.environ["CDC_API_KEY"]
API_SECRET = os.environ["CDC_API_SECRET"]
BASE_URL   = "https://api.crypto.com/exchange/v1"

TRACKED_COINS = ["BTC", "ETH", "SOL", "XRP", "SUI", "CRO", "HBAR", "ADA", "AVAX"]

# Transaction kinds that represent direct buys (no baskets)
DIRECT_BUY_KINDS = ["viban_purchase"]

# Transaction kinds that represent direct sells
SELL_KINDS = [
    "trading.limit_order.cash_account.sell_commit",
    "crypto_viban_exchange",
]

SELL_PCT      = 10.0
NEAR_SELL_PCT =  7.0
BUY_PCT       =  5.0
UAE_OFFSET    = 4 * 3600

CSV_PATH = "data/crypto_transactions.xlsx"

# ── CDC API signing ─────────────────────────────────────────────────────────────
MAX_LEVEL = 3

def params_to_str(obj, level=0):
    if level >= MAX_LEVEL:
        return str(obj)
    result = ""
    if isinstance(obj, dict):
        for key in sorted(obj.keys()):
            result += key
            val = obj[key]
            if val is None:
                result += "null"
            elif isinstance(val, (list, dict)):
                result += params_to_str(val, level + 1)
            else:
                result += str(val)
    elif isinstance(obj, list):
        for item in obj:
            result += params_to_str(item, level + 1)
    else:
        result += str(obj)
    return result

def sign_request(body: dict) -> dict:
    method    = body["method"]
    req_id    = body["id"]
    nonce     = body["nonce"]
    params    = body.get("params", {})
    param_str = params_to_str(params) if params else ""
    payload   = f"{method}{req_id}{API_KEY}{param_str}{nonce}"
    sig = hmac.new(
        API_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    body["api_key"] = API_KEY
    body["sig"]     = sig
    return body

def private_post(method: str, params: dict = None) -> dict:
    if params is None:
        params = {}
    nonce = int(time.time() * 1000)
    body = sign_request({
        "id":     nonce,
        "method": method,
        "params": params,
        "nonce":  nonce,
    })
    resp = requests.post(
        f"{BASE_URL}/{method}",
        json=body,
        headers={"Content-Type": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"API error {data.get('code')}: {data.get('message')}")
    return data.get("result", {})

# ── Fetch live prices ───────────────────────────────────────────────────────────
def fetch_prices() -> dict:
    prices = {}
    try:
        resp = requests.get(f"{BASE_URL}/public/get-tickers", timeout=15)
        resp.raise_for_status()
        tickers = resp.json().get("result", {}).get("data", [])
        for t in tickers:
            inst = t.get("i", "")
            for coin in TRACKED_COINS:
                if inst == f"{coin}_USDT":
                    last = float(t.get("k", 0) or 0)
                    ask  = float(t.get("a", 0) or 0)
                    bid  = float(t.get("b", 0) or 0)
                    if last > 0:
                        prices[coin] = last
                    elif ask > 0 and bid > 0:
                        prices[coin] = (ask + bid) / 2
    except Exception as e:
        print(f"  Warning fetching prices: {e}")
    return prices

# ── Fetch live Exchange balances ────────────────────────────────────────────────
def fetch_exchange_balances() -> dict:
    """Returns {coin: actual_balance} from Exchange API."""
    balances = {}
    try:
        result = private_post("private/user-balance")
        data   = result.get("data", [])
        for account in data:
            for pos in account.get("position_balances", []):
                coin = pos.get("instrument_name", "")
                qty  = float(pos.get("quantity", 0) or 0)
                if coin in TRACKED_COINS and qty > 0:
                    balances[coin] = qty
    except Exception as e:
        print(f"  Warning fetching balances: {e}")
    return balances

# ── Parse CSV for direct buy lots ──────────────────────────────────────────────
def parse_csv_lots() -> tuple:
    """
    Returns (buy_lots, sell_qty_by_coin) from the transaction CSV.
    buy_lots: list of {coin, qty, cost_usd, date}
    sell_qty_by_coin: {coin: total_sold_qty}
    """
    if not os.path.exists(CSV_PATH):
        print(f"  Warning: {CSV_PATH} not found — no CSV lots loaded")
        return [], {}

    if HAS_PANDAS:
        try:
            df = pd.read_excel(CSV_PATH)
        except Exception as e:
            print(f"  Warning reading CSV: {e}")
            return [], {}
    elif HAS_OPENPYXL:
        try:
            wb = openpyxl.load_workbook(CSV_PATH, read_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
            headers = [str(c) for c in rows[0]]
            import types
            df_data = [dict(zip(headers, row)) for row in rows[1:]]
            # minimal dict-based processing below
            wb.close()
            return _parse_rows_dict(df_data)
        except Exception as e:
            print(f"  Warning reading xlsx with openpyxl: {e}")
            return [], {}
    else:
        print("  Warning: neither pandas nor openpyxl available")
        return [], {}

    buy_lots = []
    sell_qty = {}

    for _, row in df.iterrows():
        kind      = str(row.get("Transaction Kind", "") or "")
        to_curr   = str(row.get("To Currency", "") or "").strip()
        to_amt    = row.get("To Amount", None)
        currency  = str(row.get("Currency", "") or "").strip()
        amount    = row.get("Amount", None)
        native_usd = row.get("Native Amount (in USD)", None)
        ts        = row.get("Timestamp (UTC)", None)

        # ── Direct buys only ──
        if kind in DIRECT_BUY_KINDS:
            # viban_purchase: To Currency = coin received, To Amount = qty, Native Amount = USD cost
            if to_curr in TRACKED_COINS and to_amt and float(to_amt) > 0:
                qty      = float(to_amt)
                cost_usd = abs(float(native_usd)) / qty if native_usd and qty > 0 else 0
                date_str = str(ts)[:10] if ts else "unknown"
                if cost_usd > 0:
                    buy_lots.append({
                        "coin":     to_curr,
                        "qty":      qty,
                        "cost_usd": round(cost_usd, 6),
                        "date":     date_str,
                        "remaining": qty,
                    })

        # ── Direct sells ──
        elif kind in SELL_KINDS:
            if currency in TRACKED_COINS and amount:
                sold = abs(float(amount))
                sell_qty[currency] = sell_qty.get(currency, 0) + sold

    # Sort buy lots oldest first per coin
    buy_lots.sort(key=lambda x: (x["coin"], x["date"]))
    print(f"  Loaded {len(buy_lots)} direct buy lots from CSV")
    print(f"  Sells from CSV: {sell_qty}")
    return buy_lots, sell_qty

def _parse_rows_dict(rows):
    """Fallback parser when pandas not available."""
    buy_lots = []
    sell_qty = {}
    for row in rows:
        kind     = str(row.get("Transaction Kind", "") or "")
        to_curr  = str(row.get("To Currency", "") or "").strip()
        to_amt   = row.get("To Amount")
        currency = str(row.get("Currency", "") or "").strip()
        amount   = row.get("Amount")
        native_usd = row.get("Native Amount (in USD)")
        ts       = row.get("Timestamp (UTC)")

        if kind in DIRECT_BUY_KINDS:
            if to_curr in TRACKED_COINS and to_amt and float(to_amt or 0) > 0:
                qty = float(to_amt)
                cost_usd = abs(float(native_usd)) / qty if native_usd and qty > 0 else 0
                date_str = str(ts)[:10] if ts else "unknown"
                if cost_usd > 0:
                    buy_lots.append({
                        "coin": to_curr, "qty": qty,
                        "cost_usd": round(cost_usd, 6),
                        "date": date_str, "remaining": qty,
                    })
        elif kind in SELL_KINDS:
            if currency in TRACKED_COINS and amount:
                sell_qty[currency] = sell_qty.get(currency, 0) + abs(float(amount))
    buy_lots.sort(key=lambda x: (x["coin"], x["date"]))
    return buy_lots, sell_qty

# ── Reconstruct open lots reconciled to Exchange balance ───────────────────────
def reconstruct_lots(buy_lots: list, sell_qty: dict, exchange_balances: dict) -> list:
    """
    1. Apply CSV sells LOFO (lowest cost first) to reduce lot quantities
    2. Only show coins confirmed on Exchange (uses balance as existence check only)
    """
    # Group by coin
    by_coin = {}
    for lot in buy_lots:
        by_coin.setdefault(lot["coin"], []).append(dict(lot))

    # Apply CSV sells LOFO — cheapest cost lot consumed first
    for coin, sold in sell_qty.items():
        if coin not in by_coin:
            continue
        remaining_sell = sold
        for lot in sorted(by_coin[coin], key=lambda x: x["cost_usd"]):
            if remaining_sell <= 0:
                break
            reduce = min(lot["remaining"], remaining_sell)
            lot["remaining"] -= reduce
            remaining_sell   -= reduce

    open_lots = []
    for coin in TRACKED_COINS:
        lots = by_coin.get(coin, [])

        # Only show coin if it exists on Exchange
        if exchange_balances.get(coin, 0) <= 0:
            continue

        # Use CSV quantities exactly — no scaling
        for lot in lots:
            if lot["remaining"] > 0.000001:
                open_lots.append({
                    "coin":     coin,
                    "qty":      round(lot["remaining"], 8),
                    "cost_usd": round(lot["cost_usd"], 6),
                    "date":     lot["date"],
                })

    return open_lots

# ── Apply signals ──────────────────────────────────────────────────────────────
def apply_signals(lots: list, prices: dict) -> list:
    lowest_cost = {}
    for lot in lots:
        c = lot["coin"]
        if lot["cost_usd"] > 0:
            if c not in lowest_cost or lot["cost_usd"] < lowest_cost[c]:
                lowest_cost[c] = lot["cost_usd"]

    enriched = []
    for lot in lots:
        coin      = lot["coin"]
        price     = prices.get(coin, 0)
        cost      = lot["cost_usd"]
        gain_pct  = ((price - cost) / cost * 100) if cost > 0 and price > 0 else 0
        low_cost  = lowest_cost.get(coin, cost)
        buy_thresh = low_cost * (1 - BUY_PCT / 100) if low_cost > 0 else 0

        if cost <= 0:
            signal = "HOLD"  # unknown cost basis
        elif gain_pct >= SELL_PCT:
            signal = "SELL"
        elif gain_pct >= NEAR_SELL_PCT:
            signal = "NEAR_SELL"
        elif price > 0 and buy_thresh > 0 and price <= buy_thresh:
            signal = "BUY"
        else:
            signal = "HOLD"

        enriched.append({
            **lot,
            "current_price": round(price, 6),
            "gain_pct":      round(gain_pct, 2),
            "signal":        signal,
            "market_value":  round(price * lot["qty"], 2) if price > 0 else 0,
        })
    return enriched

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print("=== fetch_crypto.py starting ===")
    uae_now = datetime.fromtimestamp(time.time() + UAE_OFFSET, tz=timezone.utc)
    print(f"UAE time: {uae_now.strftime('%Y-%m-%d %H:%M:%S')}")

    print("Fetching live prices...")
    prices = fetch_prices()
    print(f"  Prices: {list(prices.keys())}")

    print("Fetching Exchange balances...")
    exchange_balances = fetch_exchange_balances()
    print(f"  Exchange balances: {exchange_balances}")

    print("Parsing CSV for buy lots...")
    buy_lots, sell_qty = parse_csv_lots()

    print("Reconstructing open lots (reconciled to Exchange balance)...")
    lots = reconstruct_lots(buy_lots, sell_qty, exchange_balances)
    print(f"  {len(lots)} open lots")

    print("Applying signals...")
    lots = apply_signals(lots, prices)

    by_signal = {}
    for lot in lots:
        by_signal.setdefault(lot["signal"], 0)
        by_signal[lot["signal"]] += 1
    print(f"  Signal breakdown: {by_signal}")

    output = {
        "updated_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "updated_uae": uae_now.strftime("%Y-%m-%d %H:%M:%S"),
        "prices":      prices,
        "lots":        lots,
        "thresholds": {
            "sell_pct":      SELL_PCT,
            "near_sell_pct": NEAR_SELL_PCT,
            "buy_pct":       BUY_PCT,
        },
    }

    os.makedirs("data", exist_ok=True)
    with open("data/crypto_portfolio.json", "w") as f:
        json.dump(output, f, indent=2)
    print("Saved → data/crypto_portfolio.json")
    print("=== done ===")

if __name__ == "__main__":
    main()
