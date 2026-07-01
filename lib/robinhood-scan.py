#!/usr/bin/env python3
"""Read-only Robinhood market scan.

Logs in via robin_stocks with TOTP-based 2FA, pulls S&P 500 top movers (up
and down) and the Top 100 most popular Robinhood stocks, dumps them as JSON
to stdout, then logs out. Never places orders, modifies the account, or reads
positions — read-only and account-agnostic by design, unlike robinhood-sync.py.

This exists so research-scan.js can source genuinely new tickers (outside each
agent's static watchlist) on every run without depending on the Mac-companion
+ Claude pipeline that scripts/sync-market-scans-from-mcp.js expects — that
path requires a human-run session and was never actually being run.

Usage: robinhood-scan.py
"""

import json
import os
import sys

import pyotp
import robin_stocks.robinhood as rh

# Same pickle-persistence workaround as robinhood-sync.py: robin_stocks 3.4.0's
# login() only returns real auth data when store_session=True.
PICKLE_PATH = os.path.join(os.path.expanduser("~"), ".tokens", "robinhood.pickle")


def as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def movers_to_rows(movers, direction):
    rows = []
    for m in movers or []:
        symbol = m.get("symbol")
        if not symbol:
            continue
        movement = m.get("price_movement") or {}
        rows.append({
            "symbol": symbol,
            "description": m.get("description") or "",
            "price": as_float(movement.get("market_hours_last_price")),
            "changePct": as_float(movement.get("market_hours_last_movement_pct")),
            "direction": direction,
        })
    return rows


def quotes_to_rows(quotes):
    rows = []
    for q in quotes or []:
        if not q:
            continue
        symbol = q.get("symbol")
        if not symbol:
            continue
        last = as_float(q.get("last_trade_price"))
        prev = as_float(q.get("adjusted_previous_close") or q.get("previous_close"))
        change_pct = round((last - prev) / prev * 100, 2) if last is not None and prev else None
        rows.append({
            "symbol": symbol,
            "description": "",
            "price": last,
            "changePct": change_pct,
        })
    return rows


def main():
    username = os.environ.get("ROBINHOOD_USERNAME", "").strip()
    password = os.environ.get("ROBINHOOD_PASSWORD", "").strip()
    totp_secret = os.environ.get("ROBINHOOD_TOTP_SECRET", "").strip()
    persist_session = os.environ.get("ROBINHOOD_STORE_SESSION", "").strip().lower() in {"1", "true", "yes"}

    if not username or not password:
        print(json.dumps({"error": "Missing ROBINHOOD_USERNAME/ROBINHOOD_PASSWORD env vars"}))
        sys.exit(1)

    try:
        if totp_secret:
            mfa_code = pyotp.TOTP(totp_secret).now()
            login_result = rh.login(username, password, mfa_code=mfa_code, store_session=True)
        else:
            login_result = rh.login(username, password, store_session=True)
    except Exception as e:
        print(json.dumps({"error": f"Login failed (may need manual re-auth): {e}"}))
        sys.exit(1)
    finally:
        if not persist_session:
            try:
                os.remove(PICKLE_PATH)
            except OSError:
                pass

    if not login_result or not isinstance(login_result, dict) or "access_token" not in login_result:
        print(json.dumps({"error": "Login failed: no access token returned (check credentials / device verification)"}))
        sys.exit(1)

    try:
        movers_up = movers_to_rows(rh.get_top_movers_sp500("up"), "up")
        movers_down = movers_to_rows(rh.get_top_movers_sp500("down"), "down")
        top100 = quotes_to_rows(rh.get_top_100())

        print(json.dumps({
            "moversUp": movers_up,
            "moversDown": movers_down,
            "top100": top100,
        }))
    except Exception as e:
        print(json.dumps({"error": f"Market scan fetch failed: {e}"}))
        sys.exit(1)
    finally:
        try:
            rh.logout()
        except Exception:
            pass


if __name__ == "__main__":
    main()
