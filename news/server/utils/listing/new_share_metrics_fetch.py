#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import random
import sys
import time
import traceback
from datetime import datetime, timedelta

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _to_date(v):
    s = str(v or "").strip().replace("/", "-").replace(".", "-")
    if len(s) >= 10:
        s = s[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%Y-%m-%d")
    except Exception:
        return ""


def _to_float(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "").replace("，", "")
    if not s or s.lower() in ("nan", "none", "-", "--"):
        return None
    try:
        return float(s)
    except Exception:
        return None


def _to_share_count(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "").replace("，", "").replace(" ", "")
    if not s or s.lower() in ("nan", "none", "-", "--"):
        return None
    s = s.replace("股", "")
    try:
        if s.endswith("亿"):
            return float(s[:-1]) * 1e8
        if s.endswith("万"):
            return float(s[:-1]) * 1e4
        return float(s)
    except Exception:
        return None


def _fetch_total_shares_a(ak, stock_code):
    attempts = max(1, min(10, int(os.environ.get("NEW_SHARE_METRICS_AK_ATTEMPTS", "6"))))
    for i in range(attempts):
        try:
            df = ak.stock_individual_info_em(symbol=str(stock_code).strip())
            if df is None or len(df) == 0:
                return None
            for _, row in df.iterrows():
                label = str(row.get("item") or row.get("名称") or "").strip()
                if not label:
                    continue
                if "总股本" in label and "流通" not in label:
                    n = _to_share_count(row.get("value"))
                    if n and n > 0:
                        return n
            return None
        except Exception:
            if i >= attempts - 1:
                break
            time.sleep(min(18.0, 0.8 * (2**i)) + random.uniform(0.2, 1.1))
    return None


def _fetch_hist_first_row_with_retry(ak, stock_code, market, start_date, end_date):
    stock_code_norm = str(stock_code or "").strip()
    attempts = max(1, min(10, int(os.environ.get("NEW_SHARE_METRICS_AK_ATTEMPTS", "6"))))
    last_err = None
    for i in range(attempts):
        try:
            if market == "hk":
                sym = stock_code.zfill(5)
                try:
                    return ak.stock_hk_hist(
                        symbol=sym, period="daily", start_date=start_date, end_date=end_date, adjust=""
                    )
                except TypeError:
                    return ak.stock_hk_hist(symbol=sym, period="daily", start_date=start_date, end_date=end_date)
            for sym in _a_code_candidates(stock_code_norm):
                try:
                    return ak.stock_zh_a_hist(
                        symbol=sym,
                        period="daily",
                        start_date=start_date,
                        end_date=end_date,
                        adjust="",
                        timeout=45,
                    )
                except TypeError:
                    return ak.stock_zh_a_hist(symbol=sym, period="daily", start_date=start_date, end_date=end_date, adjust="")
                except Exception:
                    continue
            raise RuntimeError(f"akshare a-share hist unavailable: {stock_code_norm}")
        except Exception as e:
            last_err = e
            if i >= attempts - 1:
                break
            time.sleep(min(20.0, 1.1 * (2**i)) + random.uniform(0.2, 1.3))
    if last_err:
        raise last_err
    return None


def _a_code_candidates(stock_code):
    raw = str(stock_code or "").strip()
    if not raw:
        return []
    cands = [raw]
    if raw.isdigit():
        cands.append(raw.zfill(6))
        if len(raw) == 5 and raw.startswith(("8", "9", "4")):
            cands.append(raw[:2] + "0" + raw[2:])
    uniq = []
    for c in cands:
        if c and c not in uniq:
            uniq.append(c)
    return uniq


def _eastmoney_secids(stock_code, market):
    code = str(stock_code or "").strip()
    if market == "hk":
        return [f"116.{code.zfill(5)}"]
    secids = []
    for cand in _a_code_candidates(code):
        if cand.startswith("6"):
            secids.append(f"1.{cand.zfill(6)}")
        else:
            secids.append(f"0.{cand.zfill(6)}")
    return list(dict.fromkeys(secids))


def _fetch_first_row_eastmoney(stock_code, market, start_date, end_date):
    urls = [
        "https://push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://6.push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://13.push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://19.push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://26.push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://39.push2his.eastmoney.com/api/qt/stock/kline/get",
    ]
    base_params = {
        "klt": "101",
        "fqt": "0",
        "beg": start_date,
        "end": end_date,
        "ut": "fa5fd1943c7b386f172d6893dbfba10b",
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    }
    attempts = max(1, min(10, int(os.environ.get("NEW_SHARE_METRICS_EM_ATTEMPTS", "6"))))
    last_err = None
    for secid in _eastmoney_secids(stock_code, market):
        for url in urls:
            for i in range(attempts):
                try:
                    params = dict(base_params)
                    params["secid"] = secid
                    session = requests.Session()
                    retry = Retry(
                        total=2,
                        connect=2,
                        read=2,
                        status=2,
                        backoff_factor=0.6,
                        status_forcelist=(429, 500, 502, 503, 504),
                        allowed_methods=frozenset(["GET"]),
                        raise_on_status=False,
                    )
                    adapter = HTTPAdapter(max_retries=retry)
                    session.mount("http://", adapter)
                    session.mount("https://", adapter)
                    resp = session.get(
                        url,
                        params=params,
                        timeout=20,
                        headers={
                            "User-Agent": (
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
                            ),
                            "Referer": "https://quote.eastmoney.com/",
                            "Connection": "close",
                            "Accept": "application/json,text/plain,*/*",
                        },
                    )
                    resp.raise_for_status()
                    payload = resp.json()
                    klines = ((payload or {}).get("data") or {}).get("klines") or []
                    rows = []
                    for item in klines:
                        parts = str(item or "").split(",")
                        if len(parts) < 9:
                            continue
                        rows.append(
                            {
                                "日期": parts[0],
                                "收盘": parts[2],
                                "涨跌幅": parts[8],
                            }
                        )
                    if rows:
                        return rows
                    break
                except Exception as e:
                    last_err = e
                    if i >= attempts - 1:
                        break
                    time.sleep(min(16.0, 0.9 * (2**i)) + random.uniform(0.2, 1.0))
    if last_err:
        raise last_err
    return None


def _fetch_ipoapply_row_from_datacenter(stock_code):
    code = str(stock_code or "").strip()
    cands = [code]
    if code.isdigit():
        cands.append(code.zfill(6))
    cands = [x for i, x in enumerate(cands) if x and x not in cands[:i]]
    url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    params = {
        "sortColumns": "APPLY_DATE,SECURITY_CODE",
        "sortTypes": "-1,-1",
        "pageSize": "50",
        "pageNumber": "1",
        "reportName": "RPTA_APP_IPOAPPLY",
        "filter": f"(SECURITY_CODE='{cands[-1]}')",
        "columns": (
            "SECURITY_CODE,SECURITY_NAME,LISTING_DATE,ISSUE_PRICE,ISSUE_NUM,TOTAL_ISSUE_NUM,"
            "ONLINE_ISSUE_LWR,CLOSE_PRICE,LD_CLOSE_CHANGE,MARKET_TYPE_NEW"
        ),
    }
    r = requests.get(url, params=params, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    payload = r.json()
    rows = ((payload or {}).get("result") or {}).get("data") or []
    if not rows:
        # Fallback: broad query in case upstream filter grammar changes.
        params.pop("filter", None)
        params["pageSize"] = "5000"
        r = requests.get(url, params=params, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        payload = r.json()
        rows = ((payload or {}).get("result") or {}).get("data") or []
    for row in rows:
        sec = str(row.get("SECURITY_CODE") or "").strip()
        if sec in cands:
            return row
    return None


def _fetch_metrics_from_ipoapply(stock_code, list_date):
    row = _fetch_ipoapply_row_from_datacenter(stock_code)
    if not row:
        return None
    ld = _to_date(row.get("LISTING_DATE"))
    if not ld or ld < list_date:
        return None
    close = _to_float(row.get("CLOSE_PRICE"))
    chg_pct = _to_float(row.get("LD_CLOSE_CHANGE"))
    total_shares = _to_share_count(row.get("TOTAL_ISSUE_NUM"))
    if total_shares is None:
        total_shares = _to_share_count(row.get("ISSUE_NUM"))
        if total_shares is not None:
            total_shares = total_shares * 10000
    win_rate = _to_float(row.get("ONLINE_ISSUE_LWR"))
    if win_rate is not None and win_rate <= 1:
        win_rate = win_rate * 100
    return {
        "source": "eastmoney.datacenter.RPTA_APP_IPOAPPLY",
        "firstRow": {"trade_date": ld, "close": close, "chg_pct": chg_pct},
        "totalShares": total_shares,
        "winRate": win_rate,
        "issuePrice": _to_float(row.get("ISSUE_PRICE")),
    }


def _fetch_hk_metrics_from_etnet(stock_code, list_date):
    try:
        from etnet_hk_fetch import fetch_ipo_info_all_pages  # noqa: PLC0415
    except Exception:
        return None
    rows = fetch_ipo_info_all_pages(max_pages=35)
    code = str(stock_code or "").strip().zfill(5)
    for row in rows:
        if str(row.get("stock_code") or "").strip().zfill(5) != code:
            continue
        ld = _to_date(row.get("list_date"))
        if not ld or ld < list_date:
            continue
        return {
            "source": "etnet.ci_ipo_info",
            "firstRow": {"trade_date": ld, "close": _to_float(row.get("close")), "chg_pct": _to_float(row.get("cum_chg_pct"))},
            "totalShares": None,
            "winRate": _to_float(row.get("win_rate")),
            "issuePrice": _to_float(row.get("issue_price")),
        }
    return None


def _first_row_complete(row):
    if not isinstance(row, dict):
        return False
    close = _to_float(row.get("close"))
    chg = _to_float(row.get("chg_pct"))
    return close is not None and chg is not None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--stock-code", required=True)
    p.add_argument("--list-date", required=True)
    p.add_argument("--market", default="a")
    args = p.parse_args()

    stock_code = str(args.stock_code or "").strip()
    list_date = str(args.list_date or "").strip()[:10]
    market = str(args.market or "a").strip().lower()

    try:
        dt = datetime.strptime(list_date, "%Y-%m-%d")
        start_date = dt.strftime("%Y%m%d")
        end_date = (dt + timedelta(days=20)).strftime("%Y%m%d")
    except Exception:
        print(json.dumps({"ok": False, "error": "invalid list-date"}, ensure_ascii=False))
        raise SystemExit(1)

    try:
        if market != "hk":
            source = "eastmoney.datacenter.RPTA_APP_IPOAPPLY"
            extra = _fetch_metrics_from_ipoapply(stock_code, list_date)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "source": source,
                        "stockCode": stock_code,
                        "listDate": list_date,
                        "firstRow": (extra or {}).get("firstRow"),
                        "totalShares": (extra or {}).get("totalShares"),
                        "winRate": (extra or {}).get("winRate"),
                        "issuePrice": (extra or {}).get("issuePrice"),
                    },
                    ensure_ascii=False,
                )
            )
            return

        skip_etnet = str(os.environ.get("NEW_SHARE_METRICS_HK_SKIP_ETNET", "") or "").strip() == "1"
        extra_et = None if skip_etnet else _fetch_hk_metrics_from_etnet(stock_code, list_date)
        if extra_et and _first_row_complete(extra_et.get("firstRow") or {}):
            print(
                json.dumps(
                    {
                        "ok": True,
                        "source": extra_et.get("source") or "etnet.ci_ipo_info",
                        "stockCode": stock_code,
                        "listDate": list_date,
                        "firstRow": extra_et.get("firstRow"),
                        "totalShares": extra_et.get("totalShares"),
                        "winRate": extra_et.get("winRate"),
                        "issuePrice": extra_et.get("issuePrice"),
                    },
                    ensure_ascii=False,
                )
            )
            return

        import akshare as ak  # noqa: PLC0415

        source = "akshare.hist"
        try:
            df = _fetch_hist_first_row_with_retry(ak, stock_code, market, start_date, end_date)
        except Exception:
            source = "eastmoney.push2his"
            try:
                df = _fetch_first_row_eastmoney(stock_code, market, start_date, end_date)
            except Exception:
                df = None
        total_shares = None

        first = None
        if df is not None:
            iter_rows = df.iterrows() if hasattr(df, "iterrows") else enumerate(df)
            for _, r in iter_rows:
                d = r.to_dict() if hasattr(r, "to_dict") else (r if isinstance(r, dict) else {})
                td = _to_date(d.get("日期"))
                if not td or td < list_date:
                    continue
                first = {
                    "trade_date": td,
                    "close": _to_float(d.get("收盘")),
                    "chg_pct": _to_float(d.get("涨跌幅")),
                }
                break

        win_rate = None
        issue_price = None
        if first is None or not _first_row_complete(first):
            extra = _fetch_metrics_from_ipoapply(stock_code, list_date)
            if extra:
                source = extra.get("source") or source
                extra_first = extra.get("firstRow")
                if first is None or _first_row_complete(extra_first):
                    first = extra_first
                if total_shares is None:
                    total_shares = extra.get("totalShares")
                win_rate = extra.get("winRate")
                issue_price = extra.get("issuePrice")

        print(
            json.dumps(
                {
                    "ok": True,
                    "source": source,
                    "stockCode": stock_code,
                    "listDate": list_date,
                    "firstRow": first,
                    "totalShares": total_shares,
                    "winRate": win_rate,
                    "issuePrice": issue_price,
                },
                ensure_ascii=False,
            )
        )
    except Exception as e:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(e),
                    "errorDetail": traceback.format_exc()[:4000],
                },
                ensure_ascii=False,
            )
        )
        raise SystemExit(1)


if __name__ == "__main__":
    main()

