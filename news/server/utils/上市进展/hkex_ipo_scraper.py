# -*- coding: utf-8 -*-
"""
港交所官网公开页面抓取（requests + BeautifulSoup + pandas），用于构造与 hk_ipo_sync 一致的宽表。

说明（重要）：
- 「处理中申请」全量明细（递表/聆讯/失效的完整时间线）港交所**未**提供单一 JSON 接口；
  进度报告页 https://www2.hkexnews.hk/New-Listings/Progress-Report-for-New-Listing-Applications/
  主要是**汇总统计**，不含公司级逐行表。
- 「新上市信息」页（Main Board / GEM）有**静态 HTML 表格**，列含证券代码、名称，以及「新上市公告」等 PDF 链接；
  链接 URL 路径中常含日期段，例如 .../sehk/2026/0320/... → 可解析为上市相关日期 2026-03-20。
- 同一行内「新上市公告 / 招股章程 / 股份配發結果」等多列 PDF 的路径日期可能不同；本模块取**各 PDF 路径日期的最大值**
  写入「上市日期」与「申请状态更新日期」，以便较晚发布的文件（如配發結果）能落入用户选择的同步区间。
- **申请/聆讯**等字段仍留空；若路径日期均早于区间，则仍不会生成待写行（与沪深北「更新日落在区间内」一致）。

若需递表/聆讯级数据，需：手工导出 CSV、或对接商业数据、或对披露搜索（JSF 表单）用 Playwright 自动化。
"""

from __future__ import annotations

import re
from typing import List, Optional

import pandas as pd
import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

# 繁体/英文均可；表格结构一致
URL_MAIN = "https://www2.hkexnews.hk/New-Listings/New-Listing-Information/Main-Board?sc_lang=zh-HK"
URL_GEM = "https://www2.hkexnews.hk/New-Listings/New-Listing-Information/GEM?sc_lang=zh-HK"


def _date_from_hkexnews_pdf_url(url: str) -> str:
    """从 hkexnews PDF 路径解析日期：/sehk/YYYY/MMDD/ 或文件名 YYYYMMDD。"""
    if not url:
        return ""
    m = re.search(r"/sehk/(\d{4})/(\d{4})/", url)
    if m:
        y, mmdd = m.groups()
        return f"{y}-{mmdd[:2]}-{mmdd[2:]}"
    m2 = re.search(r"/(\d{8})\d+\.pdf", url, re.I)
    if m2:
        s = m2.group(1)
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return ""


def _max_date_from_pdf_urls(urls: List[str]) -> str:
    """同一行内多份 PDF（新上市公告/招股章程/配發結果）取路径日期最大值，作为与同步区间对齐的「最近文件日」。"""
    dates: List[str] = []
    for u in urls:
        d = _date_from_hkexnews_pdf_url(u)
        if d:
            dates.append(d)
    if not dates:
        return ""
    return max(dates)


def _fetch_table(url: str) -> str:
    r = requests.get(url, timeout=45, headers={"User-Agent": UA, "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8"})
    r.raise_for_status()
    return r.text


def _parse_nli_html(html: str, board_label: str) -> List[dict]:
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table")
    if not table:
        return []

    rows_out: List[dict] = []
    tbody = table.find("tbody") or table
    for tr in tbody.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 3:
            continue
        code = tds[0].get_text(" ", strip=True)
        name_el = tds[1]
        company = name_el.get_text(" ", strip=True) if name_el else ""
        if not code and not company:
            continue

        # GEM/主板无数据时表格仍可能有一行提示语，勿当有效公司
        if company and (
            "沒有相關資料" in company
            or "没有相关资料" in company
            or "No relevant information" in company
            or company.strip() in ("-", "—")
        ):
            continue

        # 第 3 列起：新上市公告、招股章程、股份配發結果等，可能含不同日期的 PDF；取最大日期以对齐「区间内更新」
        pdf_urls: List[str] = []
        for td in tds[2:]:
            for a in td.find_all("a", href=True):
                h = (a.get("href") or "").strip()
                if h and ".pdf" in h.lower():
                    pdf_urls.append(h)

        list_date = _max_date_from_pdf_urls(pdf_urls)

        rows_out.append(
            {
                "申请日期": "",
                "通过聆讯日期": "",
                "上市日期": list_date,
                "申请状态更新日期": list_date,
                "申请状态": "新上市",
                "公司全称": company or "",
                "股票简称": (company.split()[0] if company else "") or "",
                "股票代码": code,
                "板块": board_label,
                "注册地": "",
            }
        )
    return rows_out


def fetch_hkex_nli_dataframe() -> pd.DataFrame:
    """抓取主板 + GEM「新上市信息」表，合并为 DataFrame（列名与 hk_ipo_sync 筛选逻辑一致）。"""
    parts: List[dict] = []
    for url, board in [(URL_MAIN, "主板"), (URL_GEM, "GEM")]:
        html = _fetch_table(url)
        parts.extend(_parse_nli_html(html, board))

    if not parts:
        return pd.DataFrame(
            columns=[
                "申请日期",
                "通过聆讯日期",
                "上市日期",
                "申请状态更新日期",
                "申请状态",
                "公司全称",
                "股票简称",
                "股票代码",
                "板块",
                "注册地",
            ]
        )
    df = pd.DataFrame(parts)
    if len(df) > 1 and "股票代码" in df.columns:
        df = df.drop_duplicates(subset=["股票代码"], keep="first")
    return df


def fetch_hkex_progress_report_stats() -> Optional[pd.DataFrame]:
    """抓取「新上市申请进度报告」页中的统计表（仅数字汇总，非公司明细）。可选用于核对。"""
    url = "https://www2.hkexnews.hk/New-Listings/Progress-Report-for-New-Listing-Applications/Main-Board?sc_lang=en&p=1"
    html = _fetch_table(url)
    from io import StringIO

    try:
        dfs = pd.read_html(StringIO(html))
    except Exception:
        return None
    if not dfs:
        return None
    return dfs[0]
