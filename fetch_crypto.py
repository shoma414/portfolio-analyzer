#!/usr/bin/env python3
"""
fetch_crypto.py
Fetches open buy lots from Crypto.com Exchange API and saves to data/crypto_portfolio.json
Signals: sell >= 10%, near sell >= 7%, buy <= lowest lot cost * 0.95
Runs as part of GitHub Actions daily workflow.
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

# Coins to track (direct buys on Exchange only — no baskets)
TRACKED_COINS = ["BTC", "ETH", "SOL", "XRP", "SUI", "CRO", "HBAR", "ADA", "AVAX"]

# Signal thresholds
SELL_PCT       = 10.0
NEAR_SELL_PCT  =  7.0
BUY_PCT        =  5.0   # buy when price <= lowest_lot_cost * (1 - BUY_PCT/100)

# UAE timezone offset
UAE_OFFSET = 4 * 3600

# ── HMAC signing ──────────────────────────────────────────────────────────────
def sign_request(method: str, params: dict, nonce: int) -> dict:
    """Build signed request body for private endpoints."""
    param_string = ""
    if params:
        param_string = "".join(
            f"{k}{v}" for k, v in sorted(params.items())
        )
    sig_payload = method + str(nonce) + API_KEY + param_string + str(nonce)
    sig = hmac.new(
        API_SECRET.encode("utf-8"),
        sig_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "id": nonce,
        "method": method,
        "api_key": API_KEY,
        "params": params,
        "nonce": nonce,
        "sig": sig,
    }

def private_post(method: str, params: dict = None) -> dict:
    """POST to a private endpoint, return result dict."""
    if params is None:
        params = {}
    nonce = int(time.time() * 1000)
    body  = sign_request(method, params, nonce)
    resp  = requests.post(
        f"{BASE_URL}/{method}",
        json=body,
        headers={"Content-Type": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"API error {data.get('code')}: {data.get('message')}")
    return data["result"]

def public_get(endpoint: str, params: dict = None) -> dict:
    """GET a public endpoint, return result dict."""
    resp = requests.get(
        f"{BASE_URL}/{endpoint}",
        params=params or {},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"API error {data.get('code')}: {data.get('message')}")
    return data["result"]

# ── Fetch trade history ────────────────────────────────────────────────────────
def fetch_all_trades() -> list:
    """
    Fetch full trade history for all tracked coins.
    CDC API returns max 100 trades per call; paginate with start_id.
    """
    all_trades = []
    for coin in TRACKED_COINS:
        instrument = f"{coin}_USDT"
        last_id = None
        while True:
            params = {"instrument_name": instrument, "page_size": 100}
            if last_id:
                params["start_id"] = last_id
            try:
                result = private_post("private/get-trades", params)
                trades = result.get("trade_list", [])
            except Exception as e:
                print(f"  Warning: could not fetch trades for {instrument}: {e}")
                break
            if not trades:
                break
            all_trades.extend(trades)
            if len(trades) < 100:
                break
            last_id = trades[-1]["trade_id"]
            time.sleep(0.1)   # respect rate limits
    return all_trades

# ── Fetch order history (for cost basis) ──────────────────────────────────────
def fetch_all_orders() -> list:
    """
    Fetch full order history. We use order history to get avg fill price per order.
    Paginate with start_id.
    """
    all_orders = []
    for coin in TRACKED_COINS:
        instrument = f"{coin}_USDT"
        last_id = None
        while True:
            params = {
                "instrument_name": instrument,
                "page_size": 100,
                "status": "FILLED",
            }
            if last_id:
                params["start_id"] = last_id
            try:
                result = private_post("private/get-order-history", params)
                orders = result.get("order_list", [])
            except Exception as e:
                print(f"  Warning: could not fetch orders for {instrument}: {e}")
                break
            if not orders:
                break
            all_orders.extend(orders)
            if len(orders) < 100:
                break
            last_id = orders[-1]["order_id"]
            time.sleep(0.1)
    return all_orders

# ── Fetch current prices ───────────────────────────────────────────────────────
def fetch_prices() -> dict:
    """Fetch current mark price for each tracked coin via public ticker."""
    prices = {}
    for coin in TRACKED_COINS:
        instrument = f"{coin}_USDT"
        try:
            result = public_get("public/get-ticker", {"instrument_name": instrument})
            tickers = result.get("data", [])
            if tickers:
                prices[coin] = float(tickers[0].get("a", 0))  # "a" = best ask ~ mark price
        except Exception as e:
            print(f"  Warning: could not fetch price for {instrument}: {e}")
    return prices

# ── Reconstruct open lots ──────────────────────────────────────────────────────
def reconstruct_lots(orders: list) -> list:
    """
    Each filled BUY order = one open lot.
    Sell orders reduce quantity FIFO from oldest lots.
    Returns list of open lot dicts.
    """
    # Separate buys and sells per coin
    buys  = {}   # coin -> list of lots sorted by time asc
    sells = {}   # coin -> list of sell qty sorted by time asc

    for order in orders:
        side   = order.get("side", "").upper()
        inst   = order.get("instrument_name", "")
        coin   = inst.replace("_USDT", "").replace("_USD", "")
        if coin not in TRACKED_COINS:
            continue
        qty    = float(order.get("cumulative_quantity", 0) or 0)
        avg_px = float(order.get("avg_price", 0) or 0)
        ts_ms  = int(order.get("create_time", 0) or 0)
        ts_s   = ts_ms / 1000
        date_str = datetime.fromtimestamp(ts_s, tz=timezone.utc).strftime("%Y-%m-%d")

        if qty == 0 or avg_px == 0:
            continue

        if side == "BUY":
            buys.setdefault(coin, []).append({
                "coin":       coin,
                "qty":        qty,
                "cost_usd":   avg_px,
                "date":       date_str,
                "order_id":   order.get("order_id", ""),
                "remaining":  qty,   # will be reduced by sells
            })
        elif side == "SELL":
            sells.setdefault(coin, []).append({
                "qty": qty,
                "date": date_str,
            })

    # Sort buys oldest first, sells oldest first
    for coin in buys:
        buys[coin].sort(key=lambda x: x["date"])
    for coin in sells:
        sells[coin].sort(key=lambda x: x["date"])

    # Apply sells FIFO
    for coin, sell_list in sells.items():
        if coin not in buys:
            continue
        lot_idx = 0
        for sell in sell_list:
            remaining_sell = sell["qty"]
            while remaining_sell > 0 and lot_idx < len(buys[coin]):
                lot = buys[coin][lot_idx]
                if lot["remaining"] <= remaining_sell:
                    remaining_sell -= lot["remaining"]
                    lot["remaining"] = 0
                    lot_idx += 1
                else:
                    lot["remaining"] -= remaining_sell
                    remaining_sell = 0

    # Collect open lots (remaining qty > 0.000001)
    open_lots = []
    for coin in TRACKED_COINS:
        for lot in buys.get(coin, []):
            if lot["remaining"] > 0.000001:
                open_lots.append({
                    "coin":     lot["coin"],
                    "qty":      round(lot["remaining"], 8),
                    "cost_usd": round(lot["cost_usd"], 6),
                    "date":     lot["date"],
                    "order_id": lot["order_id"],
                })

    return open_lots

# ── Apply signals ──────────────────────────────────────────────────────────────
def apply_signals(lots: list, prices: dict) -> list:
    """
    Add current_price, gain_pct, signal to each lot.
    Also determine per-coin buy signal based on lowest cost lot.
    """
    # Find lowest cost lot per coin for buy signal
    lowest_cost = {}
    for lot in lots:
        coin = lot["coin"]
        if coin not in lowest_cost or lot["cost_usd"] < lowest_cost[coin]:
            lowest_cost[coin] = lot["cost_usd"]

    enriched = []
    for lot in lots:
        coin       = lot["coin"]
        price      = prices.get(coin, 0)
        cost       = lot["cost_usd"]
        gain_pct   = ((price - cost) / cost * 100) if cost > 0 else 0
        low_cost   = lowest_cost.get(coin, cost)
        buy_thresh = low_cost * (1 - BUY_PCT / 100)

        if gain_pct >= SELL_PCT:
            signal = "SELL"
        elif gain_pct >= NEAR_SELL_PCT:
            signal = "NEAR_SELL"
        elif price <= buy_thresh:
            signal = "BUY"
        else:
            signal = "HOLD"

        enriched.append({
            **lot,
            "current_price": round(price, 6),
            "gain_pct":      round(gain_pct, 2),
            "signal":        signal,
            "market_value":  round(price * lot["qty"], 2),
        })

    return enriched

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print("=== fetch_crypto.py starting ===")
    uae_now = datetime.fromtimestamp(time.time() + UAE_OFFSET, tz=timezone.utc)
    print(f"UAE time: {uae_now.strftime('%Y-%m-%d %H:%M:%S')}")

    print("Fetching order history...")
    orders = fetch_all_orders()
    print(f"  {len(orders)} filled orders found")

    print("Fetching current prices...")
    prices = fetch_prices()
    print(f"  Prices: {prices}")

    print("Reconstructing open lots...")
    lots = reconstruct_lots(orders)
    print(f"  {len(lots)} open lots found")

    print("Applying signals...")
    lots = apply_signals(lots, prices)

    # Summary
    by_signal = {}
    for lot in lots:
        by_signal.setdefault(lot["signal"], 0)
        by_signal[lot["signal"]] += 1
    print(f"  Signal breakdown: {by_signal}")

    # Build output
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
