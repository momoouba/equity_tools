#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
经济通 etnet.com.hk 港股新股数据（简体站 stocks.etnetchina.cn 内嵌 iframe 同源页）：
- ci_ipo.php 内嵌 var listing.listingipos → 仅少量「预告」新股；打新日历须与 ci_ipo_info 新股信息全表合并，否则会漏掉已上市但未进 listingipos 的股票
- ci_ipo_info.php 表格「新股信息」→ 打新日历主列表 + 一手中签率、首日开市价、按盘价、累积升跌（分页）
- ci_ipo_detail.php?code=XXXXX&type=listing → 「全球发售」区块「发售股份数目」（万股），补全 issue_total_wan / expected_raise_amount

环境变量：
- HK_NEW_SHARE_SOURCE=etnet（默认）| hkex  —— 由 new_share_fetch 读取
- HK_IPO_DETAIL_INTERVAL_MS — 详情页逐股请求间隔（默认 150ms）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
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
URL_IPO_DETAIL = "https://www.etnet.com.hk/www/sc/stocks/ci_ipo_detail.php"


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


def _norm_table_label(s: str) -> str:
    return re.sub(r"\s+", "", str(s or ""))


def _parse_share_volume_to_wan(s: str) -> Optional[float]:
    """解析详情页发售规模：「9,469.05万股」「1,283.87万 H股」「8.12亿 H股」等 → 万股。"""
    t = str(s or "").strip().replace(",", "").replace("，", "")
    if not t or t in ("--", "-"):
        return None
    m_yi = re.match(r"^([\d.]+)\s*亿\s*(?:H\s*股|h\s*股|股)?\s*$", t, flags=re.I)
    if m_yi:
        try:
            v = float(m_yi.group(1))
            # 1 亿股 = 10,000 万股
            return round(v * 10000, 2) if v > 0 else None
        except Exception:
            return None
    t_wan = re.sub(r"万\s*(?:股|H\s*股|h\s*股)?\s*$", "", t, flags=re.I).strip()
    if not t_wan:
        return None
    try:
        v = float(t_wan)
        return round(v, 2) if v > 0 else None
    except Exception:
        return None


def _parse_wan_shares_text(s: str) -> Optional[float]:
    """兼容旧名：解析为万股。"""
    return _parse_share_volume_to_wan(s)


def _calc_expected_raise_amount_yi(issue_price: Any, issue_total_wan: Any) -> Optional[float]:
    price = _parse_price(issue_price)
    wan: Optional[float] = None
    if issue_total_wan is not None:
        if isinstance(issue_total_wan, (int, float)):
            wan = float(issue_total_wan) if float(issue_total_wan) > 0 else None
        else:
            wan = _parse_wan_shares_text(str(issue_total_wan))
    if price is None or wan is None or price <= 0 or wan <= 0:
        return None
    return round(price * wan / 10000, 2)


def _hk_share_fields_from_wan(issue_price: Any, issue_total_wan: float) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "issue_total_wan": round(issue_total_wan, 2),
        "total_issued_shares": round(issue_total_wan * 10000, 2),
    }
    era = _calc_expected_raise_amount_yi(issue_price, issue_total_wan)
    if era is not None:
        out["expected_raise_amount"] = era
    return out


_ISSUE_TOTAL_DETAIL_LABELS = (
    "发售股份数目",
    "發售股份數目",
    "发售预托证券数目",
    "發售預託證券數目",
)


def parse_ipo_detail_issue_total_wan(html: str) -> Optional[float]:
    """从 ci_ipo_detail.php HTML 解析全球发售合计股数（统一为万股）。"""
    from bs4 import BeautifulSoup  # noqa: PLC0415

    soup = BeautifulSoup(html, "html.parser")
    for tr in soup.select("table tr"):
        cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        if len(cells) < 2:
            continue
        label = _norm_table_label(cells[0])
        if label not in _ISSUE_TOTAL_DETAIL_LABELS:
            continue
        wan = _parse_share_volume_to_wan(cells[1])
        if wan is not None:
            return wan
    return None


def fetch_ipo_detail_issue_total_wan(stock_code: str) -> Optional[float]:
    code = str(stock_code or "").strip().zfill(5)
    if not code or code == "00000":
        return None
    html = _http_get(URL_IPO_DETAIL, {"code": code, "type": "listing"})
    return parse_ipo_detail_issue_total_wan(html)


def _enrich_hk_rows_with_detail_shares(rows: List[dict]) -> None:
    """对港交所打新日历行逐只补抓 ci_ipo_detail「发售股份数目」。"""
    cache: Dict[str, Optional[float]] = {}
    interval_ms = max(0, int(os.environ.get("HK_IPO_DETAIL_INTERVAL_MS", "150") or "150"))
    interval_s = interval_ms / 1000.0
    fetched = 0
    for i, row in enumerate(rows):
        if str(row.get("exchange") or "").strip() != "港交所":
            continue
        code = str(row.get("stock_code") or "").strip().zfill(5)
        if not code or code == "00000":
            continue
        if code not in cache:
            if fetched > 0 and interval_s > 0:
                time.sleep(interval_s)
            try:
                cache[code] = fetch_ipo_detail_issue_total_wan(code)
            except Exception:
                cache[code] = None
            fetched += 1
        wan = cache.get(code)
        if wan is None:
            continue
        row.update(_hk_share_fields_from_wan(row.get("issue_price"), wan))


def fetch_listing_ipos() -> List[dict]:
    html = _http_get(URL_IPO_CAL)
    data = extract_var_listing_json(html)
    if not data:
        raise RuntimeError("经济通 ci_ipo.php 未解析到 var listing JSON")
    raw = data.get("listingipos") or []
    return [x for x in raw if isinstance(x, dict)]


def _hk_listing_in_window(public_date: str, start: str, end: str, after: Optional[str]) -> bool:
    """港股增量/区间均以上市日 listdate 为准（与上市进展定时任务注释一致）。"""
    if not public_date:
        return False
    if after:
        return public_date > after and public_date <= end
    return start <= public_date <= end


def _listingipo_meta_by_code(ipos: List[dict]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for item in ipos:
        c = str(item.get("stockcode") or "").strip().zfill(5)
        if c and c != "00000":
            out[c] = item
    return out


def _calendar_row_from_listing_item(item: dict) -> Optional[dict]:
    lm = str(item.get("listmethod") or "").strip()
    if lm in ("3", "4"):
        return None
    code = str(item.get("stockcode") or "").strip().zfill(5)
    if not code or code == "00000":
        return None
    name = str(item.get("namechisc") or item.get("namechitc") or "").strip()
    if not name:
        return None
    public_date = _norm_ymd(item.get("listdate") or "")
    if not public_date:
        return None
    issue_date = _norm_ymd(item.get("applicationstart") or "")
    if not issue_date:
        issue_date = public_date

    lp = _parse_price(item.get("listprice"))
    op_to = _parse_price(item.get("offerpriceto"))
    op_from = _parse_price(item.get("offerpricefrom"))
    issue_price = lp if lp is not None else op_to
    if issue_price is None:
        issue_price = op_from

    shares_per_lot = _parse_lot_metric(item.get("boardlot"))
    max_lots = _parse_lot_metric(item.get("maxlotsize"))
    limit_shares = None
    if shares_per_lot is not None and max_lots is not None and shares_per_lot > 0 and max_lots > 0:
        limit_shares = shares_per_lot * max_lots

    wr = _parse_pct_cell(str(item.get("onelotsuccessrate") or ""))

    return {
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


def _calendar_row_from_ipo_info(ir: dict, meta: Optional[dict]) -> Optional[dict]:
    """ci_ipo_info 表行 + 可选 listingipos 同源字段合并。"""
    code = str(ir.get("stock_code") or "").strip().zfill(5)
    public_date = str(ir.get("list_date") or "").strip()[:10]
    if not code or code == "00000" or not public_date:
        return None

    if meta:
        lm = str(meta.get("listmethod") or "").strip()
        if lm in ("3", "4"):
            meta = None

    if meta:
        issue_date = _norm_ymd(meta.get("applicationstart") or "")
        if not issue_date:
            issue_date = public_date
        lp = _parse_price(meta.get("listprice"))
        op_to = _parse_price(meta.get("offerpriceto"))
        op_from = _parse_price(meta.get("offerpricefrom"))
        issue_price = lp if lp is not None else op_to
        if issue_price is None:
            issue_price = op_from
        if issue_price is None:
            issue_price = ir.get("issue_price")

        shares_per_lot = _parse_lot_metric(meta.get("boardlot"))
        max_lots = _parse_lot_metric(meta.get("maxlotsize"))
        limit_shares = None
        if shares_per_lot is not None and max_lots is not None and shares_per_lot > 0 and max_lots > 0:
            limit_shares = shares_per_lot * max_lots

        wr = _parse_pct_cell(str(meta.get("onelotsuccessrate") or ""))
        if wr is None:
            wr = ir.get("win_rate")

        name = str(meta.get("namechisc") or meta.get("namechitc") or "").strip() or str(ir.get("stock_name") or "").strip()
    else:
        issue_date = public_date
        issue_price = ir.get("issue_price")
        limit_shares = None
        wr = ir.get("win_rate")
        name = str(ir.get("stock_name") or "").strip()

    if not name:
        return None

    return {
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


def hk_calendar_rows_from_etnet(
    start_date: str, end_date: str, issue_date_after_exclusive: Optional[str] = None
) -> List[dict]:
    """输出与 new_share_fetch._extract_hk_rows 一致结构的 dict 列表。

    listingipos（ci_ipo.php）通常只有少量「预告」新股；完整列表以 ci_ipo_info.php 分页表为准，
    二者合并并按上市日做区间/增量筛选，避免仅依赖 listingipos 漏抓当日已上市新股。
    """
    start = start_date.strip()[:10]
    end = end_date.strip()[:10]
    after = (issue_date_after_exclusive or "").strip()[:10] or None
    ipos = fetch_listing_ipos()
    meta_by_code = _listingipo_meta_by_code(ipos)

    rows: List[dict] = []
    covered: set[str] = set()

    for ir in fetch_ipo_info_all_pages():
        public_date = str(ir.get("list_date") or "").strip()[:10]
        if not _hk_listing_in_window(public_date, start, end, after):
            continue
        code = str(ir.get("stock_code") or "").strip().zfill(5)
        meta = meta_by_code.get(code)
        built = _calendar_row_from_ipo_info(ir, meta)
        if not built:
            continue
        rows.append(built)
        covered.add(code)

    for item in ipos:
        row = _calendar_row_from_listing_item(item)
        if not row:
            continue
        code = row["stock_code"]
        if code in covered:
            continue
        public_date = row["public_date"]
        if not _hk_listing_in_window(public_date, start, end, after):
            continue
        rows.append(row)

    _enrich_hk_rows_with_detail_shares(rows)
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
    ap.add_argument(
        "command",
        choices=["ipo-info", "calendar-json", "ipo-detail"],
        help="ipo-info=新股信息全表；calendar-json=打新日历行；ipo-detail=单股详情发售股份数目",
    )
    ap.add_argument("--start-date", default="", help="calendar-json 用")
    ap.add_argument("--end-date", default="", help="calendar-json 用")
    ap.add_argument("--issue-date-after", default="", help="calendar-json 用")
    ap.add_argument("--code", default="", help="ipo-detail 用，5位股票代码")
    args = ap.parse_args()

    try:
        if args.command == "ipo-detail":
            code = str(args.code or "").strip().zfill(5)
            if not code:
                print(json.dumps({"ok": False, "message": "ipo-detail 需要 --code"}, ensure_ascii=False))
                raise SystemExit(1)
            wan = fetch_ipo_detail_issue_total_wan(code)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "source": "etnet.ci_ipo_detail",
                        "stockCode": code,
                        "issueTotalWan": wan,
                    },
                    ensure_ascii=False,
                )
            )
            return
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
