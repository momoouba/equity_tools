#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stage 1d：东财 RPT_F10_BASIC_ORGINFO 批量拉取企业介绍与经营范围/主营业务。

用法：
  python listed_profile_intro_bulk_fetch.py
  python listed_profile_intro_bulk_fetch.py --limit=100
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

EM_ORGINFO_URL = "https://datacenter.eastmoney.com/securities/api/data/v1/get"
MIN_INTRO_LEN = 20


def _clean_text(v, max_len=0):
    s = str(v or "").strip()
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    while "\n\n\n" in s:
        s = s.replace("\n\n\n", "\n\n")
    if max_len and len(s) > max_len:
        s = s[:max_len].rstrip()
    return s


def _pick_product_intro(main_business, business_scope, company_intro):
    for candidate in (main_business, business_scope, company_intro):
        s = _clean_text(candidate)
        if len(s) >= MIN_INTRO_LEN:
            return s
    return ""


def fetch_profile_intro_bulk(page_size=5000, sleep_sec=0.25):
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    page_number = 1
    total_count = None
    by_code = {}
    while True:
        params = {
            "reportName": "RPT_F10_BASIC_ORGINFO",
            "columns": "SECURITY_CODE,ORG_PROFILE,MAIN_BUSINESS,BUSINESS_SCOPE",
            "pageNumber": page_number,
            "pageSize": page_size,
            "source": "HSF10",
            "client": "PC",
        }
        resp = session.get(EM_ORGINFO_URL, params=params, timeout=60)
        resp.raise_for_status()
        payload = resp.json() if resp.text else {}
        if not payload.get("success"):
            raise RuntimeError(f"intro bulk failed page={page_number}: {payload.get('message')}")
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
            company_intro = _clean_text(row.get("ORG_PROFILE"), 12000)
            main_business = _clean_text(row.get("MAIN_BUSINESS"), 8000)
            business_scope = _clean_text(row.get("BUSINESS_SCOPE"), 8000)
            product_intro = _pick_product_intro(main_business, business_scope, company_intro)
            by_code[code] = {
                "stock_code": code,
                "company_intro": company_intro,
                "product_intro": product_intro,
                "main_business": main_business,
                "business_scope": business_scope,
            }
        if len(data) < page_size:
            break
        page_number += 1
        if total_count and (page_number - 1) * page_size >= total_count:
            break
        time.sleep(sleep_sec)
    return by_code


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0)
    args = p.parse_args()

    os.environ["TQDM_DISABLE"] = "1"
    by_code = fetch_profile_intro_bulk()
    rows = list(by_code.values())
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]

    with_company = sum(1 for r in rows if len(r.get("company_intro") or "") >= MIN_INTRO_LEN)
    with_product = sum(1 for r in rows if len(r.get("product_intro") or "") >= MIN_INTRO_LEN)

    out = {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stats": {
            "bulk_total": len(rows),
            "with_company_intro": with_company,
            "with_product_intro": with_product,
        },
        "rows": rows,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
