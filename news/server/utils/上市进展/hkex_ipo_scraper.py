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
from datetime import datetime
from typing import List, Optional

import pandas as pd
import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

# 繁体/英文均可；表格结构一致
URL_MAIN = "https://www2.hkexnews.hk/New-Listings/New-Listing-Information/Main-Board?sc_lang=zh-HK"
URL_GEM = "https://www2.hkexnews.hk/New-Listings/New-Listing-Information/GEM?sc_lang=zh-HK"
URL_SEHK_CONSOLIDATED = "https://www1.hkexnews.hk/app/documents/sehkconsolidatedindex.xlsx"
URL_GEM_CONSOLIDATED = "https://www1.hkexnews.hk/app/documents/gemconsolidatedindex.xlsx"
URL_SEHK_CONSOLIDATED_CN = "https://www1.hkexnews.hk/app/documents/sehkconsolidatedindex_c.xlsx"
URL_GEM_CONSOLIDATED_CN = "https://www1.hkexnews.hk/app/documents/gemconsolidatedindex_c.xlsx"


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


def _norm_ymd(v) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if not s:
        return ""
    s = s.replace(".", "/").replace("-", "/")
    for fmt in ("%d/%m/%Y", "%Y/%m/%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:10], fmt).strftime("%Y-%m-%d")
        except Exception:
            continue
    # 保底：如果本身就是 YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", str(v).strip()[:10]):
        return str(v).strip()[:10]
    return ""


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


def _fetch_consolidated_index(url: str, board_label: str) -> pd.DataFrame:
    """
    抓取港交所 consolidated index（首次披露索引）并映射为 hk_ipo_sync 兼容列。
    该来源可稳定补充「递交A1」口径。
    """
    try:
        raw = pd.read_excel(url)
    except Exception:
        return pd.DataFrame()

    if raw.empty:
        return pd.DataFrame()

    # 英文列名优先；中文列名在控制台可能乱码，不做强匹配，改用位置兜底
    cols = list(raw.columns)
    c_date = "Date of First Posting" if "Date of First Posting" in cols else (cols[0] if len(cols) > 0 else None)
    c_applicant = "Applicant" if "Applicant" in cols else (cols[1] if len(cols) > 1 else None)
    c_status = "Status" if "Status" in cols else (cols[2] if len(cols) > 2 else None)
    if not c_date or not c_applicant:
        return pd.DataFrame()

    out = []
    for _, row in raw.iterrows():
        d = _norm_ymd(row.get(c_date))
        company = str(row.get(c_applicant) or "").strip()
        if not d or not company:
            continue
        st_raw = str(row.get(c_status) or "").strip().lower() if c_status else ""
        status = "失效" if st_raw == "inactive" else "递交A1"
        out.append(
            {
                "申请日期": d,
                "通过聆讯日期": "",
                "上市日期": "",
                "申请状态更新日期": d,
                "申请状态": status,
                "公司全称": company,
                "股票简称": company,
                "股票代码": "",
                "板块": board_label,
                "注册地": "",
            }
        )

    return pd.DataFrame(out)


def fetch_hkex_web_combined_dataframe() -> pd.DataFrame:
    """
    组合港交所公开网页数据：
    - 新上市信息（补新上市/上市）
    - consolidated index（补递交A1/失效）
    """
    frames: List[pd.DataFrame] = []
    nli = fetch_hkex_nli_dataframe()
    if nli is not None and not nli.empty:
        frames.append(nli)

    # 优先中文索引（与页面列表显示一致），失败时回退英文索引
    sehk_idx = _fetch_consolidated_index(URL_SEHK_CONSOLIDATED_CN, "主板")
    if sehk_idx is None or sehk_idx.empty:
        sehk_idx = _fetch_consolidated_index(URL_SEHK_CONSOLIDATED, "主板")
    if sehk_idx is not None and not sehk_idx.empty:
        frames.append(sehk_idx)

    gem_idx = _fetch_consolidated_index(URL_GEM_CONSOLIDATED_CN, "GEM")
    if gem_idx is None or gem_idx.empty:
        gem_idx = _fetch_consolidated_index(URL_GEM_CONSOLIDATED, "GEM")
    if gem_idx is not None and not gem_idx.empty:
        frames.append(gem_idx)

    if not frames:
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

    df = pd.concat(frames, ignore_index=True)
    # 以「公司+申请状态+板块+申请日期」做轻量去重
    key_cols = [c for c in ["公司全称", "申请状态", "板块", "申请日期"] if c in df.columns]
    if key_cols:
        df = df.drop_duplicates(subset=key_cols, keep="first")
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
