from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import json
import math
import os

from webull.core.client import ApiClient
from webull.data.data_client import DataClient
from webull.data.common.category import Category
from webull.data.common.timespan import Timespan

NY = ZoneInfo("America/New_York")


def _f(v, default=None):
    if v is None or v == "":
        return default
    try:
        return float(v)
    except Exception:
        return default


def _num(d, *keys, default=None):
    if not isinstance(d, dict):
        return default
    for k in keys:
        if k in d:
            x = _f(d.get(k), None)
            if x is not None:
                return x
    return default


def _txt(d, *keys, default=None):
    if not isinstance(d, dict):
        return default
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return str(v)
    return default


def _walk(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _find_symbol(payload, symbol):
    for d in _walk(payload):
        if _txt(d, "symbol", "ticker", "code") == symbol:
            return d
    return {}


def _records(payload, kind=None):
    out = []
    seen = set()
    for d in _walk(payload):
        ok = False
        if kind == "bar":
            ok = ("close" in d or "price" in d) and "volume" in d and ("time" in d or "timestamp" in d)
        elif kind == "option_contract":
            ok = any(k in d for k in ("option_symbol", "symbol")) and any(k in d for k in ("strike_price", "strike", "strikePrice"))
        elif kind == "option_snapshot":
            ok = any(k in d for k in ("option_symbol", "symbol")) and any(k in d for k in ("bid", "bid_price", "bids", "ask", "ask_price", "asks"))
        if ok:
            key = json.dumps(d, sort_keys=True, default=str)
            if key not in seen:
                seen.add(key)
                out.append(d)
    return out


def _parse_time_ms(v):
    if v in (None, ""):
        return None
    x = _f(v, None)
    if x is not None:
        if x < 10_000_000_000:
            x *= 1000
        return x
    s = str(v)
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp() * 1000
        except Exception:
            pass
    return None


def _age_seconds(d):
    ts = None
    for k in ("quote_time", "last_trade_time", "trade_time", "timestamp", "time"):
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            ts = _parse_time_ms(d.get(k))
            if ts is not None:
                break
    if ts is None:
        return 99.0
    return max(0.0, datetime.now(timezone.utc).timestamp() - ts / 1000.0)


def _bar_time(d):
    for k in ("timestamp", "time", "trade_time", "start_time"):
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            ts = _parse_time_ms(d.get(k))
            if ts is not None:
                return ts
    return 0


def _today_rth(bars):
    today = datetime.now(NY).date()
    selected = []
    for b in bars:
        ts = _bar_time(b)
        if not ts:
            continue
        dt = datetime.fromtimestamp(ts / 1000, NY)
        if dt.date() == today and ((dt.hour == 9 and dt.minute >= 30) or (10 <= dt.hour < 16)):
            selected.append(b)
    return selected or bars[-390:]


def _vwap_metrics(payload, spot):
    bars = _records(payload, "bar")
    bars.sort(key=_bar_time)
    bars = _today_rth(bars)
    if not bars:
        return spot, 0, 0.0, 0

    def calc(seq):
        pv = vv = 0.0
        for b in seq:
            c = _num(b, "close", "price")
            if c is None:
                continue
            h = _num(b, "high", default=c)
            l = _num(b, "low", default=c)
            v = _num(b, "volume", default=0.0) or 0.0
            tp = (h + l + c) / 3.0
            pv += tp * v
            vv += v
        return (pv / vv) if vv > 0 else None

    vwap = calc(bars) or spot
    old = calc(bars[:-5]) if len(bars) > 5 else calc(bars[:-1])
    if old is None:
        old = vwap
    slope = 1 if vwap - old > 0.005 else -1 if vwap - old < -0.005 else 0

    last_close = _num(bars[-1], "close", "price", default=spot) or spot
    ref = bars[-6] if len(bars) >= 6 else bars[0]
    ref_close = _num(ref, "close", "price", default=last_close) or last_close
    mom5 = ((last_close / ref_close) - 1.0) * 100.0 if ref_close else 0.0
    return vwap, slope, mom5, len(bars)


def _best_bid_ask(d):
    bid = _num(d, "bid", "bid_price", "bidPrice", "best_bid")
    ask = _num(d, "ask", "ask_price", "askPrice", "best_ask")
    if bid is None and isinstance(d, dict) and isinstance(d.get("bids"), list) and d["bids"]:
        bid = _num(d["bids"][0], "price", "bid_price")
    if ask is None and isinstance(d, dict) and isinstance(d.get("asks"), list) and d["asks"]:
        ask = _num(d["asks"][0], "price", "ask_price")
    return bid, ask


def _option_symbol(d):
    return _txt(d, "option_symbol", "symbol", "ticker", "code")


def _strike(d):
    return _num(d, "strike_price", "strike", "strikePrice")


def _norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _bs_price(side, s, k, t, r, vol):
    if t <= 0 or vol <= 0:
        return max(0.0, s-k) if side == "CALL" else max(0.0, k-s)
    rt = math.sqrt(t)
    d1 = (math.log(s/k) + (r + 0.5*vol*vol)*t) / (vol*rt)
    d2 = d1 - vol*rt
    disc = math.exp(-r*t)
    if side == "CALL":
        return s*_norm_cdf(d1) - k*disc*_norm_cdf(d2)
    return k*disc*_norm_cdf(-d2) - s*_norm_cdf(-d1)


def _iv(side, s, k, t, r, price):
    if not price or price <= 0 or t <= 0:
        return None
    intrinsic = max(0.0, s-k) if side == "CALL" else max(0.0, k-s)
    if price + 0.01 < intrinsic:
        return None
    lo, hi = 0.01, 5.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if _bs_price(side, s, k, t, r, mid) < price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _greeks(side, s, k, t, r, vol):
    if not vol or t <= 0:
        return None, None
    rt = math.sqrt(t)
    d1 = (math.log(s/k) + (r + 0.5*vol*vol)*t) / (vol*rt)
    pdf = math.exp(-0.5*d1*d1) / math.sqrt(2*math.pi)
    delta = _norm_cdf(d1) if side == "CALL" else _norm_cdf(d1) - 1
    gamma = pdf / (s*vol*rt)
    return delta, gamma


def _time_to_close():
    now = datetime.now(NY)
    close = now.replace(hour=16, minute=0, second=0, microsecond=0)
    seconds = max(60.0, (close-now).total_seconds())
    return seconds / (365.0*24.0*3600.0)



def _market_phase():
    now = datetime.now(NY)
    minute = now.hour * 60 + now.minute
    close_minute = 16 * 60
    minutes_to_close = max(0, close_minute - minute)

    if now.weekday() >= 5 or minute < 9 * 60 + 30 or minute >= 16 * 60:
        return "CLOSED", minutes_to_close
    if minute < 9 * 60 + 40:
        return "TIME_LOCK", minutes_to_close
    if minute < 12 * 60:
        return "EARLY", minutes_to_close
    if minute < 14 * 60 + 30:
        return "MID", minutes_to_close
    if minute < 15 * 60 + 30:
        return "LATE", minutes_to_close
    return "TIME_LOCK", minutes_to_close


def _delta_band(phase):
    if phase == "EARLY":
        return 0.25, 0.40
    if phase == "MID":
        return 0.30, 0.45
    if phase == "LATE":
        return 0.35, 0.50
    return None


def _delta_distance(delta, band):
    if delta is None or band is None:
        return 9.0
    x = abs(delta)
    lo, hi = band
    if lo <= x <= hi:
        return 0.0
    return min(abs(x - lo), abs(x - hi))

def _client():
    key = os.getenv("WEBULL_APP_KEY", "").strip()
    secret = os.getenv("WEBULL_APP_SECRET", "").strip()
    if not key or not secret:
        raise RuntimeError("WEBULL_APP_KEY / WEBULL_APP_SECRET が未設定です")
    env = os.getenv("WEBULL_ENVIRONMENT", "prod").strip().lower()
    endpoint = os.getenv("WEBULL_API_HOST", "").strip()
    if not endpoint:
        endpoint = "jp-openapi-alb.uat.webullbroker.com" if env == "uat" else "api.webull.co.jp"
    c = ApiClient(key, secret, "jp")
    c.add_endpoint("jp", endpoint)
    return DataClient(c), env, endpoint


def _response_json(resp):
    return resp.json()


def _snapshot(data, symbol, category):
    r = data.market_data.get_snapshot(symbol, category)
    return _find_symbol(_response_json(r), symbol)


def _option_candidate(data, side, spot, phase):
    today = datetime.now(NY).strftime("%Y-%m-%d")
    r = data.instrument.list_option_contracts(
        category=Category.US_OPTION.name,
        underlying_symbols="SPY",
        status="LISTING",
        start_date=today,
        end_date=today,
        option_type=side,
        strike_price_gte=round(max(1.0, spot-8.0), 2),
        strike_price_lte=round(spot+8.0, 2),
    )
    contracts = _records(_response_json(r), "option_contract")
    contracts = [x for x in contracts if _option_symbol(x) and _strike(x) is not None]
    contracts.sort(key=lambda x: abs((_strike(x) or spot)-spot))
    contracts = contracts[:20]
    if not contracts:
        return None

    symbols = [_option_symbol(x) for x in contracts]
    r2 = data.option_market_data.get_option_snapshot(",".join(symbols), Category.US_OPTION.name)
    snaps = _records(_response_json(r2), "option_snapshot")
    smap = {_option_symbol(x): x for x in snaps if _option_symbol(x)}

    rr = float(os.getenv("RISK_FREE_RATE", "0.04"))
    t = _time_to_close()
    band = _delta_band(phase)
    choices = []

    for c in contracts:
        sym = _option_symbol(c)
        snap = smap.get(sym, {})
        strike = _strike(c)
        bid, ask = _best_bid_ask(snap)
        if bid is None or ask is None or ask <= 0:
            continue

        mid = (bid+ask)/2
        spread_abs = ask-bid
        spread_pct = ((spread_abs)/mid*100) if mid > 0 else 999
        vol = _iv(side, spot, strike, t, rr, mid)
        delta, gamma = _greeks(side, spot, strike, t, rr, vol)
        volume = int(_num(snap, "volume", "trade_volume", default=0) or 0)
        oi = _num(snap, "open_interest", "openInterest", "oi")
        if oi is None:
            oi = _num(c, "open_interest", "openInterest", "oi")

        choices.append({
            "symbol": sym,
            "strike": strike,
            "bid": bid,
            "ask": ask,
            "mid": mid,
            "spreadAbs": spread_abs,
            "spreadPct": spread_pct,
            "delta": delta,
            "gamma": gamma,
            "iv": vol*100 if vol else None,
            "volume": volume,
            "oi": int(oi) if oi is not None else None,
            "age": _age_seconds(snap),
        })

    if not choices:
        return None

    def rank(x):
        delta_penalty = _delta_distance(x["delta"], band)
        spread_penalty = max(0.0, x["spreadPct"]-8.0)/8.0 + max(0.0, x["spreadAbs"]-0.10)/0.10
        lottery_penalty = 0.75 if x["ask"] < 0.30 else 0.0
        stale_penalty = 1.0 if x["age"] > 2.0 else 0.0
        return delta_penalty + spread_penalty + lottery_penalty + stale_penalty

    return min(choices, key=rank)


def build_snapshot():
    data, env, endpoint = _client()

    spy = _snapshot(data, "SPY", Category.US_ETF.name)
    spot = _num(spy, "price", "close", "latest_price")
    if spot is None:
        raise RuntimeError("Webull応答からSPY価格を取得できませんでした")
    open_px = _num(spy, "open", default=spot) or spot

    bars_resp = data.market_data.get_batch_history_bar(
        ["SPY"], Category.US_ETF.name, Timespan.M1.name,
        count="450", real_time_required=True, trading_sessions=["RTH"]
    )
    vwap, vwap_slope, mom5, bars_found = _vwap_metrics(_response_json(bars_resp), spot)

    # VIX spot is not listed as a supported OpenAPI market-data product.
    # Default to VIXY as an explicit proxy, never silently label it as VIX.
    proxy_symbol = os.getenv("WEBULL_VOL_PROXY_SYMBOL", "VIXY").strip().upper()
    vol = {}
    if proxy_symbol:
        vol = _snapshot(data, proxy_symbol, Category.US_ETF.name)
    vol_price = _num(vol, "price", "close", "latest_price")
    vol_change = _num(vol, "change", default=0.0) if vol_price is not None else None
    vol_label = (proxy_symbol + " proxy") if vol_price is not None else "VOL unavailable"

    bear = 0
    bull = 0
    bear += int(spot < vwap)
    bull += int(spot > vwap)
    bear += int(vwap_slope < 0)
    bull += int(vwap_slope > 0)
    bear += int(mom5 < -0.10)
    bull += int(mom5 > 0.10)
    if vol_change is not None:
        bear += int(vol_change > 0.15)
        bull += int(vol_change < -0.15)
    bear += int(spot < open_px)
    bull += int(spot > open_px)
    side = "PUT" if bear >= bull else "CALL"

    phase, minutes_to_close = _market_phase()
    opt = _option_candidate(data, side, spot, phase)

    ages = [_age_seconds(spy)]
    if vol:
        ages.append(_age_seconds(vol))
    if opt:
        ages.append(opt["age"])

    limitations = []
    if vol_price is not None:
        limitations.append("VIX spotではなく" + vol_label + "を代理使用")
    else:
        limitations.append("ボラティリティ指標を取得できません")
    if not opt:
        limitations.append("0DTEオプション候補を取得できません")

    result = {
        "ok": True,
        "liveReady": opt is not None,
        "phase": "LIVE" if opt is not None else "PARTIAL",
        "provider": "Webull OpenAPI",
        "modelVersion": "SPY_0DTE_V6.1",
        "timeBand": phase,
        "minutesToClose": minutes_to_close,
        "expiration": datetime.now(NY).strftime("%Y-%m-%d"),
        "environment": env,
        "endpoint": endpoint,
        "spy": round(spot, 4),
        "open": round(open_px, 4),
        "vwap": round(vwap, 4),
        "vwapSlope": vwap_slope,
        "mom5": round(mom5, 4),
        "vix": round(vol_price, 4) if vol_price is not None else None,
        "vixChange": round(vol_change, 4) if vol_change is not None else None,
        "volLabel": vol_label,
        "age": round(max(ages), 2) if ages else 99.0,
        "barsFound": bars_found,
        "limitations": limitations,
        "greeksSource": "Black-Scholes estimate from live bid/ask midpoint",
        "serverTime": datetime.now(timezone.utc).isoformat(),
    }
    if opt:
        result.update({
            "side": side,
            "strike": opt["strike"],
            "bid": round(opt["bid"], 4),
            "ask": round(opt["ask"], 4),
            "mid": round(opt["mid"], 4),
            "spreadAbs": round(opt["spreadAbs"], 4),
            "spreadPct": round(opt["spreadPct"], 4),
            "optionAge": round(opt["age"], 2),
            "delta": round(opt["delta"], 4) if opt["delta"] is not None else None,
            "gamma": round(opt["gamma"], 6) if opt["gamma"] is not None else None,
            "iv": round(opt["iv"], 4) if opt["iv"] is not None else None,
            "volume": opt["volume"],
            "oi": opt["oi"],
            "optionSymbol": opt["symbol"],
        })
    return result


class handler(BaseHTTPRequestHandler):
    def _origin(self):
        origin = self.headers.get("Origin", "")
        allowed = [x.strip() for x in os.getenv(
            "ALLOWED_ORIGIN", "https://yoshiharu-art.github.io"
        ).split(",") if x.strip()]
        if not origin:
            return allowed[0] if allowed else "*"
        return origin if ("*" in allowed or origin in allowed) else None

    def _send(self, status, payload):
        origin = self._origin()
        if origin is None:
            status = 403
            payload = {"ok": False, "error": "Origin not allowed"}
            origin = "null"
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        origin = self._origin()
        if origin is None:
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        try:
            self._send(200, build_snapshot())
        except Exception as e:
            self._send(500, {
                "ok": False,
                "liveReady": False,
                "phase": "ERROR",
                "error": str(e),
            })
