#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
百度百科抓取 — Playwright CDP 模式（连接本机已打开的 Chrome）。

复用真实浏览器 Cookie/会话，降低 BIOC 安全验证拦截概率；若仍出现验证码，可人工在浏览器中完成后再继续批跑。

前置（Windows PowerShell，先执行一次）：
  .\\server\\scripts\\startChromeForBaike.ps1
  在打开的 Chrome 中访问 https://baike.baidu.com 并完成一次验证（如需要）

单条测试：
  py -3 server/utils/project-sourcing/baidu_baike_fetch_browser.py --name "科大讯飞股份有限公司"

批跑（stdin JSON）：
  echo '[{"company_name":"科大讯飞股份有限公司"}]' | py -3 ... --batch

常驻 worker（Node 长连 CDP，避免每批重连）：
  py -3 ... --worker
  # stdin 每行 JSON: {"items":[...],"sleep_ms":400,"fast_item_only":true}
  # stdout 每行 JSON 数组；首行 {"ready":true}
"""

import argparse
import json
import sys
import time
import urllib.parse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from baidu_baike_fetch import (
    _classify_search_page,
    _failure,
    _intro_is_usable,
    _is_anti_crawl_page,
    _is_generic_baike_intro,
    _is_no_lemma_page,
    _page_has_lemma,
    _success_from_abstract,
    _success_from_item_page,
)

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ImportError as e:
    raise SystemExit(
        "缺少 playwright，请执行: py -3 -m pip install playwright\n"
        "CDP 模式使用本机 Chrome，无需 playwright install chromium"
    ) from e


CDP_HINT = (
    "请先启动带远程调试端口的 Chrome，例如：\n"
    "  powershell -File server/scripts/startChromeForBaike.ps1\n"
    "然后在浏览器中打开 https://baike.baidu.com 并完成一次安全验证（如出现）。"
)


class BaikeCdpSession:
    """单次批跑复用同一 CDP 连接与标签页。"""

    def __init__(self, cdp_url, timeout_ms=30000, captcha_wait_ms=15000):
        self.cdp_url = cdp_url
        self.timeout_ms = timeout_ms
        self.captcha_wait_ms = captcha_wait_ms
        self._pw = None
        self._browser = None
        self.page = None

    def __enter__(self):
        self._pw = sync_playwright().start()
        try:
            self._browser = self._pw.chromium.connect_over_cdp(self.cdp_url)
        except PlaywrightError as e:
            raise RuntimeError(f"无法连接 CDP ({self.cdp_url}): {e}\n{CDP_HINT}") from e
        if not self._browser.contexts:
            raise RuntimeError(f"CDP 已连接但无浏览器上下文。\n{CDP_HINT}")
        context = self._browser.contexts[0]
        self.page = context.pages[0] if context.pages else context.new_page()
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if self._browser:
                self._browser.close()
        except Exception:
            pass
        try:
            if self._pw:
                self._pw.stop()
        except Exception:
            pass

    def _wait_page_settle(self):
        page = self.page
        try:
            page.wait_for_function(
                """() => {
          const html = document.documentElement ? document.documentElement.outerHTML : '';
          const title = document.title || '';
          if (document.querySelector('.lemmaWgt-lemmaTitle')) return true;
          if (document.querySelector('.lemmaSummary')) return true;
          if (title.includes('安全验证') || html.includes('百度安全验证')) return true;
          if (html.includes('约为0') || html.includes('页面不存在') || html.includes('尚未收录')) return true;
          return document.readyState === 'complete';
        }""",
                timeout=min(self.timeout_ms, 25000),
            )
        except PlaywrightError:
            pass

    def goto_html(self, url, allow_captcha_wait=True, wait_lemma=False, fast=False):
        page = self.page
        page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
        if fast:
            # 快速模式：等 2 秒让验证码 JS 有机会加载，再读内容
            time.sleep(2)
            html = page.content()
            title = page.title()
            final_url = page.url
            # 验证码/反爬检测：HTML 标记 + 页面标题双重判断
            captcha_detected = _is_anti_crawl_page(html) or any(
                kw in title for kw in ("百度安全验证", "百度验证", "安全验证")
            )
            if allow_captcha_wait and captcha_detected:
                sys.stderr.write("[captcha] 检测到安全验证，请在浏览器中手动完成验证...\n")
                sys.stderr.flush()
                waited = 0
                while waited < 120:
                    time.sleep(2)
                    waited += 2
                    html = page.content()
                    title = page.title()
                    still_captcha = _is_anti_crawl_page(html) or any(
                        kw in title for kw in ("百度安全验证", "百度验证", "安全验证")
                    )
                    if not still_captcha:
                        sys.stderr.write("[captcha] 验证已通过，继续\n")
                        sys.stderr.flush()
                        break
                final_url = page.url
            return final_url, html
        if wait_lemma:
            try:
                page.wait_for_selector(
                    ".lemmaWgt-lemmaTitle, .lemmaSummary, .J-summary",
                    timeout=self.timeout_ms,
                )
            except PlaywrightError:
                pass
        self._wait_page_settle()
        html = page.content()
        final_url = page.url
        if allow_captcha_wait and _is_anti_crawl_page(html) and self.captcha_wait_ms > 0:
            time.sleep(self.captcha_wait_ms / 1000.0)
            if wait_lemma:
                try:
                    page.wait_for_selector(
                        ".lemmaWgt-lemmaTitle, .lemmaSummary, .J-summary",
                        timeout=self.timeout_ms,
                    )
                except PlaywrightError:
                    pass
            self._wait_page_settle()
            html = page.content()
            final_url = page.url
        return final_url, html


def _try_item_page_browser(session, name, fast_item_only=False):
    url = f"https://baike.baidu.com/item/{urllib.parse.quote(name)}"
    final_url, html = session.goto_html(url, wait_lemma=not fast_item_only, fast=fast_item_only)
    # 快速模式：如果被重定向到主页（无 /item/ 路径），直接判定无词条
    if fast_item_only and "/item/" not in final_url:
        return "no_lemma", None, html, final_url
    if _is_anti_crawl_page(html):
        return "anti_crawl", None, html, final_url
    if _is_no_lemma_page(html, final_url):
        return "no_lemma", None, html, final_url
    if not _page_has_lemma(html):
        return "no_lemma", None, html, final_url
    return "ok", html, html, final_url


def _finalize_item_success(name, html, final_url, fetch_mode):
    out = _success_from_item_page(name, html, final_url, fetch_mode=fetch_mode)
    out["profile_source"] = "baike_crawler_cdp"
    if not out.get("ok") and _page_has_lemma(html):
        intro = out.get("company_intro") or ""
        if _is_generic_baike_intro(intro):
            return _failure(name, final_url, "anti_crawl", "unknown", detail="lemma_not_loaded")
    return out


def _fetch_search_browser(session, name):
  url = f"https://baike.baidu.com/search?word={urllib.parse.quote(name)}&pn=0&rn=10"
  final_url, html = session.goto_html(url)
  kind, payload = _classify_search_page(name, html, final_url, 200)
  return kind, payload, html, final_url


def _fetch_search_none_browser(session, name):
  url = f"https://baike.baidu.com/search/none?word={urllib.parse.quote(name)}"
  final_url, html = session.goto_html(url)
  kind, payload = _classify_search_page(name, html, final_url, 200)
  return kind, payload, html, final_url


def fetch_baike_browser(session, company_name, fast_item_only=False):
  name = str(company_name or "").strip()
  if not name:
    return _failure("", "", "empty_name", "unknown", detail="empty_name")

  item_url = f"https://baike.baidu.com/item/{urllib.parse.quote(name)}"
  try:
    kind, payload, html, final_url = _try_item_page_browser(session, name, fast_item_only=fast_item_only)
    if kind == "ok":
      return _finalize_item_success(name, payload, final_url, "cdp_item")
    if kind == "no_lemma":
      return _failure(name, final_url, "no_lemma", "not_found", detail="no_lemma")
    if fast_item_only:
      if kind == "anti_crawl":
        return _failure(name, final_url, "anti_crawl", "unknown", detail="anti_crawl")
      return _failure(name, final_url, "no_lemma", "not_found", detail="fast_item_only")

    search_kind, search_payload, search_html, search_url = _fetch_search_browser(session, name)
    if search_kind == "no_lemma":
      return _failure(name, search_url, "no_lemma", "not_found", detail="no_lemma")
    if search_kind == "has_results":
      item_final, item_html = session.goto_html(search_payload, wait_lemma=True)
      if not _is_anti_crawl_page(item_html) and _page_has_lemma(item_html):
        out = _finalize_item_success(name, item_html, item_final, "cdp_search_item")
        if out.get("ok") or out.get("miss_reason") != "anti_crawl":
          return out
      if _is_no_lemma_page(item_html, item_final):
        return _failure(name, item_final, "no_lemma", "not_found", detail="no_lemma")
    if search_kind == "has_abstract" and _intro_is_usable(search_payload):
      out = _success_from_abstract(name, search_payload, search_url, fetch_mode="cdp_search_abstract")
      out["profile_source"] = "baike_crawler_cdp"
      return out
    if search_kind == "has_lemma_html":
      return _finalize_item_success(name, search_html, search_url, "cdp_search_page")

    none_kind, none_payload, none_html, none_url = _fetch_search_none_browser(session, name)
    if none_kind == "no_lemma":
      return _failure(name, none_url, "no_lemma", "not_found", detail="no_lemma")
    if none_kind == "has_abstract" and _intro_is_usable(none_payload):
      out = _success_from_abstract(name, none_payload, none_url, fetch_mode="cdp_search_none")
      out["profile_source"] = "baike_crawler_cdp"
      return out
    if none_kind == "has_results":
      item_final, item_html = session.goto_html(none_payload)
      if not _is_anti_crawl_page(item_html) and _page_has_lemma(item_html):
        return _finalize_item_success(name, item_html, item_final, "cdp_search_none_item")

    if kind == "anti_crawl" or search_kind == "anti_crawl" or none_kind == "anti_crawl":
      return _failure(name, item_url, "anti_crawl", "unknown", detail="anti_crawl")
    return _failure(name, item_url, "http_error", "unknown", detail="browser_unknown")
  except PlaywrightError as e:
    return _failure(name, item_url, "network_error", "unknown", detail=str(e))
  except Exception as e:
    return _failure(name, item_url, "network_error", "unknown", detail=str(e))


def run_batch_in_session(session, items, sleep_ms, fast_item_only=False):
  results = []
  for i, item in enumerate(items):
    name = str((item or {}).get("company_name") or "").strip()
    if sleep_ms > 0 and i > 0:
      time.sleep(sleep_ms / 1000.0)
    results.append(fetch_baike_browser(session, name, fast_item_only=fast_item_only))
  return results


def run_batch(items, cdp_url, sleep_ms, captcha_wait_ms, timeout_ms, fast_item_only=False):
  with BaikeCdpSession(cdp_url, timeout_ms=timeout_ms, captcha_wait_ms=captcha_wait_ms) as session:
    return run_batch_in_session(session, items, sleep_ms, fast_item_only=fast_item_only)


def run_worker(cdp_url, captcha_wait_ms, timeout_ms):
  with BaikeCdpSession(cdp_url, timeout_ms=timeout_ms, captcha_wait_ms=captcha_wait_ms) as session:
    print(json.dumps({"ready": True}, ensure_ascii=False), flush=True)
    for raw in sys.stdin:
      line = str(raw or "").strip()
      if not line:
        continue
      req = json.loads(line)
      if req.get("cmd") == "shutdown":
        break
      items = req.get("items") or []
      if not isinstance(items, list):
        print(json.dumps({"error": "items must be array"}, ensure_ascii=False), flush=True)
        continue
      sleep_ms = int(req.get("sleep_ms", 0) or 0)
      fast_item_only = bool(req.get("fast_item_only"))
      out = run_batch_in_session(session, items, sleep_ms, fast_item_only=fast_item_only)
      print(json.dumps(out, ensure_ascii=False), flush=True)


def main():
  p = argparse.ArgumentParser(description="百度百科 Playwright CDP 抓取")
  p.add_argument("--name", help="单条企业名称")
  p.add_argument("--batch", action="store_true", help="从 stdin 读取 JSON 数组 [{company_name}]")
  p.add_argument("--worker", action="store_true", help="常驻 worker：stdin 每行一批请求，stdout 每行结果")
  p.add_argument("--cdp-url", default="http://127.0.0.1:9222", help="Chrome CDP 地址")
  p.add_argument("--sleep-ms", type=int, default=1200, help="批内请求间隔（毫秒）")
  p.add_argument("--fast-item-only", action="store_true", help="仅直链 /item/，跳过 search 回退")
  p.add_argument("--captcha-wait-ms", type=int, default=15000, help="命中安全验证时额外等待（毫秒，供人工过验证）")
  p.add_argument("--timeout-ms", type=int, default=30000, help="页面导航超时（毫秒）")
  args = p.parse_args()

  if args.worker:
    run_worker(args.cdp_url, args.captcha_wait_ms, args.timeout_ms)
    return

  if args.batch:
    raw = sys.stdin.read()
    items = json.loads(raw or "[]")
    if not isinstance(items, list):
      raise SystemExit("batch 输入必须是 JSON 数组")
    out = run_batch(
      items,
      args.cdp_url,
      args.sleep_ms,
      args.captcha_wait_ms,
      args.timeout_ms,
      fast_item_only=args.fast_item_only,
    )
    print(json.dumps(out, ensure_ascii=False))
    return

  if not args.name:
    raise SystemExit("请提供 --name、--batch 或 --worker")
  with BaikeCdpSession(
    args.cdp_url, timeout_ms=args.timeout_ms, captcha_wait_ms=args.captcha_wait_ms
  ) as session:
    result = fetch_baike_browser(session, args.name, fast_item_only=args.fast_item_only)
  print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
  main()
