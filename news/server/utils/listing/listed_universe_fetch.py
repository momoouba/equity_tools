#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stage 1a：拉取 A 股现行上市池 + 东财申万行业（EM2016）批量数据。

用法：
  python listed_universe_fetch.py
  python listed_universe_fetch.py --limit=100
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DOMESTIC_EXCHANGES = {"上交所", "深交所", "北交所"}
EM_ORGINFO_URL = "https://datacenter.eastmoney.com/securities/api/data/v1/get"
UNIVERSE_PLACEHOLDER_ISSUE_DATE = "1900-01-01"


def _to_date_text(v):
    if v is None:
        return ""
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "-", "--"):
        return ""
    s = s.replace("/", "-").replace(".", "-")[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%Y-%m-%d")
    except Exception:
        return ""


def exchange_from_code(stock_code):
    code = str(stock_code or "").strip()
    if code.isdigit() and len(code) < 6:
        code = code.zfill(6)
    if code.startswith(("60", "68")):
        return "上交所"
    if code.startswith(("00", "30")):
        return "深交所"
    if code.startswith(("8", "92", "43", "4")):
        return "北交所"
    return ""


def secucode_from_code(stock_code, exchange=None):
    code = str(stock_code or "").strip()
    if code.isdigit() and len(code) < 6:
        code = code.zfill(6)
    ex = exchange or exchange_from_code(code)
    if ex == "上交所":
        return f"{code}.SH"
    if ex == "深交所":
        return f"{code}.SZ"
    if ex == "北交所":
        return f"{code}.BJ"
    return ""


def parse_em2016(em2016):
    raw = str(em2016 or "").strip()
    if not raw or raw in ("-", "--"):
        return "", "", ""
    parts = [p.strip() for p in raw.split("-") if p.strip()]
    l1 = parts[0] if len(parts) > 0 else ""
    l2 = parts[1] if len(parts) > 1 else ""
    l3 = parts[2] if len(parts) > 2 else ""
    return l1, l2, l3


def fetch_current_universe():
    os.environ.setdefault("AKSHARE_TIMEOUT", "60")
    import akshare as ak  # noqa: PLC0415

    df = ak.stock_info_a_code_name()
    rows = []
    seen = set()
    for _, r in df.iterrows():
        code = str(r.get("code") or "").strip()
        name = str(r.get("name") or "").strip()
        if not code or not name:
            continue
        if code.isdigit() and len(code) < 6:
            code = code.zfill(6)
        exchange = exchange_from_code(code)
        if exchange not in DOMESTIC_EXCHANGES:
            continue
        key = (code, exchange)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "stock_code": code,
                "stock_name": name,
                "exchange": exchange,
                "secucode": secucode_from_code(code, exchange),
            }
        )
    return rows


def fetch_em2016_bulk(page_size=5000, sleep_sec=0.25):
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    page_number = 1
    total_count = None
    by_code = {}
    while True:
        params = {
            "reportName": "RPT_F10_BASIC_ORGINFO",
            "columns": "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,EM2016,LISTING_DATE",
            "pageNumber": page_number,
            "pageSize": page_size,
            "source": "HSF10",
            "client": "PC",
        }
        resp = session.get(EM_ORGINFO_URL, params=params, timeout=60)
        resp.raise_for_status()
        payload = resp.json() if resp.text else {}
        if not payload.get("success"):
            raise RuntimeError(f"EM2016 bulk failed page={page_number}: {payload.get('message')}")
        result = payload.get("result") or {}
        if total_count is None:
            total_count = int(result.get("count") or 0)
        data = result.get("data") or []
        if not data:
            break
        for row in data:
            code = str(row.get("SECURITY_CODE") or "").strip()
            if code.isdigit() and len(code) < 6:
                code = code.zfill(6)
            if not code:
                continue
            em2016 = str(row.get("EM2016") or "").strip()
            l1, l2, l3 = parse_em2016(em2016)
            listing_date = _to_date_text(row.get("LISTING_DATE"))
            by_code[code] = {
                "stock_code": code,
                "secucode": str(row.get("SECUCODE") or "").strip(),
                "stock_name": str(row.get("SECURITY_NAME_ABBR") or "").strip(),
                "em2016": em2016,
                "sw_industry_l1": l1,
                "sw_industry_l2": l2,
                "sw_industry_l3": l3,
                "listing_date": listing_date,
            }
        if len(data) < page_size:
            break
        page_number += 1
        if total_count and (page_number - 1) * page_size >= total_count:
            break
        time.sleep(sleep_sec)
    return by_code


def merge_universe_with_sw(universe_rows, sw_by_code):
    merged = []
    stats = {
        "universe_total": len(universe_rows),
        "sw_hit": 0,
        "sw_miss": 0,
        "by_exchange": {},
    }
    for u in universe_rows:
        code = u["stock_code"]
        exchange = u["exchange"]
        sw = sw_by_code.get(code) or {}
        l1 = sw.get("sw_industry_l1") or ""
        l2 = sw.get("sw_industry_l2") or ""
        if l1:
            stats["sw_hit"] += 1
        else:
            stats["sw_miss"] += 1
        ex_stat = stats["by_exchange"].setdefault(exchange, {"total": 0, "sw_hit": 0})
        ex_stat["total"] += 1
        if l1:
            ex_stat["sw_hit"] += 1
        listing_date = sw.get("listing_date") or ""
        issue_date = listing_date or UNIVERSE_PLACEHOLDER_ISSUE_DATE
        merged.append(
            {
                "stock_code": code,
                "stock_name": u.get("stock_name") or sw.get("stock_name") or "",
                "exchange": exchange,
                "secucode": u.get("secucode") or sw.get("secucode") or "",
                "sw_industry_l1": l1,
                "sw_industry_l2": l2,
                "em2016": sw.get("em2016") or "",
                "listing_date": listing_date,
                "issue_date": issue_date,
                "public_date": listing_date or None,
                "profile_source": "eastmoney_sw" if l1 else None,
            }
        )
    return merged, stats


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0, help="仅输出前 N 条（调试用）")
    args = p.parse_args()

    os.environ["TQDM_DISABLE"] = "1"

    universe = fetch_current_universe()
    sw_by_code = fetch_em2016_bulk()
    merged, stats = merge_universe_with_sw(universe, sw_by_code)
    if args.limit and args.limit > 0:
        merged = merged[: args.limit]

    out = {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stats": stats,
        "rows": merged,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
