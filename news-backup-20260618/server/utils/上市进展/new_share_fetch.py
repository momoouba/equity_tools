#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
打新日历抓取：
- A 股：AkShare ak.stock_xgsglb_em()
- 港股：默认经济通 etnet.com.hk ci_ipo.php（var listing.listingipos）；可设 HK_NEW_SHARE_SOURCE=hkex 回退港交所静态表
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
import requests

# 港股公司名繁简转换（与 zhconvUtils.js 共享映射表）
try:
    from zh_t2s import load_t2s_mapping, to_simplified as _to_simplified
    load_t2s_mapping()
except ImportError:
    def _to_simplified(text):
        return text

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def _to_date_text(v):
    if v is None:
        return ""
    s = str(v).strip()
    if not s or s.lower() == "nan":
        return ""
    s = s.replace("/", "-").replace(".", "-")
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
    if not s or s.lower() in ("nan", "none", "-"):
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


def _pick(row, candidates):
    for c in candidates:
        if c in row:
            return row.get(c)
    return None


def _extract_rows(df, start_date, end_date, issue_date_after_exclusive=None):
    rows = []
    start = start_date
    end = end_date
    after = (issue_date_after_exclusive or "").strip()[:10] or None
    for _, r in df.iterrows():
        d = r.to_dict()
        issue_date = _to_date_text(_pick(d, ["申购日期", "网上发行日期", "发行日期"]))
        if not issue_date:
            continue
        if after:
            if issue_date <= after or issue_date > end:
                continue
        elif issue_date < start or issue_date > end:
            continue
        stock_code = str(_pick(d, ["股票代码", "证券代码", "代码"]) or "").strip()
        stock_name = str(_pick(d, ["股票简称", "证券简称", "名称"]) or "").strip()
        if not stock_code or not stock_name:
            continue
        if stock_code.startswith(("00", "30")):
            exchange = "深交所"
        elif stock_code.startswith(("60", "68")):
            exchange = "上交所"
        elif stock_code.startswith(("8", "92")):
            exchange = "北交所"
        else:
            exchange = "上交所"

        rows.append(
            {
                "stock_code": stock_code,
                "stock_name": stock_name,
                "issue_date": issue_date,
                "issue_weekday": str(_pick(d, ["申购日期星期几", "星期"]) or "").strip() or None,
                "issue_price": _to_float(_pick(d, ["发行价格", "发行价"])),
                "offer_pe": _to_float(_pick(d, ["发行市盈率", "市盈率"])),
                "limit_shares": _to_float(_pick(d, ["申购上限", "网上申购上限"])),
                "total_issued_shares": _to_share_count(_pick(d, ["发行总数", "发行总股数", "总发行数量", "实际发行总数"])),
                "exchange": exchange,
                "public_date": _to_date_text(_pick(d, ["上市日期"])),
                "win_rate": _to_float(_pick(d, ["中签率"])),
            }
        )
    return rows


def _extract_a_rows_from_ipoapply(
    start_date,
    end_date,
    issue_date_after_exclusive=None,
    update_date_after_exclusive=None,
    listing_date_lookback_days=0,
):
    after = (issue_date_after_exclusive or "").strip()[:10] or None
    updated_after = (update_date_after_exclusive or "").strip()[:10] or None
    listing_lookback = max(0, int(listing_date_lookback_days or 0))
    listing_after_inclusive = None
    if after and listing_lookback > 0:
        try:
            aft_dt = datetime.strptime(after, "%Y-%m-%d")
            listing_after_inclusive = (aft_dt - timedelta(days=listing_lookback)).strftime("%Y-%m-%d")
        except Exception:
            listing_after_inclusive = None
    url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    params = {
        "sortColumns": "APPLY_DATE,SECURITY_CODE",
        "sortTypes": "-1,-1",
        "pageSize": "5000",
        "pageNumber": "1",
        "reportName": "RPTA_APP_IPOAPPLY",
        "columns": (
            "SECURITY_CODE,SECURITY_NAME,APPLY_DATE,LISTING_DATE,ISSUE_PRICE,AFTER_ISSUE_PE,"
            "ONLINE_APPLY_UPPER,ONLINE_ISSUE_LWR,TOTAL_ISSUE_NUM,ISSUE_NUM,MARKET_TYPE_NEW,UP_DATE"
        ),
    }
    r = requests.get(url, params=params, timeout=45, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    payload = r.json()
    data = ((payload or {}).get("result") or {}).get("data") or []
    rows = []
    for d in data:
        market = str(d.get("MARKET_TYPE_NEW") or "").strip()
        if market == "港交所":
            continue
        issue_date = _to_date_text(d.get("APPLY_DATE"))
        listing_date = _to_date_text(d.get("LISTING_DATE"))
        update_date = _to_date_text(d.get("UP_DATE"))
        if after:
            issue_ok = bool(issue_date and issue_date > after and issue_date <= end_date)
            # UP_DATE 回看使用含当日口径，避免同日补齐上市日期时漏抓
            update_ok = bool(updated_after and update_date and update_date >= updated_after and update_date <= end_date)
            # 兜底：部分 A 股行 UP_DATE 为空，但 LISTING_DATE 已补齐（如 920191），允许按上市日期回看窗口纳入
            listing_ok = bool(
                listing_after_inclusive
                and listing_date
                and listing_date >= listing_after_inclusive
                and listing_date <= end_date
            )
            if not (issue_ok or update_ok or listing_ok):
                continue
        else:
            if not issue_date:
                continue
            if issue_date < start_date or issue_date > end_date:
                continue
        stock_code = str(d.get("SECURITY_CODE") or "").strip().zfill(6)
        if not stock_code:
            continue
        stock_name = str(d.get("SECURITY_NAME") or "").strip()
        if not stock_name:
            continue
        if "北交" in market:
            exchange = "北交所"
        elif "深" in market or "创业" in market:
            exchange = "深交所"
        else:
            exchange = "上交所"
        total_issued_shares = _to_share_count(d.get("TOTAL_ISSUE_NUM"))
        if total_issued_shares is None:
            issue_num = _to_share_count(d.get("ISSUE_NUM"))
            if issue_num is not None:
                total_issued_shares = issue_num * 10000
        wr = _to_float(d.get("ONLINE_ISSUE_LWR"))
        if wr is not None and wr <= 1:
            wr = wr * 100
        rows.append(
            {
                "stock_code": stock_code,
                "stock_name": stock_name,
                "issue_date": issue_date,
                "issue_weekday": None,
                "issue_price": _to_float(d.get("ISSUE_PRICE")),
                "offer_pe": _to_float(d.get("AFTER_ISSUE_PE")),
                "limit_shares": _to_float(d.get("ONLINE_APPLY_UPPER")),
                "total_issued_shares": total_issued_shares,
                "exchange": exchange,
                "public_date": _to_date_text(d.get("LISTING_DATE")),
                "win_rate": wr,
            }
        )
    return rows, len(data)


def _extract_hk_rows(df, start_date, end_date, issue_date_after_exclusive=None):
    rows = []
    after = (issue_date_after_exclusive or "").strip()[:10] or None
    for _, r in df.iterrows():
        d = r.to_dict()
        activity = str(d.get("申请状态") or "").strip()
        if activity and "新上市" not in activity:
            continue
        code = str(d.get("股票代码") or "").strip()
        if not code:
            continue
        code = code.zfill(5)
        name = str(d.get("股票简称") or d.get("公司全称") or "").strip()
        if not name:
            continue
        name = _to_simplified(name)
        public_date = _to_date_text(d.get("上市日期"))
        if not public_date:
            continue
        issue_date = _to_date_text(d.get("招股日期") or d.get("申请日期") or "")
        if not issue_date:
            issue_date = public_date
        if after:
            if issue_date <= after or issue_date > end_date:
                continue
        elif issue_date < start_date or issue_date > end_date:
            continue
        rows.append(
            {
                "stock_code": code,
                "stock_name": name,
                "issue_date": issue_date,
                "issue_weekday": None,
                "issue_price": None,
                "offer_pe": None,
                "limit_shares": None,
                "total_issued_shares": None,
                "exchange": "港交所",
                "public_date": public_date,
                "win_rate": None,
            }
        )
    return rows


def _is_nonempty_field(v):
    if v is None:
        return False
    if isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return not (isinstance(v, float) and str(v) == "nan")
    if isinstance(v, str):
        return v.strip() != ""
    return bool(v)


def _merge_ipo_row_pair(a, b):
    """同一 (stock_code, exchange) 多行合并：字段取有值的一方；两边都有时保留先出现的 a。"""
    keys = set(a) | set(b)
    out = {}
    for k in keys:
        va, vb = a.get(k), b.get(k)
        a_ok, b_ok = _is_nonempty_field(va), _is_nonempty_field(vb)
        if a_ok and b_ok:
            out[k] = va
        elif a_ok:
            out[k] = va
        elif b_ok:
            out[k] = vb
        else:
            out[k] = va if va is not None else vb
    return out


def _dedupe_merge_ipo_rows(rows):
    """东方财富等接口可能对同一证券返回多行：合并后再给 Node，避免第二条被误判为无变化或空字段覆盖。"""
    from collections import OrderedDict

    od = OrderedDict()
    for r in rows:
        code = str(r.get("stock_code") or "").strip()
        ex = str(r.get("exchange") or "").strip()
        if not code:
            continue
        key = (code, ex)
        if key not in od:
            od[key] = r
        else:
            od[key] = _merge_ipo_row_pair(od[key], r)
    return list(od.values())


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--start-date", required=True)
    p.add_argument("--end-date", required=True)
    p.add_argument("--hk-recent-days", type=int, default=0)
    p.add_argument(
        "--issue-date-after",
        default="",
        help="若传入 YYYY-MM-DD，则仅保留申购/上市日期 **>** 该日且 ≤ end-date 的行（与闭区间二选一）",
    )
    p.add_argument(
        "--update-date-after",
        default="",
        help="可选：按东财 UP_DATE 回看更新，若传入 YYYY-MM-DD，则保留 UP_DATE > 该日 且 ≤ end-date 的行（A股）",
    )
    p.add_argument(
        "--listing-date-lookback-days",
        type=int,
        default=0,
        help="可选：issue-date-after 模式下，按 LISTING_DATE 向前回看 N 天兜底纳入（用于 UP_DATE 为空场景）",
    )
    args = p.parse_args()

    start_date = args.start_date.strip()[:10]
    end_date = args.end_date.strip()[:10]
    issue_after = (args.issue_date_after or "").strip()[:10] or None
    update_after = (args.update_date_after or "").strip()[:10] or None
    listing_lookback_days = max(0, int(args.listing_date_lookback_days or 0))

    a_source = "eastmoney.datacenter.RPTA_APP_IPOAPPLY"
    a_source_rows = 0
    try:
        a_rows, a_source_rows = _extract_a_rows_from_ipoapply(
            start_date, end_date, issue_after, update_after, listing_lookback_days
        )
    except Exception:
        import akshare as ak  # noqa: PLC0415

        df = ak.stock_xgsglb_em()
        a_rows = _extract_rows(df, start_date, end_date, issue_after)
        a_source = "akshare.stock_xgsglb_em"
        a_source_rows = int(len(df.index))

    hk_start = start_date
    hk_end = end_date
    if not issue_after and args.hk_recent_days and args.hk_recent_days > 0:
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        start_dt = end_dt - timedelta(days=max(1, int(args.hk_recent_days)) - 1)
        hk_start = start_dt.strftime("%Y-%m-%d")

    hk_src = (os.environ.get("HK_NEW_SHARE_SOURCE") or "etnet").strip().lower()
    if hk_src in ("hkex", "hkex-web", "legacy"):
        from hkex_ipo_scraper import fetch_hkex_nli_dataframe  # noqa: PLC0415

        hk_df = fetch_hkex_nli_dataframe()
        hk_rows = _extract_hk_rows(hk_df, hk_start, hk_end, issue_after)
        hk_meta = f"hkex rows={len(hk_df.index)}"
    else:
        from etnet_hk_fetch import hk_calendar_rows_from_etnet  # noqa: PLC0415

        hk_rows = hk_calendar_rows_from_etnet(hk_start, hk_end, issue_after)
        hk_meta = f"etnet listingipos built={len(hk_rows)}"

    rows = _dedupe_merge_ipo_rows(a_rows + hk_rows)
    raw_concat_len = len(a_rows) + len(hk_rows)
    print(
        json.dumps(
            {
                "ok": True,
                "source": f"{a_source} + {hk_src}({hk_meta})",
                "sourceRows": int(a_source_rows) + int(len(hk_rows)),
                "rawBuiltRows": raw_concat_len,
                "builtRows": len(rows),
                "rows": rows,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()

