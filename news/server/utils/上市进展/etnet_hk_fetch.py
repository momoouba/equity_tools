#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
经济通 etnet.com.hk 港股新股数据（简体站 stocks.etnetchina.cn 内嵌 iframe 同源页）：
- ci_ipo.php 内嵌 var listing.listingipos → 打新日历（招股中 / 即将上市等合并列表）
- ci_ipo_info.php 表格「新股信息」→ 一手中签率、首日开市价、按盘价、累积升跌（分页）

环境变量：
- HK_NEW_SHARE_SOURCE=etnet（默认）| hkex  —— 由 new_share_fetch 读取
- HK_NEW_SHARE_SOURCE=etnet（默认）| hkex —— 由打新日历同步读取
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
URL_IPO_CAL = "https://www.etnet.com.hk/www/sc/stocks/ci_ipo.php"
URL_IPO_INFO = "https://www.etnet.com.hk/www/sc/stocks/ci_ipo_info.php"


def _http_get(url: str, params: Optional[dict] = None) -> str:
    r = requests.get(
        url,
        params=params or {},
        timeout=45,
        headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
    )
    r.raise_for_status()
    return r.content.decode("utf-8", errors="replace")


def extract_var_listing_json(html: str) -> Optional[dict]:
    needle = "var listing = "
    pos = html.find(needle)
    if pos < 0:
        return None
    pos += len(needle)
    while pos < len(html) and html[pos].isspace():
        pos += 1
    if pos >= len(html) or html[pos] != "{":
        return None
    decoder = json.JSONDecoder()
    try:
        obj, _end = decoder.raw_decode(html, pos)
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def _norm_ymd(s: str) -> str:
    t = str(s or "").strip().replace("\\/", "/").replace("／", "/")
    if not t:
        return ""
    t = t[:10].replace(".", "/")
    try:
        return datetime.strptime(t, "%Y/%m/%d").strftime("%Y-%m-%d")
    except Exception:
        pass
    try:
        return datetime.strptime(t[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except Exception:
        return ""


def _parse_price(v: Any) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or s == "--" or s.lower() == "nan":
        return None
    try:
        return float(s)
    except Exception:
        return None


def _parse_lot_metric(v: Any) -> Optional[float]:
    """解析每手股数、顶头槌手数等整数字段（去逗号/全角逗号/「手」/空白）。"""
    if v is None:
        return None
    s = str(v).strip().replace(",", "").replace("，", "").replace("手", "").replace(" ", "")
    if not s or s == "--" or s.lower() == "nan":
        return None
    try:
        return float(s)
    except Exception:
        return None


def _parse_pct_cell(s: str) -> Optional[float]:
    t = str(s or "").strip().replace(",", "")
    if not t or t == "--":
        return None
    t = t.replace("%", "").replace("+", "")
    try:
        return float(t)
    except Exception:
        return None


def fetch_listing_ipos() -> List[dict]:
    html = _http_get(URL_IPO_CAL)
    data = extract_var_listing_json(html)
    if not data:
        raise RuntimeError("经济通 ci_ipo.php 未解析到 var listing JSON")
    raw = data.get("listingipos") or []
    return [x for x in raw if isinstance(x, dict)]


def hk_calendar_rows_from_etnet(
    start_date: str, end_date: str, issue_date_after_exclusive: Optional[str] = None
) -> List[dict]:
    """输出与 new_share_fetch._extract_hk_rows 一致结构的 dict 列表。"""
    start = start_date.strip()[:10]
    end = end_date.strip()[:10]
    after = (issue_date_after_exclusive or "").strip()[:10] or None
    ipos = fetch_listing_ipos()
    rows: List[dict] = []
    for item in ipos:
        lm = str(item.get("listmethod") or "").strip()
        if lm in ("3", "4"):
            continue
        code = str(item.get("stockcode") or "").strip().zfill(5)
        if not code or code == "00000":
            continue
        name = str(item.get("namechisc") or item.get("namechitc") or "").strip()
        if not name:
            continue
        public_date = _norm_ymd(item.get("listdate") or "")
        if not public_date:
            continue
        issue_date = _norm_ymd(item.get("applicationstart") or "")
        if not issue_date:
            issue_date = public_date
        if after:
            if issue_date <= after or issue_date > end:
                continue
        elif issue_date < start or issue_date > end:
            continue

        lp = _parse_price(item.get("listprice"))
        op_to = _parse_price(item.get("offerpriceto"))
        op_from = _parse_price(item.get("offerpricefrom"))
        issue_price = lp if lp is not None else op_to
        if issue_price is None:
            issue_price = op_from

        # 申购上限（股）= 顶头槌手数 maxlotsize × 每手股数 boardlot（原误将 boardlot 当作上限）
        shares_per_lot = _parse_lot_metric(item.get("boardlot"))
        max_lots = _parse_lot_metric(item.get("maxlotsize"))
        limit_shares = None
        if shares_per_lot is not None and max_lots is not None and shares_per_lot > 0 and max_lots > 0:
            limit_shares = shares_per_lot * max_lots

        wr = _parse_pct_cell(str(item.get("onelotsuccessrate") or ""))

        rows.append(
            {
                "stock_code": code,
                "stock_name": name,
                "issue_date": issue_date,
                "issue_weekday": None,
                "issue_price": issue_price,
                "offer_pe": None,
                "limit_shares": limit_shares,
                "exchange": "港交所",
                "public_date": public_date,
                "win_rate": wr,
            }
        )
    return rows


def _parse_ipo_info_page(html: str) -> List[dict]:
    from bs4 import BeautifulSoup  # noqa: PLC0415

    soup = BeautifulSoup(html, "html.parser")
    out: List[dict] = []
    for tr in soup.select("table.figureTable tr"):
        cls = tr.get("class") or []
        if "evenRow" not in cls and "oddRow" not in cls:
            continue
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 11:
            continue
        a0 = tds[0].find("a")
        if not a0 or not a0.get("href"):
            continue
        href = str(a0.get("href") or "")
        m = re.search(r"code=(\d+)", href, re.I)
        if not m:
            continue
        code = m.group(1).strip().zfill(5)
        name_a = tds[1].find("a")
        stock_name = (name_a.get_text() if name_a else tds[1].get_text()).strip()
        list_raw = tds[2].get_text(strip=True)
        list_date = _norm_ymd(list_raw.replace("／", "/"))
        if not list_date:
            continue

        issue_price = _parse_price(tds[4].get_text(strip=True))
        win_rate = _parse_pct_cell(tds[7].get_text(strip=True))

        fo_raw = tds[8].get_text(strip=True)
        first_open = _parse_price(fo_raw) if "延迟" not in fo_raw else None

        close_raw = tds[9].get_text(strip=True)
        close_px = _parse_price(close_raw)

        cum_raw = tds[10].get_text(strip=True)
        cum_chg = _parse_pct_cell(cum_raw)

        out.append(
            {
                "stock_code": code,
                "stock_name": stock_name,
                "list_date": list_date,
                "issue_price": issue_price,
                "win_rate": win_rate,
                "first_open": first_open,
                "close": close_px,
                "cum_chg_pct": cum_chg,
            }
        )
    return out


def fetch_ipo_info_all_pages(max_pages: int = 25) -> List[dict]:
    merged: List[dict] = []
    seen = set()
    for page in range(1, max_pages + 1):
        html = _http_get(URL_IPO_INFO, {"page": page} if page > 1 else {})
        chunk = _parse_ipo_info_page(html)
        if not chunk:
            break
        new_count = 0
        for row in chunk:
            key = (row["stock_code"], row["list_date"])
            if key in seen:
                continue
            seen.add(key)
            merged.append(row)
            new_count += 1
        if new_count == 0:
            break
    return merged


def main() -> None:
    ap = argparse.ArgumentParser(description="经济通港股新股抓取辅助")
    ap.add_argument("command", choices=["ipo-info", "calendar-json"], help="ipo-info=新股信息全表；calendar-json=打新日历行")
    ap.add_argument("--start-date", default="", help="calendar-json 用")
    ap.add_argument("--end-date", default="", help="calendar-json 用")
    ap.add_argument("--issue-date-after", default="", help="calendar-json 用")
    args = ap.parse_args()

    try:
        if args.command == "ipo-info":
            rows = fetch_ipo_info_all_pages()
            print(
                json.dumps({"ok": True, "source": "etnet.ci_ipo_info", "rowCount": len(rows), "rows": rows}, ensure_ascii=False)
            )
            return
        if args.command == "calendar-json":
            sd = args.start_date.strip()[:10]
            ed = args.end_date.strip()[:10]
            ia = args.issue_date_after.strip()[:10] or None
            if not sd or not ed:
                print(json.dumps({"ok": False, "message": "calendar-json 需要 --start-date --end-date"}, ensure_ascii=False))
                raise SystemExit(1)
            rows = hk_calendar_rows_from_etnet(sd, ed, ia)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "source": "etnet.ci_ipo_listingipos",
                        "rowCount": len(rows),
                        "rows": rows,
                    },
                    ensure_ascii=False,
                )
            )
            return
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "message": str(e)}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
