#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stage 1b：东财 RPT_F10_BASIC_ORGINFO 批量拉取企业全称与统一社会信用代码。

用法：
  python listed_name_uscc_bulk_fetch.py
  python listed_name_uscc_bulk_fetch.py --limit=100
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

USCC_RE = re.compile(r"^[0-9A-Z]{18}$", re.I)
EM_ORGINFO_URL = "https://datacenter.eastmoney.com/securities/api/data/v1/get"


def _norm_uscc(v):
    s = str(v or "").strip().replace(" ", "").upper()
    if USCC_RE.match(s):
        return s
    return ""


def fetch_org_name_uscc_bulk(page_size=5000, sleep_sec=0.25):
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    page_number = 1
    total_count = None
    by_code = {}
    while True:
        params = {
            "reportName": "RPT_F10_BASIC_ORGINFO",
            "columns": "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_NAME,REG_NUM",
            "pageNumber": page_number,
            "pageSize": page_size,
            "source": "HSF10",
            "client": "PC",
        }
        resp = session.get(EM_ORGINFO_URL, params=params, timeout=60)
        resp.raise_for_status()
        payload = resp.json() if resp.text else {}
        if not payload.get("success"):
            raise RuntimeError(f"ORG bulk failed page={page_number}: {payload.get('message')}")
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
            org_name = str(row.get("ORG_NAME") or "").strip()
            uscc = _norm_uscc(row.get("REG_NUM"))
            by_code[code] = {
                "stock_code": code,
                "secucode": str(row.get("SECUCODE") or "").strip(),
                "stock_name": str(row.get("SECURITY_NAME_ABBR") or "").strip(),
                "enterprise_full_name": org_name,
                "unified_credit_code": uscc,
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
    p.add_argument("--limit", type=int, default=0, help="仅输出前 N 条（调试用）")
    args = p.parse_args()

    os.environ["TQDM_DISABLE"] = "1"
    by_code = fetch_org_name_uscc_bulk()
    rows = list(by_code.values())
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]

    with_name = sum(1 for r in rows if r.get("enterprise_full_name"))
    with_uscc = sum(1 for r in rows if r.get("unified_credit_code"))

    out = {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stats": {
            "bulk_total": len(rows),
            "with_name": with_name,
            "with_uscc": with_uscc,
            "with_either": sum(
                1 for r in rows if r.get("enterprise_full_name") or r.get("unified_credit_code")
            ),
        },
        "rows": rows,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
