#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Resolve the latest CSRC「境内企业境外发行证券和上市备案情况表」Excel URL
by mirroring the 政府信息公开 directory search (same as site /getSearch).
"""

import json
import os
import re
import sys
from html import unescape
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_PAGE = os.environ.get(
    "CSRC_ZFXXGK_PAGE_URL",
    "https://www.csrc.gov.cn/csrc/c101935/zfxxgk_zdgk.shtml?channelid=8f3f0d4be56b4f8aa8183b3234b88ede",
)
DEFAULT_KEYWORD = os.environ.get(
    "OVERSEAS_FILING_SEARCH_KEYWORD",
    "境内企业境外发行证券和上市备案",
)
ORIGIN = "https://www.csrc.gov.cn"


def prefer_https(url):
    """
    证监会站点 http→https 301 会把 POST 降级为 GET（requests 遵循 RFC），
    导致 /getSearch 等接口 404。csrc.gov.cn 域名一律直连 https。
    """
    u = (url or "").strip()
    if u.startswith("http://") and "csrc.gov.cn" in u:
        return "https://" + u[len("http://") :]
    return u


def _session():
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": os.environ.get(
                "CSRC_HTTP_USER_AGENT",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            ),
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": ORIGIN,
            "Referer": DEFAULT_PAGE,
        }
    )
    return s


def _parse_channel_id(html):
    m = re.search(r'id="channelid"[^>]*value="([^"]+)"', html, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r'<meta[^>]+name="channelid"[^>]+content="([^"]+)"', html, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r'<meta[^>]+content="([^"]+)"[^>]+name="channelid"', html, re.I)
    if m:
        return m.group(1).strip()
    return ""


def _strip_em_tags(s):
    t = re.sub(r"</?em>", "", unescape(s or ""), flags=re.I)
    return re.sub(r"\s+", " ", t).strip()


def _abs_url(href, base_url=None):
    """
    详情页内附件常为 ../../7627090/files/xxx.xlsx，必须以详情页 URL 为 base 解析。
    误用 https://www.csrc.gov.cn/ 作 base 会得到 /7627090/files/...（缺 csrc），站点返回 HTML 而非文件。
    """
    h = (href or "").strip()
    if not h:
        return ""
    if h.startswith("//"):
        return "https:" + h
    if h.startswith("http://") or h.startswith("https://"):
        return h
    base = (base_url or "").strip() or "https://www.csrc.gov.cn/"
    return urljoin(base, h)


def _pick_excel_url(soup, page_url):
    """Prefer .xlsx/.xls whose link text or href suggests 备案情况表."""
    candidates = []
    base = (page_url or "").strip() or "https://www.csrc.gov.cn/"
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        low = href.lower()
        if not (low.endswith(".xlsx") or low.endswith(".xls")):
            continue
        text = _strip_em_tags(a.get_text())
        full = _abs_url(href, base)
        score = 0
        if "备案情况表" in text or "备案情况表" in href:
            score += 10
        if "境外" in text or "境外" in href:
            score += 2
        candidates.append((score, full, text))
    candidates.sort(key=lambda x: (-x[0], len(x[1])))
    if candidates:
        return candidates[0][1]
    # fallback: regex on raw HTML
    raw = str(soup)
    for m in re.finditer(
        r'href=["\']([^"\']+\.(?:xlsx|xls))["\']', raw, flags=re.I
    ):
        u = _abs_url(m.group(1), base)
        if u:
            return u
    return ""


def discover_excel_url(page_url=None, keyword=None):
    page_url = prefer_https(page_url or DEFAULT_PAGE)
    keyword = (keyword or DEFAULT_KEYWORD).strip()
    if not keyword:
        raise RuntimeError("empty search keyword")

    s = _session()
    r0 = s.get(page_url, timeout=30)
    r0.raise_for_status()
    r0.encoding = r0.apparent_encoding or r0.encoding or "utf-8"
    channel_id = _parse_channel_id(r0.text)
    if not channel_id:
        raise RuntimeError("无法在页面解析 channelId，请检查 CSRC_ZFXXGK_PAGE_URL")

    data = {
        "type": "title",
        "searchContent": keyword,
        "channelId": channel_id,
        "isAgg": "true",
        "isIdentifier": "true",
        "page": "1",
        "size": "10",
    }
    host = f"{urlparse(page_url).scheme}://{urlparse(page_url).netloc}"
    search_url = urljoin(host + "/", "getSearch")
    s.headers["Referer"] = page_url
    r1 = s.post(search_url, data=data, timeout=35)
    r1.raise_for_status()
    try:
        payload = r1.json()
    except Exception as e:
        raise RuntimeError(f"getSearch 返回非 JSON: {e}") from e

    if payload.get("code") != 200:
        raise RuntimeError(f"getSearch 业务错误: {payload!r}")

    results = (payload.get("data") or {}).get("results") or []
    if not results:
        raise RuntimeError("getSearch 无结果，请尝试缩短关键词或检查栏目")

    first = results[0]
    detail_rel = (first.get("url") or "").strip()
    title_html = first.get("title") or first.get("subTitle") or ""
    title_plain = _strip_em_tags(title_html)

    detail_url = _abs_url(detail_rel, page_url)
    if not detail_url:
        raise RuntimeError("首条结果缺少 url")

    r2 = s.get(detail_url, timeout=35)
    r2.raise_for_status()
    r2.encoding = r2.apparent_encoding or r2.encoding or "utf-8"
    soup = BeautifulSoup(r2.text, "lxml")
    excel_url = _pick_excel_url(soup, detail_url)
    if not excel_url:
        raise RuntimeError(f"详情页未发现 Excel 附件: {detail_url}")

    return {
        "ok": True,
        "excelUrl": excel_url,
        "detailUrl": detail_url,
        "title": title_plain,
        "channelId": channel_id,
        "total": int((payload.get("data") or {}).get("total") or 0),
    }


def main():
    try:
        out = discover_excel_url()
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
