#!/usr/bin/env python3
"""
fetch_crypto.py
Fetches open buy lots from Crypto.com Exchange API and saves to data/crypto_portfolio.json
Signals: sell >= 10%, near sell >= 7%, buy <= lowest lot cost * 0.95
"""

import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone

import requests

# ── Config ────────────────────────────────────────────────────────────────────
API_KEY    = os.environ["CDC_API_KEY"]
API_SECRET = os.environ["CDC_API_SECRET"]
BASE_URL   = "https://api.crypto.com/exchange/v1"

TRACKED_COINS = ["BTC", "ETH", "SOL", "XRP", "SUI", "CRO", "HBAR", "ADA", "AVAX"]

SELL_PCT      = 10.0
NEAR_SELL_PCT =  7.0
BUY_PCT       =  5.0

UAE_OFFSET = 4 * 3600

# ── Signing (exact algorithm from CDC docs) ───────────────────────────────────
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
            elif isinstance(val, list):
                result += params_to_str(val, level + 1)
            elif isinstance(val, dict):
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

# ── Fetch current prices via public/get-tickers ───────────────────────────────
def fetch_prices() -> dict:
    prices = {}
    try:
        resp = requests.get(
            f"{BASE_URL}/public/get-tickers",
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        tickers = data.get("result", {}).get("data", [])
        for t in tickers:
            inst = t.get("i", "")          # e.g. "BTC_USDT"
            for coin in TRACKED_COINS:
                if inst == f"{coin}_USDT":
                    # "a" = best ask, "b" = best bid; use mid or last trade "k"
                    ask = float(t.get("a", 0) or 0)
                    bid = float(t.get("b", 0) or 0)
                    last = float(t.get("k", 0) or 0)
                    # prefer last trade price; fall back to mid
                    if last > 0:
                        prices[coin] = last
                    elif ask > 0 and bid > 0:
                        prices[coin] = (ask + bid) / 2
                    elif ask > 0:
                        prices[coin] = ask
    except Exception as e:
        print(f"  Warning: could not fetch tickers: {e}")
    return prices

# ── Fetch order history ────────────────────────────────────────────────────────
def fetch_all_orders() -> list:
    all_orders = []
    for coin in TRACKED_COINS:
        instrument = f"{coin}_USDT"
        start_id = None
        while True:
            params = {
                "instrument_name": instrument,
                "page_size": 100,
            }
            if start_id:
                params["start_id"] = str(start_id)
            try:
                time.sleep(1.1)   # rate limit: 1 req/sec
                result = private_post("private/get-order-history", params)
                orders = result.get("order_list", [])
            except Exception as e:
                print(f"  Warning: {instrument}: {e}")
                break
            if not orders:
                break
            # only keep FILLED BUY orders
            all_orders.extend([o for o in orders
                                if o.get("status") == "FILLED"
                                and o.get("side", "").upper() == "BUY"])
            if len(orders) < 100:
                break
            start_id = orders[-1].get("order_id")
            if not start_id:
                break
    return all_orders

def fetch_all_sells() -> dict:
    """Returns {coin: total_qty_sold}"""
    sells = {}
    for coin in TRACKED_COINS:
        instrument = f"{coin}_USDT"
        start_id = None
        total_sold = 0.0
        while True:
            params = {
                "instrument_name": instrument,
                "page_size": 100,
            }
            if start_id:
                params["start_id"] = str(start_id)
            try:
                time.sleep(1.1)
                result = private_post("private/get-order-history", params)
                orders = result.get("order_list", [])
            except Exception as e:
                print(f"  Warning sells {instrument}: {e}")
                break
            if not orders:
                break
            for o in orders:
                if (o.get("status") == "FILLED"
                        and o.get("side", "").upper() == "SELL"):
                    total_sold += float(o.get("cumulative_quantity", 0) or 0)
            if len(orders) < 100:
                break
            start_id = orders[-1].get("order_id")
            if not start_id:
                break
        if total_sold > 0:
            sells[coin] = total_sold
    return sells

# ── Reconstruct open lots ──────────────────────────────────────────────────────
def reconstruct_lots(buy_orders: list, sells: dict) -> list:
    # Group buys by coin, sort oldest first
    buys_by_coin = {}
    for o in buy_orders:
        inst = o.get("instrument_name", "")
        coin = inst.replace("_USDT", "")
        if coin not in TRACKED_COINS:
            continue
        qty    = float(o.get("cumulative_quantity", 0) or 0)
        avg_px = float(o.get("avg_price", 0) or 0)
        ts_ms  = int(o.get("create_time", 0) or 0)
        if qty <= 0 or avg_px <= 0:
            continue
        date_str = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        buys_by_coin.setdefault(coin, []).append({
            "coin":      coin,
            "qty":       qty,
            "cost_usd":  avg_px,
            "date":      date_str,
            "remaining": qty,
        })

    for coin in buys_by_coin:
        buys_by_coin[coin].sort(key=lambda x: x["date"])

    # Apply sells FIFO per coin
    for coin, sold_qty in sells.items():
        if coin not in buys_by_coin:
            continue
        remaining_sell = sold_qty
        for lot in buys_by_coin[coin]:
            if remaining_sell <= 0:
                break
            reduce = min(lot["remaining"], remaining_sell)
            lot["remaining"] -= reduce
            remaining_sell   -= reduce

    # Collect open lots
    open_lots = []
    for coin in TRACKED_COINS:
        for lot in buys_by_coin.get(coin, []):
            if lot["remaining"] > 0.000001:
                open_lots.append({
                    "coin":     lot["coin"],
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
        if c not in lowest_cost or lot["cost_usd"] < lowest_cost[c]:
            lowest_cost[c] = lot["cost_usd"]

    enriched = []
    for lot in lots:
        coin      = lot["coin"]
        price     = prices.get(coin, 0)
        cost      = lot["cost_usd"]
        gain_pct  = ((price - cost) / cost * 100) if cost > 0 else 0
        low_cost  = lowest_cost.get(coin, cost)
        buy_thresh = low_cost * (1 - BUY_PCT / 100)

        if gain_pct >= SELL_PCT:
            signal = "SELL"
        elif gain_pct >= NEAR_SELL_PCT:
            signal = "NEAR_SELL"
        elif price > 0 and price <= buy_thresh:
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

    print("Fetching buy orders...")
    buy_orders = fetch_all_orders()
    print(f"  {len(buy_orders)} filled buy orders found")

    print("Fetching sell orders...")
    sells = fetch_all_sells()
    print(f"  Sells: {sells}")

    print("Fetching current prices...")
    prices = fetch_prices()
    print(f"  Prices fetched: {list(prices.keys())}")

    print("Reconstructing open lots...")
    lots = reconstruct_lots(buy_orders, sells)
    print(f"  {len(lots)} open lots found")

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
