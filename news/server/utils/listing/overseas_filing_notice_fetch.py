#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
证监会政府信息公开 · 境外证券发行列表：备案通知书 → 详情页 HTML 解析。
输出 JSON（末行）：{ ok, source, rows }，rows 字段与 Node overseasFilingService 合并入库兼容。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta
from urllib.parse import urljoin

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_pw_utils = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _pw_utils not in sys.path:
    sys.path.insert(0, _pw_utils)
from playwright_host import ensure_playwright_browser_path  # noqa: E402

# 默认：需求文档 14.5 列表入口
DEFAULT_NOTICE_LIST_URL = (
    "http://www.csrc.gov.cn/csrc/c101935/zfxxgk_zdgk.shtml"
    "?channelid=8f3f0d4be56b4f8aa8183b3234b88ede"
)


def _import_bs(html: str):
    from bs4 import BeautifulSoup  # noqa: PLC0415

    return BeautifulSoup(html, "lxml")


def _norm_date_dispatch(s: str) -> str:
    """列表/详情「发文日期」→ YYYY-MM-DD。"""
    if not s:
        return ""
    s = str(s).strip().replace("\u00a0", " ")
    m = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(y, mo, d).strftime("%Y-%m-%d")
        except ValueError:
            pass
    s = s.replace("/", "-").replace(".", "-")
    if "T" in s:
        s = s.split("T", 1)[0].strip()
    if len(s) >= 10 and re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return ""


def _map_exchange_segment(seg: str) -> str:
    """正文「并在××上市」段 → 产品简称。"""
    t = (seg or "").strip()
    if not t:
        return ""
    rules = [
        (r"纳斯达克|NASDAQ", "纳斯达克"),
        (r"纽约证券交易所|纽约证交所|纽交所|NYSE", "纽交所"),
        (r"新加坡交易所|新交所|SGX", "新交所"),
        (r"香港联合交易所|港交所|香港交易所|联交所", "香港联交所"),
        (r"伦敦证券交易所|伦交所", "伦交所"),
        (r"法兰克福", "法兰克福交易所"),
    ]
    for pat, name in rules:
        if re.search(pat, t, re.I):
            return name
    # 兜底：取段内「交易所」前短语
    m = re.search(r"([\u4e00-\u9fffA-Za-z·]+(?:交易所|证交所))", t)
    if m:
        return m.group(1)[:100]
    return t[:100]


def _extract_company_from_title(title: str) -> str:
    m = re.search(r"关于\s*(.+?)\s*境外发行上市备案通知书", title)
    if m:
        return m.group(1).strip()
    m = re.search(r"关于\s*(.+?)\s*境外发行.*备案通知书", title)
    if m:
        return m.group(1).strip()
    return ""


def _parse_detail_html(html: str, detail_url: str) -> dict:
    soup = _import_bs(html)
    text = soup.get_text("\n", strip=True)
    flat_text = re.sub(r"\s+", " ", text).strip()
    doc_no = ""
    m = re.search(r"文号\s*[:：]\s*([^\s\n]+)", text)
    if m:
        doc_no = m.group(1).strip()
    if not doc_no:
        m = re.search(r"(国合函\s*〔\s*\d{4}\s*〕\s*\d+\s*号)", text)
        if m:
            doc_no = re.sub(r"\s+", "", m.group(1))

    dispatch = ""
    m = re.search(r"发文日期\s*[:：]\s*([^\n\r]+)", text)
    if m:
        dispatch = _norm_date_dispatch(m.group(1))

    title_el = soup.find("meta", attrs={"name": "ArticleTitle"})
    meta_title = (title_el.get("content") or "").strip() if title_el else ""
    h = soup.find(["h1", "h2", "h3"]) or soup.select_one(".content .title, .article-title")
    dom_title = (h.get_text(strip=True) if h else "") or ""
    title = meta_title or dom_title

    company = _extract_company_from_title(title)
    if not company:
        m = re.search(r"([\u4e00-\u9fff（）()·\dA-Za-z]+(?:股份有限公司|有限公司|集团|控股))\s*[:：]", text)
        if m:
            company = m.group(1).strip()

    exchange_raw = ""
    # 证监会正文常换行，先在扁平化文本中提取「一、...并在...上市」
    m = re.search(r"一[、,，].{0,400}?并在\s*([^。；;，,\n\r]+?)\s*上市", flat_text)
    if m:
        exchange_raw = m.group(1).strip()
    if not exchange_raw:
        # 兜底：全篇搜索最近一次「并在...上市」
        m2 = re.search(r"并在\s*([^。；;，,\n\r]+?)\s*上市", flat_text)
        if m2:
            exchange_raw = m2.group(1).strip()
    ex = _map_exchange_segment(exchange_raw)

    return {
        "doc_number": doc_no[:200],
        "dispatch_date": dispatch,
        "company_name": company[:500] if company else "",
        "target_exchange": ex[:100] if ex else "",
        "title": title[:500] if title else "",
        "detail_url": detail_url,
    }


def _overseas_playwright_launch_kwargs(headless: bool):
    kwargs = {"headless": headless}
    for key in ("OVERSEAS_FILING_PLAYWRIGHT_EXECUTABLE", "CSRC_GUIDANCE_PLAYWRIGHT_EXECUTABLE"):
        exe = str(os.environ.get(key, "")).strip()
        if exe and os.path.isfile(exe):
            kwargs["executable_path"] = exe
            break
    return kwargs


def _playwright_proxy_from_env():
    u = (os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY") or "").strip()
    if not u:
        return None
    return {"server": u}


def _list_row_cells(tr) -> list[str]:
    tds = tr.locator("td")
    n = tds.count()
    out = []
    for i in range(n):
        try:
            out.append((tds.nth(i).inner_text() or "").strip().replace("\u00a0", " "))
        except Exception:
            out.append("")
    return out


def fetch_notice_rows(start_date: str, end_date: str, list_url: str) -> list[dict]:
    try:
        from playwright.sync_api import sync_playwright  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError(
            "未安装 playwright，请执行: pip install playwright && playwright install chromium"
        ) from e

    timeout_ms = int(os.environ.get("OVERSEAS_FILING_NOTICE_PW_TIMEOUT_MS", "120000"))
    headless = os.environ.get("OVERSEAS_FILING_PW_HEADLESS", "1").strip().lower() not in ("0", "false", "no")
    max_pages = int(os.environ.get("OVERSEAS_FILING_NOTICE_MAX_PAGES", "200"))
    detail_delay_ms = int(os.environ.get("OVERSEAS_FILING_NOTICE_DETAIL_DELAY_MS", "400"))

    ensure_playwright_browser_path()
    ua = os.environ.get(
        "CSRC_HTTP_USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    )
    launch_kw = dict(_overseas_playwright_launch_kwargs(headless))
    px = _playwright_proxy_from_env()
    if px:
        launch_kw["proxy"] = px

    candidates: list[dict] = []
    out_rows: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kw)
        try:
            context = browser.new_context(locale="zh-CN", user_agent=ua, ignore_https_errors=True)
            page = context.new_page()
            page.set_default_timeout(timeout_ms)
            page.goto(list_url.strip(), wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(1200)

            for page_idx in range(max_pages):
                rows = page.locator("table tbody tr")
                n = rows.count()
                for i in range(n):
                    tr = rows.nth(i)
                    cells = _list_row_cells(tr)
                    if len(cells) < 2:
                        continue
                    if cells[0] == "序号" or "序号" in cells[0]:
                        continue
                    link = tr.locator("a").first
                    href = ""
                    if link.count():
                        try:
                            href = (link.get_attribute("href") or "").strip()
                        except Exception:
                            href = ""
                    title_txt = ""
                    if link.count():
                        try:
                            title_txt = (link.inner_text() or "").strip()
                        except Exception:
                            title_txt = ""
                    if not title_txt:
                        title_txt = " ".join(cells[1:3]) if len(cells) > 2 else cells[0]

                    if "备案通知书" not in title_txt:
                        continue

                    dispatch = ""
                    doc_no = ""
                    for cell in cells:
                        d0 = _norm_date_dispatch(cell)
                        if d0:
                            dispatch = d0
                        if re.search(r"国合函|〔\d{4}〕\s*\d+\s*号", cell.replace(" ", "")):
                            doc_no = cell.strip()
                    if not dispatch:
                        dispatch = _norm_date_dispatch(title_txt)

                    if dispatch and (dispatch < start_date or dispatch > end_date):
                        continue
                    if not href or href.lower().startswith("javascript"):
                        continue

                    abs_url = urljoin(page.url, href)
                    candidates.append(
                        {
                            "title": title_txt[:800],
                            "list_href": abs_url,
                            "list_dispatch": dispatch,
                            "list_doc_no": doc_no,
                        }
                    )

                next_btn = page.locator("a:has-text('下一页'), a:has-text('下页'), .next a").first
                has_next = False
                if next_btn.count():
                    try:
                        cls = (next_btn.get_attribute("class") or "").lower()
                        if "disabled" not in cls:
                            has_next = True
                    except Exception:
                        has_next = True
                if not has_next:
                    break
                try:
                    next_btn.click(timeout=15000)
                    page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
                    page.wait_for_timeout(800)
                except Exception:
                    break

            seen = set()
            for c in candidates:
                key = (c["list_href"], c.get("list_dispatch") or "")
                if key in seen:
                    continue
                seen.add(key)

                try:
                    page.goto(c["list_href"], wait_until="domcontentloaded", timeout=timeout_ms)
                    page.wait_for_timeout(detail_delay_ms)
                    html = page.content()
                except Exception as ex:
                    out_rows.append(
                        {
                            "error": str(ex)[:500],
                            "detail_url": c["list_href"],
                            "company_name": _extract_company_from_title(c.get("title") or ""),
                            "receive_date": c.get("list_dispatch") or "",
                            "filing_type": (c.get("list_doc_no") or "")[:200],
                            "filing_entity": "",
                            "target_exchange": "",
                            "filing_status": "备案完成",
                            "row_kind": "filing_notice",
                        }
                    )
                    continue

                parsed = _parse_detail_html(html, c["list_href"])
                receive = parsed.get("dispatch_date") or c.get("list_dispatch") or ""
                if receive and (receive < start_date or receive > end_date):
                    continue

                company = parsed.get("company_name") or _extract_company_from_title(c.get("title") or "")
                doc = parsed.get("doc_number") or c.get("list_doc_no") or ""
                ex = parsed.get("target_exchange") or ""

                out_rows.append(
                    {
                        "company_name": company,
                        "receive_date": receive,
                        "filing_type": doc[:200] if doc else "",
                        "filing_entity": company,
                        "target_exchange": ex,
                        "filing_status": "备案完成",
                        "detail_url": c["list_href"],
                        "row_kind": "filing_notice",
                    }
                )

        finally:
            browser.close()

    return out_rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--start-date", required=True)
    p.add_argument("--end-date", required=True)
    p.add_argument(
        "--list-url",
        default=os.environ.get("OVERSEAS_FILING_NOTICE_LIST_URL", DEFAULT_NOTICE_LIST_URL).strip(),
    )
    args = p.parse_args()
    start_date = args.start_date.strip()[:10]
    end_date = args.end_date.strip()[:10]
    list_url = (args.list_url or DEFAULT_NOTICE_LIST_URL).strip()

    rows = fetch_notice_rows(start_date, end_date, list_url)
    print(
        json.dumps(
            {
                "ok": True,
                "source": "notice_list_html",
                "sourceRows": len(rows),
                "builtRows": len(rows),
                "rows": rows,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
