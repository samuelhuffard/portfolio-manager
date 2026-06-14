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

    if not username or not password or not totp_secret:
        print(json.dumps({"error": "Missing ROBINHOOD_USERNAME/ROBINHOOD_PASSWORD/ROBINHOOD_TOTP_SECRET env vars"}))
        sys.exit(1)

    try:
        totp = pyotp.TOTP(totp_secret).now()
        rh.login(username, password, mfa_code=totp, store_session=True)
    except Exception as e:
        print(json.dumps({"error": f"Login failed (may need manual re-auth): {e}"}))
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
