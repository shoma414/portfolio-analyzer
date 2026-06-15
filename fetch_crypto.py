#!/usr/bin/env python3
"""
fetch_crypto.py
- Reads crypto_transactions.xlsx from data/ for historical App buy lots
- Fetches new Exchange buy orders (post-App migration) from Exchange API
- Merges both sources, applies LOFO sells (cheapest lot before sell date first)
- Fetches live prices and balances from Exchange API
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
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

# ── Config ─────────────────────────────────────────────────────────────────────
API_KEY    = os.environ["CDC_API_KEY"]
API_SECRET = os.environ["CDC_API_SECRET"]
BASE_URL   = "https://api.crypto.com/exchange/v1"

TRACKED_COINS = ["BTC", "ETH", "SOL", "XRP", "SUI", "CRO", "HBAR", "ADA", "AVAX"]

DIRECT_BUY_KINDS = ["viban_purchase"]
SELL_KINDS = [
    "trading.limit_order.cash_account.sell_commit",
    "crypto_viban_exchange",
]

SELL_PCT      = 10.0
NEAR_SELL_PCT =  7.0
BUY_PCT       =  5.0
UAE_OFFSET    = 4 * 3600
CSV_PATH      = "data/crypto_transactions.xlsx"

# Date when coins were moved from App to Exchange
# Exchange orders after this date are new direct Exchange buys
MIGRATION_DATE = "2026-06-05"

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
                    # "k" = last traded price on CDC Exchange
                    for field in ["k", "a", "b"]:
                        val = float(t.get(field, 0) or 0)
                        if val > 0:
                            prices[coin] = round(val, 6)
                            break
    except Exception as e:
        print(f"  Warning fetching prices: {e}")
    return prices

# ── Fetch live Exchange balances ────────────────────────────────────────────────
def fetch_exchange_balances() -> dict:
    balances = {}
    try:
        result = private_post("private/user-balance")
        for account in result.get("data", []):
            for pos in account.get("position_balances", []):
                coin = pos.get("instrument_name", "")
                qty  = float(pos.get("quantity", 0) or 0)
                if coin in TRACKED_COINS and qty > 0:
                    balances[coin] = qty
    except Exception as e:
        print(f"  Warning fetching balances: {e}")
    return balances

# ── Fetch Exchange order history (new buys after migration) ────────────────────
def fetch_exchange_orders() -> list:
    """
    Fetch filled BUY orders placed directly on the Exchange.
    These are new purchases made after moving from the App.
    """
    exchange_lots = []
    for coin in TRACKED_COINS:
        # Try both USD and USDT instrument names
        for instrument in [f"{coin}_USD", f"{coin}_USDT"]:
            start_id = None
            while True:
                params = {"instrument_name": instrument, "page_size": 100}
                if start_id:
                    params["start_id"] = str(start_id)
                try:
                    time.sleep(0.3)
                    result = private_post("private/get-order-history", params)
                    orders = result.get("order_list", [])
                    if coin == "BTC":
                        print(f"  DEBUG {instrument}: result keys={list(result.keys())}, orders count={len(orders)}")
                        if orders:
                            print(f"  DEBUG first order: {orders[0]}")
                        else:
                            print(f"  DEBUG full result: {result}")
                except Exception as e:
                    print(f"  Warning fetching Exchange orders for {instrument}: {e}")
                    break
                if not orders:
                    break
                for o in orders:
                    if o.get("status") != "FILLED":
                        continue
                    side   = o.get("side", "").upper()
                    qty    = float(o.get("cumulative_quantity", 0) or 0)
                    avg_px = float(o.get("avg_price", 0) or 0)
                    ts_ms  = int(o.get("create_time", 0) or 0)
                    date_str = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")

                    if qty <= 0 or avg_px <= 0:
                        continue

                    # Only include buys made AFTER migration date
                    if side == "BUY" and date_str >= MIGRATION_DATE:
                        exchange_lots.append({
                            "coin":      coin,
                            "qty":       qty,
                            "cost_usd":  round(avg_px, 6),
                            "date":      date_str,
                            "remaining": qty,
                            "source":    "exchange",
                        })

                if len(orders) < 100:
                    break
                start_id = orders[-1].get("order_id")
                if not start_id:
                    break

    print(f"  {len(exchange_lots)} new Exchange buy lots found")
    return exchange_lots

# ── Parse CSV for historical App buy lots ──────────────────────────────────────
def parse_csv_lots() -> tuple:
    if not os.path.exists(CSV_PATH):
        print(f"  Warning: {CSV_PATH} not found")
        return [], {}

    df = None
    if HAS_PANDAS:
        try:
            df = pd.read_excel(CSV_PATH)
        except Exception as e:
            print(f"  Warning reading CSV: {e}")
            return [], {}
    else:
        print("  Warning: pandas not available")
        return [], {}

    buy_lots = []
    sell_qty = {}

    for _, row in df.iterrows():
        kind       = str(row.get("Transaction Kind", "") or "")
        to_curr    = str(row.get("To Currency", "") or "").strip()
        to_amt     = row.get("To Amount", None)
        currency   = str(row.get("Currency", "") or "").strip()
        amount     = row.get("Amount", None)
        native_usd = row.get("Native Amount (in USD)", None)
        ts         = row.get("Timestamp (UTC)", None)
        date_str   = str(ts)[:10] if ts else "unknown"

        if kind in DIRECT_BUY_KINDS:
            if to_curr in TRACKED_COINS and to_amt and float(to_amt) > 0:
                qty      = float(to_amt)
                cost_usd = abs(float(native_usd)) / qty if native_usd and qty > 0 else 0
                if cost_usd > 0:
                    buy_lots.append({
                        "coin":      to_curr,
                        "qty":       qty,
                        "cost_usd":  round(cost_usd, 6),
                        "date":      date_str,
                        "remaining": qty,
                        "source":    "csv",
                    })

        elif kind in SELL_KINDS:
            if currency in TRACKED_COINS and amount:
                sell_qty.setdefault(currency, []).append({
                    "qty":  abs(float(amount)),
                    "date": date_str,
                })

    buy_lots.sort(key=lambda x: (x["coin"], x["date"]))
    print(f"  {len(buy_lots)} historical App buy lots from CSV")
    sell_summary = {c: round(sum(s["qty"] for s in v), 8) for c, v in sell_qty.items()}
    print(f"  Sells from CSV: {sell_summary}")
    return buy_lots, sell_qty

# ── Merge CSV + Exchange lots ──────────────────────────────────────────────────
def merge_lots(csv_lots: list, exchange_lots: list) -> list:
    """
    Merge CSV (historical App) lots and Exchange (new direct) lots.
    Deduplicate by coin+date+qty in case of overlap.
    """
    seen = set()
    merged = []
    for lot in csv_lots + exchange_lots:
        key = (lot["coin"], lot["date"], round(lot["qty"], 6))
        if key not in seen:
            seen.add(key)
            merged.append(dict(lot))
    merged.sort(key=lambda x: (x["coin"], x["date"]))
    return merged

# ── Reconstruct open lots ──────────────────────────────────────────────────────
def reconstruct_lots(all_lots: list, sell_qty: dict, exchange_balances: dict) -> list:
    """
    Apply LOFO sells (cheapest lot available before sell date consumed first).
    Only show coins confirmed on Exchange.
    """
    by_coin = {}
    for lot in all_lots:
        by_coin.setdefault(lot["coin"], []).append(dict(lot))

    # Apply sells: cheapest eligible lot (before sell date) consumed first
    for coin, sell_list in sell_qty.items():
        if coin not in by_coin:
            continue
        for sell in sell_list:
            remaining_sell = sell["qty"]
            sell_date      = sell["date"]
            eligible = sorted(
                [l for l in by_coin[coin] if l["date"] <= sell_date],
                key=lambda x: x["cost_usd"]
            )
            for lot in eligible:
                if remaining_sell <= 0:
                    break
                reduce = min(lot["remaining"], remaining_sell)
                lot["remaining"] -= reduce
                remaining_sell   -= reduce

    open_lots = []
    for coin in TRACKED_COINS:
        if exchange_balances.get(coin, 0) <= 0:
            continue
        for lot in by_coin.get(coin, []):
            if lot["remaining"] > 0.000001:
                open_lots.append({
                    "coin":     coin,
                    "qty":      round(lot["remaining"], 8),
                    "cost_usd": round(lot["cost_usd"], 6),
                    "date":     lot["date"],
                    "source":   lot.get("source", "csv"),
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
        coin       = lot["coin"]
        price      = prices.get(coin, 0)
        cost       = lot["cost_usd"]
        gain_pct   = ((price - cost) / cost * 100) if cost > 0 and price > 0 else 0
        low_cost   = lowest_cost.get(coin, cost)
        buy_thresh = low_cost * (1 - BUY_PCT / 100) if low_cost > 0 else 0

        if cost <= 0:
            signal = "HOLD"
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
    print(f"  Balances: {exchange_balances}")

    print("Parsing CSV for historical App lots...")
    csv_lots, sell_qty = parse_csv_lots()

    print("Fetching new Exchange buy orders...")
    exchange_lots = fetch_exchange_orders()

    print("Merging CSV + Exchange lots...")
    all_lots = merge_lots(csv_lots, exchange_lots)
    print(f"  Total lots before sells: {len(all_lots)}")

    print("Reconstructing open lots...")
    lots = reconstruct_lots(all_lots, sell_qty, exchange_balances)
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
