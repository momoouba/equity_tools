#!/usr/bin/env python3

# -*- coding: utf-8 -*-

"""

Stage 0 百科 PoC（D8：可控爬虫）— 百度百科词条抓取。

提取企业介绍；若有产品介绍/主营业务段落则单独提取，否则 product_intro = company_intro。



失败时区分：

  - no_lemma：页面明确提示无词条（尚未收录 / 约为0 / 页面不存在等）

  - anti_crawl：安全验证 / 反爬页（词条是否存在未知）

  - http_error / network_error：其它访问异常



用法：

  python baidu_baike_fetch.py --name "科大讯飞股份有限公司"

  python baidu_baike_fetch.py --name "某某公司" --dry-json

"""



import argparse

import json

import os

import re

import sys

import time

import urllib.parse



import requests



if hasattr(sys.stdout, "reconfigure"):

    sys.stdout.reconfigure(encoding="utf-8")



HEADERS = {

    "User-Agent": (

        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "

        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    ),

    "Accept-Language": "zh-CN,zh;q=0.9",

    "Referer": "https://baike.baidu.com/",

}



PRODUCT_TITLE_KEYS = ("主营产品", "主要产品", "产品与服务", "核心业务", "主营业务", "经营范围", "产品服务")

COMPANY_INTRO_KEYS = ("公司简介", "企业简介", "公司介绍", "概述", "简介")



NO_LEMMA_MARKERS = (

    "页面不存在",

    "词条已删除",

    "百度百科尚未收录",

    "尚未收录您要查询",

    "暂未收录",

    "相关词条约为0",

    "相关词条为0",

    "约为0个",

    "对不起，您所访问的页面不存在",

    "该词条尚未创建",

)



ANTI_CRAWL_MARKERS = (
    "antiCrawl",
    "百度安全验证",
    "百度验证",
    "security_passport",
    "请输入验证码",
    "seccaptcha",
    "bioc-static",
    "BIOC_OPTIONS",
)

GENERIC_BAIKE_INTRO_MARKERS = (
    "百度百科是一部内容开放",
    "自由的网络百科全书",
)


def _is_generic_baike_intro(text):
    t = str(text or "").strip()
    if len(t) < 20:
        return True
    return any(m in t for m in GENERIC_BAIKE_INTRO_MARKERS)


def _intro_is_usable(text):
    t = str(text or "").strip()
    return len(t) >= 20 and not _is_generic_baike_intro(t)





def _clean_text(html_fragment):

    if not html_fragment:

        return ""

    text = re.sub(r"<script[\s\S]*?</script>", " ", html_fragment, flags=re.I)

    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)

    text = re.sub(r"<[^>]+>", " ", text)

    text = re.sub(r"\s+", " ", text)

    return text.strip()





def _extract_lemma_summary(html):

    m = re.search(

        r'class="lemmaSummary[^"]*"[^>]*>([\s\S]*?)</div>\s*<div class="lemmaWgt-promotion',

        html,

        flags=re.I,

    )

    if not m:

        m = re.search(r'class="lemmaSummary[^"]*"[^>]*>([\s\S]*?)</div>', html, flags=re.I)

    if m:

        return _clean_text(m.group(1))

    meta = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', html, flags=re.I)

    if meta:

        return meta.group(1).strip()

    return ""





def _extract_section_by_titles(html, title_keys):

    """按百科目录/标题锚点截取段落文本。"""

    for key in title_keys:

        pattern = rf'(?:data-text="{re.escape(key)}"|>{re.escape(key)}</a>|>{re.escape(key)}</h2>|>{re.escape(key)}</h3>)'

        m = re.search(pattern, html, flags=re.I)

        if not m:

            continue

        start = m.end()

        chunk = html[start : start + 12000]

        end_m = re.search(

            r'<h2\b|<h3\b|class="anchor-list"|class="lemmaWgt-promotion"',

            chunk,

            flags=re.I,

        )

        body = chunk[: end_m.start()] if end_m else chunk

        paras = re.findall(r'<div[^>]*class="[^"]*para[^"]*"[^>]*>([\s\S]*?)</div>', body, flags=re.I)

        if paras:

            text = _clean_text(" ".join(paras[:6]))

            if len(text) >= 20:

                return text

        text = _clean_text(body)

        if len(text) >= 20:

            return text[:2000]

    return ""





def _page_has_lemma(html):

    if re.search(r'class="lemmaWgt-lemmaTitle', html, flags=re.I):

        return True

    if re.search(r'"lemmaId"\s*:', html):

        return True

    if "百度百科" in html and "lemmaSummary" in html:

        return True

    return False





def _is_no_lemma_page(html, url=""):

    if not html:

        return False

    if any(m in html for m in NO_LEMMA_MARKERS):

        return True

    if "/error.html" in (url or ""):

        return True

    title_m = re.search(r"<title>([^<]*)</title>", html, flags=re.I)

    if title_m:

        title = title_m.group(1)

        if "页面不存在" in title or "尚未收录" in title:

            return True

    return False





def _is_anti_crawl_page(html):

    if not html:

        return True

    return any(m in html for m in ANTI_CRAWL_MARKERS)





def _extract_search_item_links(html):

    links = re.findall(

        r'href="(/item/[^"#?]+|https?://baike\.baidu\.com/item/[^"#?]+)"',

        html or "",

        flags=re.I,

    )

    out = []

    seen = set()

    for link in links:

        if link.startswith("http"):

            full = link

        else:

            full = urllib.parse.urljoin("https://baike.baidu.com", link)

        if full in seen:

            continue

        seen.add(full)

        out.append(full)

    return out





def _extract_search_abstract(html):

    m = re.search(r'class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)</div>', html, flags=re.I)

    if m:

        text = _clean_text(m.group(1))

        if len(text) >= 15:

            return text

    meta = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', html, flags=re.I)

    if meta:

        text = meta.group(1).strip()

        if len(text) >= 15:

            return text

    return ""





def _failure(name, url, miss_reason, lemma_status, http_status=None, detail=None):

    err = detail or miss_reason

    out = {

        "ok": False,

        "has_lemma": False,

        "lemma_status": lemma_status,

        "miss_reason": miss_reason,

        "company_name": name,

        "baike_url": url or "",

        "error": err,

    }

    if http_status is not None:

        out["http_status"] = http_status

    return out





def _success_from_item_page(name, html, url, fetch_mode="item_page"):

    company_intro = _extract_lemma_summary(html)

    product_section = _extract_section_by_titles(html, PRODUCT_TITLE_KEYS)

    product_intro = product_section or company_intro

    return {
        "ok": bool(_intro_is_usable(company_intro) or _intro_is_usable(product_intro)),

        "has_lemma": True,

        "lemma_status": "found",

        "miss_reason": None,

        "company_name": name,

        "baike_url": url,

        "company_intro": company_intro,

        "product_intro": product_intro,

        "product_from_fallback": not bool(product_section),

        "profile_source": "baike_crawler",

        "fetch_mode": fetch_mode,

    }





def _success_from_abstract(name, abstract, url, fetch_mode):

    return {

        "ok": True,

        "has_lemma": True,

        "lemma_status": "found",

        "miss_reason": None,

        "company_name": name,

        "baike_url": url,

        "company_intro": abstract,

        "product_intro": abstract,

        "product_from_fallback": True,

        "profile_source": "baike_crawler",

        "fetch_mode": fetch_mode,

    }





def _get_page(session, url, timeout):

    r = session.get(url, timeout=timeout, allow_redirects=True)

    return r, r.text or ""





def _classify_search_page(name, html, url, status_code):

    """搜索页分类：无词条 / 有结果 / 反爬 / 未知。"""

    if _is_anti_crawl_page(html):

        return "anti_crawl", None

    if _is_no_lemma_page(html, url):

        return "no_lemma", None

    if status_code != 200:

        return "http_error", None

    item_links = _extract_search_item_links(html)

    if item_links:

        return "has_results", item_links[0]

    abstract = _extract_search_abstract(html)

    if abstract:

        return "has_abstract", abstract

    if _page_has_lemma(html):

        return "has_lemma_html", None

    return "unknown", None





def _fetch_search(name, session, timeout):

    url = f"https://baike.baidu.com/search?word={urllib.parse.quote(name)}&pn=0&rn=10"

    r, html = _get_page(session, url, timeout)

    kind, payload = _classify_search_page(name, html, r.url, r.status_code)

    return kind, payload, r.status_code, html, r.url





def _fetch_search_none(name, session, timeout):

    url = f"https://baike.baidu.com/search/none?word={urllib.parse.quote(name)}"

    r, html = _get_page(session, url, timeout)

    kind, payload = _classify_search_page(name, html, r.url, r.status_code)

    return kind, payload, r.status_code, html, r.url





def _try_item_page(name, session, timeout):

    url = f"https://baike.baidu.com/item/{urllib.parse.quote(name)}"

    r, html = _get_page(session, url, timeout)



    if _is_anti_crawl_page(html):

        return "anti_crawl", None, r.status_code, html, r.url



    if r.status_code == 403:

        return "anti_crawl", None, r.status_code, html, r.url



    if r.status_code != 200:

        if _is_no_lemma_page(html, r.url):

            return "no_lemma", None, r.status_code, html, r.url

        return "http_error", None, r.status_code, html, r.url



    if _is_no_lemma_page(html, r.url):

        return "no_lemma", None, r.status_code, html, r.url



    if not _page_has_lemma(html):

        return "no_lemma", None, r.status_code, html, r.url



    return "ok", html, r.status_code, html, r.url





def fetch_baike(company_name, timeout=25):

    name = str(company_name or "").strip()

    if not name:

        return _failure("", "", "empty_name", "unknown", detail="empty_name")



    session = requests.Session()

    session.headers.update(HEADERS)

    proxy = os.environ.get("BAIKE_HTTP_PROXY") or os.environ.get("HTTP_PROXY")

    if proxy:

        session.proxies.update({"http": proxy, "https": proxy})



    item_url = f"https://baike.baidu.com/item/{urllib.parse.quote(name)}"



    try:

        kind, payload, status, html, final_url = _try_item_page(name, session, timeout)



        if kind == "ok":

            return _success_from_item_page(name, payload, final_url)



        if kind == "no_lemma":

            return _failure(name, final_url, "no_lemma", "not_found", status)



        # anti_crawl / http_error：走搜索页再判定「无词条」vs「仍被拦截」

        search_kind, search_payload, search_status, search_html, search_url = _fetch_search(

            name, session, timeout

        )



        if search_kind == "no_lemma":

            return _failure(name, search_url, "no_lemma", "not_found", search_status)



        if search_kind == "has_results":

            r2, html2 = _get_page(session, search_payload, timeout)

            if not _is_anti_crawl_page(html2) and r2.status_code == 200 and _page_has_lemma(html2):

                return _success_from_item_page(name, html2, r2.url, fetch_mode="search_item")

            if _is_no_lemma_page(html2, r2.url):

                return _failure(name, r2.url, "no_lemma", "not_found", r2.status_code)



        if search_kind == "has_abstract":

            return _success_from_abstract(name, search_payload, search_url, fetch_mode="search_abstract")



        if search_kind == "has_lemma_html":

            return _success_from_item_page(name, search_html, search_url, fetch_mode="search_page")



        # search/none 兜底（部分网络下可返回摘要）

        none_kind, none_payload, none_status, none_html, none_url = _fetch_search_none(

            name, session, timeout

        )

        if none_kind == "no_lemma":

            return _failure(name, none_url, "no_lemma", "not_found", none_status)

        if none_kind == "has_abstract":

            return _success_from_abstract(name, none_payload, none_url, fetch_mode="search_none")

        if none_kind == "has_results":

            r3, html3 = _get_page(session, none_payload, timeout)

            if not _is_anti_crawl_page(html3) and r3.status_code == 200 and _page_has_lemma(html3):

                return _success_from_item_page(name, html3, r3.url, fetch_mode="search_none_item")



        # 仍无法确认：反爬/访问受限，词条是否存在未知（不可当作无词条）

        if kind == "anti_crawl" or search_kind == "anti_crawl" or none_kind == "anti_crawl":

            return _failure(

                name,

                item_url,

                "anti_crawl",

                "unknown",

                status or search_status,

                detail="anti_crawl",

            )



        if kind == "http_error":

            return _failure(

                name,

                final_url,

                "http_error",

                "unknown",

                status,

                detail=f"http_{status}",

            )



        return _failure(

            name,

            item_url,

            "http_error",

            "unknown",

            search_status,

            detail=f"http_{search_status}",

        )

    except Exception as e:

        return _failure(name, item_url, "network_error", "unknown", detail=str(e))





def main():

    p = argparse.ArgumentParser()

    p.add_argument("--name", required=True)

    p.add_argument("--sleep-ms", type=int, default=0)

    args = p.parse_args()

    if args.sleep_ms > 0:

        time.sleep(args.sleep_ms / 1000.0)

    result = fetch_baike(args.name)

    print(json.dumps(result, ensure_ascii=False))





if __name__ == "__main__":

    main()

