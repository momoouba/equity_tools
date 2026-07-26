#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stage 0 §4.2：探测东财/AkShare 对 A 股能否补全企业全称与统一社会信用代码。
输出 JSON 单行到 stdout，供 Node pocEastmoney500Sample.js 调用。

用法：
  python new_share_profile_probe.py --code 600519 --exchange 上交所
"""

import argparse
import json
import re
import sys

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

USCC_RE = re.compile(r"^[0-9A-Z]{18}$", re.I)


def _norm_uscc(v):
    s = str(v or "").strip().replace(" ", "").upper()
    if USCC_RE.match(s):
        return s
    return ""


def _exchange_prefix(exchange, stock_code):
    ex = str(exchange or "").strip()
    code = str(stock_code or "").strip().zfill(6)
    if "港" in ex:
        return None
    if code.startswith(("60", "68")) or "上" in ex:
        return f"SH{code}"
    if code.startswith(("00", "30")) or "深" in ex:
        return f"SZ{code}"
    if code.startswith(("8", "92", "4")) or "北" in ex:
        return f"BJ{code}"
    return f"SH{code}"


def _probe_akshare(stock_code):
    out = {"enterprise_full_name": "", "unified_credit_code": "", "source": "akshare.stock_individual_info_em"}
    try:
        import akshare as ak  # noqa: PLC0415

        code = str(stock_code or "").strip()
        if code.isdigit() and len(code) < 6:
            code = code.zfill(6)
        df = ak.stock_individual_info_em(symbol=code)
        if df is None or df.empty:
            return out
        mapping = {}
        for _, row in df.iterrows():
            cells = [str(x).strip() for x in row.tolist() if str(x).strip() and str(x).lower() != "nan"]
            if len(cells) >= 2:
                mapping[cells[0]] = cells[1]
        out["enterprise_full_name"] = (
            mapping.get("公司名称")
            or mapping.get("公司全称")
            or mapping.get("企业名称")
            or ""
        ).strip()
        out["unified_credit_code"] = _norm_uscc(
            mapping.get("统一社会信用代码") or mapping.get("社会信用代码") or mapping.get("信用代码")
        )
    except Exception as e:
        out["error"] = str(e)
    return out


def _probe_eastmoney_f10(stock_code, exchange):
    out = {
        "enterprise_full_name": "",
        "unified_credit_code": "",
        "company_intro": "",
        "product_intro": "",
        "source": "eastmoney.f10.PageAjax",
    }
    prefix = _exchange_prefix(exchange, stock_code)
    if not prefix:
        out["skipped"] = "hk_not_supported"
        return out
    url = "https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax"
    try:
        r = requests.get(url, params={"code": prefix}, timeout=25, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        data = r.json() if r.text else {}
        base_raw = (data.get("jbzl") if isinstance(data, dict) else None) or {}
        if isinstance(base_raw, list):
            base = base_raw[0] if base_raw else {}
        elif isinstance(base_raw, dict):
            base = base_raw
        else:
            base = {}
        if isinstance(base, dict):
            out["enterprise_full_name"] = str(
                base.get("ORG_NAME") or base.get("COMPANY_NAME") or base.get("gsmc") or ""
            ).strip()
            out["unified_credit_code"] = _norm_uscc(
                base.get("REG_NUM") or base.get("ORG_CODE") or base.get("SOCIAL_CREDIT_CODE") or base.get("tyshxydm")
            )
            intro = str(base.get("ORG_PROFILE") or "").strip()
            scope = str(base.get("BUSINESS_SCOPE") or "").strip()
            out["company_intro"] = intro
            out["product_intro"] = scope or intro
    except Exception as e:
        out["error"] = str(e)
    return out


def probe_profile(stock_code, exchange):
    em = _probe_eastmoney_f10(stock_code, exchange)
    ak = _probe_akshare(stock_code)
    full_name = em.get("enterprise_full_name") or ak.get("enterprise_full_name") or ""
    uscc = em.get("unified_credit_code") or ak.get("unified_credit_code") or ""
    return {
        "ok": bool(full_name or uscc),
        "stock_code": str(stock_code or "").strip(),
        "exchange": str(exchange or "").strip(),
        "enterprise_full_name": full_name,
        "unified_credit_code": uscc,
        "company_intro": em.get("company_intro") or "",
        "product_intro": em.get("product_intro") or "",
        "sources": {
            "akshare": ak,
            "eastmoney_f10": em,
        },
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--code", required=True)
    p.add_argument("--exchange", default="")
    args = p.parse_args()
    result = probe_profile(args.code, args.exchange)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
