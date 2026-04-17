#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
境外备案表：支持
- 直连 .xlsx/.xls/.csv（pandas 直接读 URL）；
- 证监会政府信息公开门户页（HTML）：先尝试 overseas_filing_discover.getSearch 解析 Excel 直链；
  失败或返回非 Excel 时，用 Playwright 模拟搜索 → 首条 → 详情页 → 拉取 .xlsx 再解析。
"""

import argparse
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta
from urllib.parse import urljoin, urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _norm_date(v):
    """支持 YYYY-MM-DD、2026年4月1日、Excel 序列日、datetime/Timestamp。"""
    if v is None:
        return ""
    try:
        import pandas as pd  # noqa: PLC0415

        if isinstance(v, pd.Timestamp):
            if pd.isna(v):
                return ""
            return v.strftime("%Y-%m-%d")
    except Exception:
        pass
    if hasattr(v, "strftime"):
        try:
            return v.strftime("%Y-%m-%d")
        except Exception:
            pass
    s = str(v).strip()
    if not s or s.lower() in ("nan", "nat", "none"):
        return ""
    # Excel 序列日期（纯数字）
    try:
        fv = float(s.replace(",", ""))
        if 20000 < fv < 800000:
            base = datetime(1899, 12, 30)
            d0 = base + timedelta(days=int(fv))
            return d0.strftime("%Y-%m-%d")
    except (ValueError, OverflowError, OSError):
        pass
    s = s.replace("/", "-").replace(".", "-")
    if "T" in s:
        s = s.split("T", 1)[0].strip()
    if " " in s and re.match(r"^\d{4}-\d{1,2}-\d{1,2}", s):
        s = s.split(" ", 1)[0].strip()
    s = s.replace("年", "-").replace("月", "-").replace("日", "")
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, da = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(y, mo, da).strftime("%Y-%m-%d")
        except ValueError:
            pass
    if len(s) >= 10:
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""


def _pick(d, names):
    for n in names:
        if n in d:
            return d.get(n)
    for n in names:
        for k in d:
            ks = str(k).strip()
            if n in ks:
                return d.get(k)
    return None


def _flatten_column_name(c):
    if isinstance(c, tuple):
        parts = [
            str(p).strip()
            for p in c
            if p is not None and str(p).strip() not in ("", "nan", "NaN")
        ]
        if not parts:
            return ""
        return parts[0] if len(parts) == 1 else "_".join(parts)
    return str(c).strip()


def _dedupe_column_names(names):
    seen = {}
    out = []
    for n in names:
        base = (n or "").strip() or "列"
        if base in seen:
            seen[base] += 1
            out.append(f"{base}.{seen[base]}")
        else:
            seen[base] = 0
            out.append(base)
    return out


def _strip_non_data_rows(df):
    """去掉表尾说明、表头重复行等。"""
    import pandas as pd  # noqa: PLC0415

    if df is None or len(df) == 0:
        return df
    company_col = None
    for c in df.columns:
        if "企业名称" in str(c):
            company_col = c
            break
    if company_col is None:
        return df
    kept = []
    for _, r in df.iterrows():
        name = str(r.get(company_col, "") or "").strip()
        if not name:
            continue
        if name == "企业名称":
            continue
        if "备案情况表" in name and "截至" in name:
            continue
        if len(name) > 120 and ("情况表" in name or "首次公开发行" in name):
            continue
        kept.append(r)
    if not kept:
        return df
    return pd.DataFrame(kept).reset_index(drop=True)


def _raw_sheet_to_dataframe(raw):
    """证监会模板：前几行为标题；表头两行（含「中介机构」合并下挂保荐人/境内律师）。"""
    import pandas as pd  # noqa: PLC0415

    if raw is None or raw.shape[0] == 0:
        return raw
    header_idx = None
    for i in range(min(35, len(raw))):
        cells = []
        for j in range(raw.shape[1]):
            v = raw.iloc[i, j]
            if pd.notna(v):
                cells.append(str(v).strip())
        line = " ".join(cells)
        if "企业名称" in line and ("序号" in line or "接收日期" in line or "申报类型" in line):
            header_idx = i
            break
    if header_idx is None:
        out = raw.copy()
        out.columns = [f"col{j}" for j in range(out.shape[1])]
        return out

    nrow = raw.iloc[header_idx]
    use_sub = False
    if header_idx + 1 < len(raw):
        subcells = []
        for j in range(raw.shape[1]):
            v = raw.iloc[header_idx + 1, j]
            if pd.notna(v):
                subcells.append(str(v).strip())
        subline = " ".join(subcells)
        if any(k in subline for k in ("保荐", "主承销", "境内律师", "承销")):
            use_sub = True

    subrow = raw.iloc[header_idx + 1] if use_sub else None
    names = []
    for j in range(raw.shape[1]):
        t = str(nrow.iloc[j]).strip() if pd.notna(nrow.iloc[j]) else ""
        b = str(subrow.iloc[j]).strip() if subrow is not None and pd.notna(subrow.iloc[j]) else ""
        if use_sub and t and ("中介" in t):
            names.append(b if b else t)
        elif use_sub and (not t or t in ("nan", "NaN")):
            names.append(b if b else f"col{j}")
        elif use_sub and b and t in ("序号", "企业名称", "申报类型", "申报主体", "拟上市证券交易所", "接收日期", "备案状态", "备注"):
            names.append(t)
        else:
            names.append(t if t else (b if b else f"col{j}"))

    names = _dedupe_column_names(names)
    data_start = header_idx + (2 if use_sub else 1)
    body = raw.iloc[data_start:].copy()
    ncols = min(len(names), body.shape[1])
    body = body.iloc[:, :ncols]
    body.columns = names[:ncols]
    body = body.reset_index(drop=True)
    return _strip_non_data_rows(body)


def _read_overseas_excel_to_normalized_df(source):
    """以 header=None 读入，再按证监会双行表头解析（path / url / BytesIO）。"""
    import pandas as pd  # noqa: PLC0415

    raw = pd.read_excel(source, header=None, dtype=object)
    return _raw_sheet_to_dataframe(raw)


def _maybe_normalize_existing_df(df):
    """若 pandas 已用首行当列名读入失败，则把整张表当网格重解析。"""
    import pandas as pd  # noqa: PLC0415

    if df is None or len(df) == 0:
        return df
    flat = [_flatten_column_name(c) for c in df.columns]
    joined = " ".join(flat)
    if "企业名称" in joined and "接收日期" in joined:
        out = df.copy()
        out.columns = flat
        return _strip_non_data_rows(out)
    raw = pd.concat([pd.DataFrame([df.columns.values]), df], ignore_index=True)
    raw.columns = range(raw.shape[1])
    return _raw_sheet_to_dataframe(raw)


def _url_path_lower(url):
    try:
        p = urlparse(str(url or "").strip())
        return (p.path or "").lower().split("?", 1)[0]
    except Exception:
        return ""


def _is_direct_excel_url(url):
    pl = _url_path_lower(url)
    return pl.endswith(".xlsx") or pl.endswith(".xls")


def _is_direct_csv_url(url):
    return _url_path_lower(url).endswith(".csv")


def _looks_like_xlsx_bytes(content):
    return isinstance(content, (bytes, bytearray)) and len(content) > 4 and content[:2] == b"PK"


def _http_get_bytes(target_url, timeout=90):
    import requests  # noqa: PLC0415

    headers = {
        "User-Agent": os.environ.get(
            "CSRC_HTTP_USER_AGENT",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ),
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    r = requests.get(target_url, timeout=timeout, headers=headers, allow_redirects=True)
    r.raise_for_status()
    return r.content


def _try_discover_excel_bytes(portal_url):
    """复用 getSearch + 详情页解析，无需浏览器。"""
    try:
        from overseas_filing_discover import discover_excel_url  # noqa: PLC0415
    except Exception:
        return None, ""
    kw = os.environ.get("OVERSEAS_FILING_SEARCH_KEYWORD", "境内企业境外发行证券和上市备案").strip()
    if not kw:
        return None, ""
    try:
        out = discover_excel_url(page_url=portal_url.strip(), keyword=kw)
        excel_url = (out or {}).get("excelUrl") or ""
        if not excel_url:
            return None, ""
        raw = _http_get_bytes(excel_url)
        if _looks_like_xlsx_bytes(raw):
            return raw, excel_url
    except Exception:
        return None, ""
    return None, ""


def _fetch_excel_via_playwright(portal_url):
    """模拟：打开门户 → 搜索关键词 → 点首条 → 详情页取 .xlsx 链接 → 下载。"""
    try:
        from playwright.sync_api import sync_playwright  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError(
            "未安装 playwright，请执行: pip install playwright && playwright install chromium"
        ) from e

    import pandas as pd  # noqa: PLC0415

    keyword = os.environ.get("OVERSEAS_FILING_SEARCH_KEYWORD", "境内企业境外发行证券和上市备案").strip()
    if not keyword:
        raise RuntimeError("OVERSEAS_FILING_SEARCH_KEYWORD 为空")

    timeout_ms = int(os.environ.get("OVERSEAS_FILING_PW_TIMEOUT_MS", "120000"))
    headless = os.environ.get("OVERSEAS_FILING_PW_HEADLESS", "1").strip().lower() not in ("0", "false", "no")

    custom_sel_in = os.environ.get("OVERSEAS_FILING_PW_SEARCH_INPUT", "").strip()
    custom_sel_btn = os.environ.get("OVERSEAS_FILING_PW_SEARCH_BUTTON", "").strip()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless,
            executable_path="/ms-playwright/chromium-1208/chrome-linux64/chrome",
        )
        context = browser.new_context(
            locale="zh-CN",
            user_agent=os.environ.get(
                "CSRC_HTTP_USER_AGENT",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            ),
        )
        page = context.new_page()
        page.set_default_timeout(timeout_ms)
        page.goto(portal_url.strip(), wait_until="domcontentloaded", timeout=timeout_ms)
        # 带 #tab= 时布局可能晚于 domcontentloaded 渲染
        page.wait_for_timeout(int(os.environ.get("OVERSEAS_FILING_PW_AFTER_GOTO_MS", "2500")))
        # 政府信息公开页：搜索框为 input#content，按钮为 a.search-icon（放大镜），非 button「搜索」
        try:
            page.wait_for_selector(
                "input#content, div.zfxx-search-box input[type='text'], input#searchContent",
                state="visible",
                timeout=min(timeout_ms, 90000),
            )
        except Exception:
            pass

        def try_search_on_frame(frame):
            filled = False
            if custom_sel_in:
                loc = frame.locator(custom_sel_in).first
                if loc.count():
                    loc.wait_for(state="visible", timeout=15000)
                    loc.fill("", timeout=3000)
                    loc.fill(keyword, timeout=10000)
                    filled = True
            if not filled:
                for tb in (
                    frame.locator("input#content"),
                    frame.locator('div.search-content input[type="text"]'),
                    frame.locator("div.zfxx-search-box input#content"),
                    frame.locator('input#searchContent'),
                    frame.locator('input[name="searchContent"]'),
                    frame.locator("#fulltext"),
                    frame.get_by_role("textbox"),
                ):
                    try:
                        if tb.count() == 0:
                            continue
                        el = tb.first
                        el.wait_for(state="visible", timeout=8000)
                        el.fill("", timeout=2000)
                        el.fill(keyword, timeout=10000)
                        filled = True
                        break
                    except Exception:
                        continue
            if not filled:
                return False
            if custom_sel_btn:
                frame.locator(custom_sel_btn).first.click(timeout=15000)
                return True
            for icon in (
                frame.locator("a.search-icon"),
                frame.locator("div.search-content a.search-icon"),
                frame.locator("div.zfxx-search-box a.search-icon"),
            ):
                if icon.count():
                    icon.first.click(timeout=15000)
                    return True
            for pat in (r"搜索", r"检索", r"查询"):
                btn = frame.get_by_role("button", name=re.compile(pat))
                if btn.count():
                    btn.first.click(timeout=15000)
                    return True
            for alt in (
                frame.locator("input[type='submit']"),
                frame.locator("button[type='submit']"),
                frame.locator("a").filter(has_text=re.compile(r"^\s*搜索\s*$")),
            ):
                if alt.count():
                    alt.first.click(timeout=15000)
                    return True
            return False

        searched = try_search_on_frame(page.main_frame)
        if not searched:
            for fr in page.frames:
                if fr is page.main_frame:
                    continue
                try:
                    if try_search_on_frame(fr):
                        searched = True
                        break
                except Exception:
                    continue
        if not searched:
            browser.close()
            raise RuntimeError("Playwright：未找到搜索框或搜索按钮（可设 OVERSEAS_FILING_PW_SEARCH_INPUT / _BUTTON）")

        page.wait_for_timeout(int(os.environ.get("OVERSEAS_FILING_PW_AFTER_SEARCH_MS", "2500")))
        try:
            page.wait_for_selector("table tbody tr", timeout=min(timeout_ms, 60000))
        except Exception:
            pass

        link_el = None
        detail_href = ""
        first_sel = os.environ.get("OVERSEAS_FILING_PW_FIRST_ROW_LINK", "").strip()
        if first_sel:
            link_el = page.locator(first_sel).first
            if link_el.count() == 0:
                browser.close()
                raise RuntimeError("OVERSEAS_FILING_PW_FIRST_ROW_LINK 未匹配到元素")
            link_el.wait_for(state="visible", timeout=30000)
            detail_href = link_el.get_attribute("href") or ""
        else:
            rows = page.locator("table tbody tr")
            n = rows.count()
            for i in range(min(n, 40)):
                row = rows.nth(i)
                link = row.locator("a").first
                if link.count() == 0:
                    continue
                try:
                    txt = (link.inner_text() or "").strip()
                except Exception:
                    continue
                if len(txt) < 6:
                    continue
                if any(k in txt for k in ("备案", "境外", "上市", "情况表", "发行")):
                    detail_href = link.get_attribute("href") or ""
                    link_el = link
                    break
            if link_el is None:
                link_el = page.locator("table tbody tr a").first
                if link_el.count() == 0:
                    browser.close()
                    raise RuntimeError("Playwright：搜索结果中未找到标题链接")
                detail_href = link_el.get_attribute("href") or ""

        if link_el is None or link_el.count() == 0:
            browser.close()
            raise RuntimeError("Playwright：未定位到首条结果链接")

        if detail_href and not detail_href.strip().lower().startswith("javascript:"):
            full_detail = urljoin(page.url, detail_href.strip())
            page.goto(full_detail, wait_until="domcontentloaded", timeout=timeout_ms)
        else:
            try:
                with page.expect_navigation(timeout=timeout_ms):
                    link_el.click(timeout=20000)
            except Exception:
                link_el.click(timeout=20000)
                page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)

        page.wait_for_timeout(1500)
        xloc = page.locator('a[href$=".xlsx"], a[href*=".xlsx?"], a[href*=".xlsx"]').filter(
            has_text=re.compile(r"xlsx|备案|境外", re.I)
        )
        if xloc.count() == 0:
            xloc = page.locator('a[href$=".xlsx"], a[href*=".xlsx?"]')
        if xloc.count() == 0:
            browser.close()
            raise RuntimeError("Playwright：详情页未找到 .xlsx 附件链接")

        href = xloc.first.get_attribute("href") or ""
        excel_abs = urljoin(page.url, href.strip())
        resp = page.request.get(excel_abs, timeout=timeout_ms)
        if resp.status >= 400:
            browser.close()
            raise RuntimeError(f"Playwright：下载 Excel 失败 HTTP {resp.status} {excel_abs}")
        body = resp.body()
        browser.close()

    if not _looks_like_xlsx_bytes(body):
        raise RuntimeError("Playwright：下载内容不是有效 xlsx（非 ZIP 头）")
    return _read_overseas_excel_to_normalized_df(io.BytesIO(body)), f"url+playwright:{excel_abs}"


def _load_df_from_portal_url(url):
    """request_url 为证监会门户等 HTML 页时：discover → playwright。"""
    force_pw = os.environ.get("OVERSEAS_FILING_FORCE_PLAYWRIGHT", "").strip().lower() in ("1", "true", "yes")
    if not force_pw:
        raw, _excel_ref = _try_discover_excel_bytes(url)
        if raw and _looks_like_xlsx_bytes(raw):
            return _read_overseas_excel_to_normalized_df(io.BytesIO(raw)), "url+discover"

    return _fetch_excel_via_playwright(url)


def _load_df(file_path, url, source_mode):
    import pandas as pd  # noqa: PLC0415

    mode = (source_mode or "url").strip().lower()
    if mode == "file":
        if not file_path:
            raise RuntimeError("source=file 但未配置 OVERSEAS_FILING_FILE_PATH")
        lower = file_path.lower()
        if lower.endswith(".csv"):
            return pd.read_csv(file_path, encoding="utf-8"), "file"
        return _read_overseas_excel_to_normalized_df(file_path), "file"
    if mode == "url":
        if not url:
            raise RuntimeError("source=url 但未配置 OVERSEAS_FILING_FILE_URL")
        if _is_direct_csv_url(url):
            return pd.read_csv(url, encoding="utf-8"), "url"
        if _is_direct_excel_url(url):
            return _read_overseas_excel_to_normalized_df(url), "url"
        return _load_df_from_portal_url(url)
    raise RuntimeError(f"不支持的 source 模式: {source_mode}")


def _build_rows(df, start_date, end_date):
    rows = []
    for _, r in df.iterrows():
        d = r.to_dict()
        company_name = str(_pick(d, ["企业名称", "公司名称", "发行人", "发行人名称"]) or "").strip()
        if not company_name:
            continue
        receive_date = _norm_date(_pick(d, ["接收日期", "受理日期", "备案日期", "日期"]))
        if not receive_date:
            continue
        if receive_date < start_date or receive_date > end_date:
            continue
        filing_type = str(_pick(d, ["申报类型", "备案类型", "申请类型"]) or "境外上市备案").strip() or "境外上市备案"
        filing_entity = str(_pick(d, ["申报主体", "备案主体"]) or "").strip()
        target_exchange = str(_pick(d, ["拟上市证券交易所", "拟上市交易所", "上市地"]) or "").strip()
        filing_status = str(_pick(d, ["备案状态", "状态", "审核状态"]) or "已受理").strip() or "已受理"
        source_page_url = str(_pick(d, ["来源链接", "列表链接", "详情链接"]) or "").strip()
        source_file_url = str(_pick(d, ["附件链接", "Excel链接", "文件链接"]) or "").strip()
        batch_week = str(_pick(d, ["批次周", "周次", "批次"]) or "").strip()
        rows.append(
            {
                "company_name": company_name,
                "filing_type": filing_type,
                "filing_entity": filing_entity,
                "target_exchange": target_exchange,
                "receive_date": receive_date,
                "filing_status": filing_status,
                "source_page_url": source_page_url,
                "source_file_url": source_file_url,
                "batch_week": batch_week,
            }
        )
    return rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--start-date", required=True)
    p.add_argument("--end-date", required=True)
    p.add_argument("--file", default=os.environ.get("OVERSEAS_FILING_FILE_PATH", "").strip())
    p.add_argument("--url", default=os.environ.get("OVERSEAS_FILING_FILE_URL", "").strip())
    p.add_argument("--source", default=os.environ.get("OVERSEAS_FILING_SOURCE", "url").strip())
    args = p.parse_args()

    start_date = args.start_date.strip()[:10]
    end_date = args.end_date.strip()[:10]
    df, source_name = _load_df(args.file, args.url, args.source)
    rows = _build_rows(df, start_date, end_date)
    print(
        json.dumps(
            {
                "ok": True,
                "source": source_name,
                "sourceRows": int(len(df.index)),
                "builtRows": len(rows),
                "rows": rows,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()

