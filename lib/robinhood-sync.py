#!/usr/bin/env python3
"""Read-only Robinhood sync.

Logs in via robin_stocks with TOTP-based 2FA, dumps open stock positions,
cash, portfolio value, and filled orders since a given timestamp as JSON to
stdout, then logs out. Never places orders or modifies the account — read-only
by design.

Usage: robinhood-sync.py [since_iso]
  since_iso — only orders filled at or after this ISO timestamp are returned
  as `fills`. Defaults to returning none (omit or pass "" to skip the fills
  fetch entirely, e.g. on a transient Robinhood orders-endpoint outage).
"""

import json
import os
import sys
from datetime import datetime, timezone

import pyotp
import robin_stocks.robinhood as rh

# robin_stocks 3.4.0's login() only returns the auth data from inside its
# `if store_session:` branch — with store_session=False a successful login
# still falls through to "Login failed" and returns None, even though the
# session is actually authenticated. Always store the session pickle to get
# a real return value, then delete it ourselves if persistence wasn't asked
# for, so nothing lingers on disk.
PICKLE_PATH = os.path.join(os.path.expanduser("~"), ".tokens", "robinhood.pickle")


def main():
    username = os.environ.get("ROBINHOOD_USERNAME", "").strip()
    password = os.environ.get("ROBINHOOD_PASSWORD", "").strip()
    totp_secret = os.environ.get("ROBINHOOD_TOTP_SECRET", "").strip()
    persist_session = os.environ.get("ROBINHOOD_STORE_SESSION", "").strip().lower() in {"1", "true", "yes"}
    # This login has multiple brokerage accounts underneath it (individual, Roth IRA, and
    # the "Agentic" cash account this bot actually trades in). Without an explicit account
    # number, robin_stocks silently falls back to whichever account Robinhood flags
    # is_default=true — which is the unrelated individual account, not this one — so every
    # position/cash figure synced would be for the wrong account with no error raised.
    account_number = os.environ.get("ROBINHOOD_ACCOUNT_NUMBER", "").strip()

    if not username or not password:
        print(json.dumps({"error": "Missing ROBINHOOD_USERNAME/ROBINHOOD_PASSWORD env vars"}))
        sys.exit(1)
    if not account_number:
        print(json.dumps({"error": "Missing ROBINHOOD_ACCOUNT_NUMBER env var — this login has multiple accounts, so the account to sync must be explicit."}))
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

    # robin_stocks' login() can fail silently (prints a message, returns a
    # falsy/error dict) instead of raising — without this check a failed
    # login proceeds to fetch from an unauthenticated session and reports
    # an empty portfolio as if it were real data.
    if not login_result or not isinstance(login_result, dict) or "access_token" not in login_result:
        print(json.dumps({"error": "Login failed: no access token returned (check credentials / device verification)"}))
        sys.exit(1)

    try:
        holdings = []
        for p in rh.get_open_stock_positions(account_number=account_number):
            quantity = float(p.get("quantity", 0))
            if quantity <= 0:
                continue
            instrument = rh.get_instrument_by_url(p["instrument"])
            holdings.append({
                "ticker": instrument.get("symbol"),
                "shares": quantity,
                "avgCost": float(p.get("average_buy_price", 0)),
            })

        profile = rh.load_portfolio_profile(account_number=account_number) or {}

        fills = []
        fills_error = None
        since_iso = sys.argv[1].strip() if len(sys.argv) > 1 else ""
        if since_iso:
            try:
                since_dt = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
                for o in rh.get_all_stock_orders(account_number=account_number):
                    if o.get("state") != "filled":
                        continue
                    updated_at = o.get("updated_at") or o.get("last_transaction_at") or ""
                    try:
                        order_dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
                    except ValueError:
                        continue
                    if order_dt <= since_dt:
                        continue
                    shares = float(o.get("cumulative_quantity") or 0)
                    price = float(o.get("average_price") or 0)
                    if shares <= 0 or price <= 0:
                        continue
                    instrument = rh.get_instrument_by_url(o["instrument"])
                    fills.append({
                        "ticker": instrument.get("symbol"),
                        "side": (o.get("side") or "").upper(),
                        "shares": shares,
                        "price": price,
                        "amount": round(shares * price, 2),
                        "date": updated_at[:10],
                        "orderId": o.get("id"),
                    })
            except Exception as e:
                # Order history is a secondary feature — a failure here shouldn't block
                # the primary holdings/cash sync. Falls back to no fills this run; the
                # diff-based fallback (comparing successive Holdings snapshots) covers
                # the gap if this keeps failing.
                fills_error = str(e)

        result = {
            "holdings": holdings,
            "cash": float(profile.get("withdrawable_amount") or 0),
            "portfolioValue": float(profile.get("equity") or 0),
            "fills": fills,
            "syncedAt": datetime.now(timezone.utc).isoformat(),
        }
        if fills_error:
            result["fillsError"] = fills_error
        print(json.dumps(result))
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
