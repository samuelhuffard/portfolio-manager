#!/usr/bin/env python3
"""Read-only Robinhood sync.

Logs in via robin_stocks with TOTP-based 2FA, dumps open stock positions,
cash, and portfolio value as JSON to stdout, then logs out. Never places
orders or modifies the account — read-only by design.
"""

import json
import os
import sys

import pyotp
import robin_stocks.robinhood as rh


def main():
    username = os.environ.get("ROBINHOOD_USERNAME", "").strip()
    password = os.environ.get("ROBINHOOD_PASSWORD", "").strip()
    totp_secret = os.environ.get("ROBINHOOD_TOTP_SECRET", "").strip()

    if not username or not password:
        print(json.dumps({"error": "Missing ROBINHOOD_USERNAME/ROBINHOOD_PASSWORD env vars"}))
        sys.exit(1)

    try:
        store_session = os.environ.get("ROBINHOOD_STORE_SESSION", "").strip().lower() in {"1", "true", "yes"}
        if totp_secret:
            mfa_code = pyotp.TOTP(totp_secret).now()
            login_result = rh.login(username, password, mfa_code=mfa_code, store_session=store_session)
        else:
            login_result = rh.login(username, password, store_session=store_session)
    except Exception as e:
        print(json.dumps({"error": f"Login failed (may need manual re-auth): {e}"}))
        sys.exit(1)

    # robin_stocks' login() can fail silently (prints a message, returns a
    # falsy/error dict) instead of raising — without this check a failed
    # login proceeds to fetch from an unauthenticated session and reports
    # an empty portfolio as if it were real data.
    if not login_result or not isinstance(login_result, dict) or "access_token" not in login_result:
        print(json.dumps({"error": "Login failed: no access token returned (check credentials / device verification)"}))
        sys.exit(1)

    try:
        holdings = []
        for p in rh.get_open_stock_positions():
            quantity = float(p.get("quantity", 0))
            if quantity <= 0:
                continue
            instrument = rh.get_instrument_by_url(p["instrument"])
            holdings.append({
                "ticker": instrument.get("symbol"),
                "shares": quantity,
                "avgCost": float(p.get("average_buy_price", 0)),
            })

        profile = rh.load_portfolio_profile() or {}

        print(json.dumps({
            "holdings": holdings,
            "cash": float(profile.get("withdrawable_amount") or 0),
            "portfolioValue": float(profile.get("equity") or 0),
        }))
    except Exception as e:
        print(json.dumps({"error": f"Data fetch failed: {e}"}))
        sys.exit(1)
    finally:
        try:
            rh.logout()
        except Exception:
            pass


if __name__ == "__main__":
    main()
