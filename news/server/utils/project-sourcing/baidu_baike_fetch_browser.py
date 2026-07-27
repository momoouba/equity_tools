#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
百度百科抓取 — Playwright 浏览器模式。

两种模式：
  - cdp：连接本机已打开的 Chrome（远程调试端口），适合 Windows PoC / 人工过验证码
  - headless：容器内 launch Playwright Chromium，适合 Docker 生产

前置（CDP / Windows）：
  .\\server\\scripts\\startChromeForBaike.ps1
  在打开的 Chrome 中访问 https://baike.baidu.com 并完成一次验证（如需要）

前置（headless / Docker）：
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
  python3 -m playwright install chromium

单条测试：
  py -3 ... --mode=headless --name "科大讯飞股份有限公司"
  py -3 ... --mode=cdp --cdp-url=http://127.0.0.1:9222 --name "科大讯飞股份有限公司"

批跑（stdin JSON）：
  echo '[{"company_name":"科大讯飞股份有限公司"}]' | py -3 ... --mode=headless --batch

常驻 worker：
  py -3 ... --mode=headless --worker
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from urllib.error import URLError, HTTPError

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_UTILS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _UTILS_DIR not in sys.path:
    sys.path.insert(0, _UTILS_DIR)

from baidu_baike_fetch import (  # noqa: E402
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
from playwright_host import ensure_playwright_browser_path  # noqa: E402

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ImportError as e:
    raise SystemExit(
        "缺少 playwright，请执行: py -3 -m pip install playwright\n"
        "CDP 模式使用本机 Chrome；headless 模式需: python -m playwright install chromium"
    ) from e


CDP_HINT = (
    "请先启动带远程调试端口的 Chrome，例如：\n"
    "  Windows: powershell -File server/scripts/startChromeForBaike.ps1\n"
    "  Linux:   ./server/scripts/startChromeForBaike.sh\n"
    "然后在浏览器中打开 https://baike.baidu.com 并完成一次安全验证（如出现）。\n"
    "Docker 内连接宿主机 Chrome：BAIKE_BROWSER_MODE=cdp "
    "BAIKE_CDP_URL=http://host.docker.internal:9222"
)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# 降低 headless 被 BIOC 识别的概率（非银弹，但仍优于裸 Playwright）
STEALTH_INIT_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
window.chrome = window.chrome || { runtime: {} };
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', {
  get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }],
});
const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) => (
    parameters && parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters)
  );
}
"""

USABLE_LEMMA_WAIT_JS = """() => {
  const title = document.title || '';
  const html = document.documentElement ? document.documentElement.outerHTML : '';
  if (title.includes('安全验证') || html.includes('百度安全验证') || html.includes('antiCrawl')) {
    return 'captcha';
  }
  if (html.includes('约为0') || html.includes('页面不存在') || html.includes('尚未收录')) {
    return 'no_lemma';
  }
  const nodes = document.querySelectorAll(
    '.lemmaSummary, .J-summary, .lemmaWgt-lemmaSummary, [class*="lemmaSummary"]'
  );
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (t.length >= 40 && !t.includes('百度百科是一部内容开放') && !t.includes('自由的网络百科全书')) {
      return 'ok';
    }
  }
  const h1 = document.querySelector('.lemmaWgt-lemmaTitle h1, .lemmaTitleH1, h1');
  if (h1 && (h1.innerText || '').trim().length >= 2) {
    // 标题已出但摘要未就绪 → 继续等
    return false;
  }
  return document.readyState === 'complete' ? 'shell' : false;
}"""


def _resolve_browser_mode(raw: str | None) -> str:
    mode = str(raw or os.environ.get("BAIKE_BROWSER_MODE", "") or "").strip().lower()
    if mode in ("cdp", "headless"):
        return mode
    # Docker / 已安装 Playwright 浏览器目录 → 默认 headless
    pw_path = str(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "") or "").strip()
    if pw_path and os.path.isdir(pw_path):
        return "headless"
    return "cdp"


def _headless_launch_args() -> list[str]:
    args = [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-infobars",
        "--window-size=1365,900",
    ]
    extra = str(os.environ.get("BAIKE_PLAYWRIGHT_EXTRA_ARGS", "") or "").strip()
    if extra:
        for part in extra.split():
            if part and part not in args:
                args.append(part)
    return args


def _dom_intro_text(page) -> str:
    """从渲染后的 DOM 取摘要，补 HTML 正则抽不到的情况。"""
    try:
        text = page.evaluate(
            """() => {
          const nodes = document.querySelectorAll(
            '.lemmaSummary, .J-summary, .lemmaWgt-lemmaSummary, [class*="lemmaSummary"]'
          );
          for (const el of nodes) {
            const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
            if (t.length >= 20) return t;
          }
          const meta = document.querySelector('meta[name="description"]');
          return meta ? (meta.getAttribute('content') || '').trim() : '';
        }"""
        )
        return str(text or "").strip()
    except Exception:
        return ""


def _diag_snapshot(page) -> str:
    try:
        title = page.title()
        url = page.url
        intro = _dom_intro_text(page)[:80]
        return f"title={title!r} url={url} intro_preview={intro!r}"
    except Exception as e:
        return f"diag_failed={e}"


def _playwright_proxy():
    """从环境变量读取代理，供 Playwright launch / context 使用。"""
    proxy_url = (
        os.environ.get("BAIKE_HTTP_PROXY")
        or os.environ.get("ALL_PROXY")
        or os.environ.get("HTTPS_PROXY")
        or os.environ.get("HTTP_PROXY")
        or ""
    ).strip()
    if not proxy_url:
        return None
    if not proxy_url.startswith(("http://", "https://", "socks5://", "socks5h://")):
        proxy_url = "http://" + proxy_url
    return {"server": proxy_url}


def _hostport_as_ip(netloc: str) -> str:
    """
    Chrome CDP WebSocket 要求 Host 为 IP 或 localhost。
    host.docker.internal 会触发:
      Host header is specified and is not an IP address or localhost
    """
    if not netloc:
        return netloc
    host, sep, port = netloc.partition(":")
    host = host.strip()
    if not host:
        return netloc
    if host in ("localhost", "127.0.0.1"):
        return netloc
    # 粗判 IPv4
    parts = host.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        return netloc
    try:
        ip = socket.gethostbyname(host)
    except OSError as e:
        raise RuntimeError(f"无法解析 CDP 主机 {host}: {e}") from e
    return f"{ip}:{port}" if port else ip


def resolve_cdp_connect_endpoint(cdp_url: str) -> str:
    """
    Docker + socat 场景下：
    1) Playwright 直连 /json/version/（尾斜杠）常 500
    2) 经 host.docker.internal 访问时 Host 头不是 127.0.0.1，Chrome HTTP 也会 500
    3) WebSocket 的 Host 若是 host.docker.internal（非 IP）会被 Chrome 拒绝
    4) 返回的 webSocketDebuggerUrl 是 ws://127.0.0.1:...，需改写成可达地址的 IP:port
    """
    raw = str(cdp_url or "").strip()
    if not raw:
        raise RuntimeError("空 CDP URL")
    if raw.startswith("ws://") or raw.startswith("wss://"):
        parsed = urllib.parse.urlparse(raw)
        if parsed.hostname and parsed.hostname not in ("localhost", "127.0.0.1"):
            try:
                ip = socket.gethostbyname(parsed.hostname)
                netloc = f"{ip}:{parsed.port}" if parsed.port else ip
                return urllib.parse.urlunparse(parsed._replace(netloc=netloc))
            except OSError:
                return raw
        return raw

    base = raw.rstrip("/")
    version_url = f"{base}/json/version"
    parsed_http = urllib.parse.urlparse(base)
    hostport = parsed_http.netloc
    connect_hostport = _hostport_as_ip(hostport)

    host_override = str(os.environ.get("BAIKE_CDP_HTTP_HOST", "") or "").strip()
    host_candidates = []
    if host_override:
        host_candidates.append(host_override)
    # Chrome HTTP 接口只认本机 Host；经 Docker/socat 转发时必须伪装
    host_candidates.extend(
        [
            "127.0.0.1:9222",
            "localhost:9222",
            "127.0.0.1:9223",
            "localhost:9223",
            connect_hostport,
            hostport,
        ]
    )

    payload = None
    last_err = None
    used_host = None
    for host_hdr in dict.fromkeys(h for h in host_candidates if h):
        try:
            req = urllib.request.Request(
                version_url,
                headers={"Accept": "application/json", "Host": host_hdr},
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                payload = json.loads(resp.read().decode("utf-8", errors="replace"))
            used_host = host_hdr
            break
        except (URLError, HTTPError, TimeoutError, json.JSONDecodeError, ValueError) as e:
            last_err = e
            continue

    if payload is None:
        raise RuntimeError(
            f"无法读取 CDP {version_url}（已尝试伪装 Host）: {last_err}\n"
            "请确认宿主机 Chrome 已加 --remote-allow-origins=* ，且 socat 在转发 9223→9222"
        )

    ws = str(payload.get("webSocketDebuggerUrl") or "").strip()
    if not ws:
        return f"{parsed_http.scheme}://{connect_hostport}"

    ws_parsed = urllib.parse.urlparse(ws)
    path = ws_parsed.path or ""
    query = f"?{ws_parsed.query}" if ws_parsed.query else ""
    rewritten = f"ws://{connect_hostport}{path}{query}"
    sys.stderr.write(
        f"[baike-browser] CDP http={base} host={used_host} → ws={rewritten}\n"
    )
    sys.stderr.flush()
    return rewritten


def _playwright_launch_env() -> dict:
    env = dict(os.environ)
    db = str(env.get("CHROME_CRASHPAD_DATABASE", "") or "").strip()
    if not db:
        db = os.path.join(tempfile.gettempdir(), "chromium-crashpad-db")
    try:
        os.makedirs(db, mode=0o755, exist_ok=True)
    except OSError:
        pass
    env["CHROME_CRASHPAD_DATABASE"] = db
    return env


class BaikeBrowserSession:
    """复用同一浏览器会话（CDP 连接或 headless launch）。"""

    def __init__(self, mode="cdp", cdp_url="http://127.0.0.1:9222", timeout_ms=30000, captcha_wait_ms=15000):
        self.mode = _resolve_browser_mode(mode)
        self.cdp_url = cdp_url
        self.timeout_ms = timeout_ms
        # headless 无法人工过验证码，缩短等待
        if self.mode == "headless":
            self.captcha_wait_ms = min(int(captcha_wait_ms or 0), 2000)
        else:
            self.captcha_wait_ms = int(captcha_wait_ms or 0)
        self._pw = None
        self._browser = None
        self._context = None
        self.page = None
        self._owned_browser = False

    def __enter__(self):
        if self.mode == "headless":
            ensure_playwright_browser_path()
        self._pw = sync_playwright().start()
        if self.mode == "headless":
            try:
                launch_kwargs = {
                    "headless": True,
                    "args": _headless_launch_args(),
                    "env": _playwright_launch_env(),
                }
                proxy = _playwright_proxy()
                if proxy:
                    launch_kwargs["proxy"] = proxy
                    sys.stderr.write(f"[baike-browser] using proxy {proxy['server']}\n")
                    sys.stderr.flush()
                self._browser = self._pw.chromium.launch(**launch_kwargs)
                self._owned_browser = True
            except PlaywrightError as e:
                raise RuntimeError(
                    f"无法启动 headless Chromium: {e}\n"
                    "请确认已执行: python3 -m playwright install chromium\n"
                    "且 PLAYWRIGHT_BROWSERS_PATH 指向有效目录（Docker 为 /ms-playwright）"
                ) from e
            self._context = self._browser.new_context(
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                user_agent=USER_AGENT,
                viewport={"width": 1365, "height": 900},
                extra_http_headers={
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                    "Upgrade-Insecure-Requests": "1",
                },
            )
            self._context.add_init_script(STEALTH_INIT_SCRIPT)
            self.page = self._context.new_page()
            try:
                self.page.goto(
                    "https://baike.baidu.com/",
                    wait_until="domcontentloaded",
                    timeout=self.timeout_ms,
                )
                time.sleep(1.2)
            except PlaywrightError as e:
                sys.stderr.write(f"[baike-browser] warm-up failed: {e}\n")
                sys.stderr.flush()
            return self

        try:
            endpoint = resolve_cdp_connect_endpoint(self.cdp_url)
            self._browser = self._pw.chromium.connect_over_cdp(endpoint)
        except PlaywrightError as e:
            raise RuntimeError(f"无法连接 CDP ({self.cdp_url}): {e}\n{CDP_HINT}") from e
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"无法连接 CDP ({self.cdp_url}): {e}\n{CDP_HINT}") from e
        if not self._browser.contexts:
            raise RuntimeError(f"CDP 已连接但无浏览器上下文。\n{CDP_HINT}")
        context = self._browser.contexts[0]
        try:
            context.add_init_script(STEALTH_INIT_SCRIPT)
        except Exception:
            pass
        self.page = context.pages[0] if context.pages else context.new_page()
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if self._context:
                self._context.close()
        except Exception:
            pass
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
        # 1) 等壳或验证码
        try:
            page.wait_for_function(
                """() => {
          const html = document.documentElement ? document.documentElement.outerHTML : '';
          const title = document.title || '';
          if (document.querySelector('.lemmaWgt-lemmaTitle')) return true;
          if (document.querySelector('.lemmaSummary, .J-summary')) return true;
          if (title.includes('安全验证') || html.includes('百度安全验证')) return true;
          if (html.includes('约为0') || html.includes('页面不存在') || html.includes('尚未收录')) return true;
          return document.readyState === 'complete';
        }""",
                timeout=min(self.timeout_ms, 25000),
            )
        except PlaywrightError:
            pass
        # 2) headless：再等「可用摘要」出现（避免只有空壳/通用站点介绍）
        if self.mode == "headless":
            try:
                page.wait_for_function(
                    USABLE_LEMMA_WAIT_JS,
                    timeout=min(self.timeout_ms, 20000),
                )
            except PlaywrightError:
                pass
            time.sleep(0.8)

    def goto_html(self, url, allow_captcha_wait=True, wait_lemma=False, fast=False):
        page = self.page
        page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
        if fast:
            time.sleep(2)
            html = page.content()
            title = page.title()
            final_url = page.url
            captcha_detected = _is_anti_crawl_page(html) or any(
                kw in title for kw in ("百度安全验证", "百度验证", "安全验证")
            )
            if allow_captcha_wait and captcha_detected and self.mode == "cdp":
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
            elif captcha_detected and self.mode == "headless":
                sys.stderr.write("[captcha] headless 检测到安全验证，无法人工过码，按 anti_crawl 处理\n")
                sys.stderr.flush()
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


# 兼容旧名
BaikeCdpSession = BaikeBrowserSession


def _profile_source(session) -> str:
    return "baike_crawler_headless" if getattr(session, "mode", "") == "headless" else "baike_crawler_cdp"


def _mode_tag(session) -> str:
    return "headless" if getattr(session, "mode", "") == "headless" else "cdp"


def _try_item_page_browser(session, name, fast_item_only=False):
    url = f"https://baike.baidu.com/item/{urllib.parse.quote(name)}"
    final_url, html = session.goto_html(url, wait_lemma=not fast_item_only, fast=fast_item_only)
    if fast_item_only and "/item/" not in final_url:
        return "no_lemma", None, html, final_url
    if _is_anti_crawl_page(html):
        return "anti_crawl", None, html, final_url
    if _is_no_lemma_page(html, final_url):
        return "no_lemma", None, html, final_url
    if not _page_has_lemma(html):
        return "no_lemma", None, html, final_url
    return "ok", html, html, final_url


def _finalize_item_success(session, name, html, final_url, fetch_suffix):
    fetch_mode = f"{_mode_tag(session)}_{fetch_suffix}"
    out = _success_from_item_page(name, html, final_url, fetch_mode=fetch_mode)
    out["profile_source"] = _profile_source(session)
    # HTML 正则抽不到时，尝试 DOM 文本
    if not _intro_is_usable(out.get("company_intro")) and getattr(session, "page", None):
        dom_intro = _dom_intro_text(session.page)
        if _intro_is_usable(dom_intro):
            out["company_intro"] = dom_intro
            if not _intro_is_usable(out.get("product_intro")):
                out["product_intro"] = dom_intro
            out["ok"] = True
            out["has_lemma"] = True
            out["lemma_status"] = "found"
            out["miss_reason"] = None
            out["fetch_mode"] = f"{fetch_mode}_dom"
    if not out.get("ok") and _page_has_lemma(html):
        intro = out.get("company_intro") or ""
        if _is_generic_baike_intro(intro):
            sys.stderr.write(
                f"[baike-browser] lemma_not_loaded {_diag_snapshot(session.page)}\n"
            )
            sys.stderr.flush()
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
            return _finalize_item_success(session, name, payload, final_url, "item")
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
                out = _finalize_item_success(session, name, item_html, item_final, "search_item")
                if out.get("ok") or out.get("miss_reason") != "anti_crawl":
                    return out
            if _is_no_lemma_page(item_html, item_final):
                return _failure(name, item_final, "no_lemma", "not_found", detail="no_lemma")
        if search_kind == "has_abstract" and _intro_is_usable(search_payload):
            out = _success_from_abstract(
                name, search_payload, search_url, fetch_mode=f"{_mode_tag(session)}_search_abstract"
            )
            out["profile_source"] = _profile_source(session)
            return out
        if search_kind == "has_lemma_html":
            return _finalize_item_success(session, name, search_html, search_url, "search_page")

        none_kind, none_payload, none_html, none_url = _fetch_search_none_browser(session, name)
        if none_kind == "no_lemma":
            return _failure(name, none_url, "no_lemma", "not_found", detail="no_lemma")
        if none_kind == "has_abstract" and _intro_is_usable(none_payload):
            out = _success_from_abstract(
                name, none_payload, none_url, fetch_mode=f"{_mode_tag(session)}_search_none"
            )
            out["profile_source"] = _profile_source(session)
            return out
        if none_kind == "has_results":
            item_final, item_html = session.goto_html(none_payload)
            if not _is_anti_crawl_page(item_html) and _page_has_lemma(item_html):
                return _finalize_item_success(session, name, item_html, item_final, "search_none_item")

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


def open_session(mode, cdp_url, captcha_wait_ms, timeout_ms):
    return BaikeBrowserSession(
        mode=mode,
        cdp_url=cdp_url,
        timeout_ms=timeout_ms,
        captcha_wait_ms=captcha_wait_ms,
    )


def run_batch(items, cdp_url, sleep_ms, captcha_wait_ms, timeout_ms, fast_item_only=False, mode=None):
    with open_session(mode, cdp_url, captcha_wait_ms, timeout_ms) as session:
        return run_batch_in_session(session, items, sleep_ms, fast_item_only=fast_item_only)


def run_worker(cdp_url, captcha_wait_ms, timeout_ms, mode=None):
    with open_session(mode, cdp_url, captcha_wait_ms, timeout_ms) as session:
        print(
            json.dumps({"ready": True, "mode": session.mode}, ensure_ascii=False),
            flush=True,
        )
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
    p = argparse.ArgumentParser(description="百度百科 Playwright 抓取（cdp / headless）")
    p.add_argument("--name", help="单条企业名称")
    p.add_argument("--batch", action="store_true", help="从 stdin 读取 JSON 数组 [{company_name}]")
    p.add_argument("--worker", action="store_true", help="常驻 worker：stdin 每行一批请求，stdout 每行结果")
    p.add_argument("--mode", default=None, help="cdp | headless（默认读 BAIKE_BROWSER_MODE / 自动推断）")
    p.add_argument("--cdp-url", default="http://127.0.0.1:9222", help="Chrome CDP 地址（仅 cdp 模式）")
    p.add_argument("--sleep-ms", type=int, default=1200, help="批内请求间隔（毫秒）")
    p.add_argument("--fast-item-only", action="store_true", help="仅直链 /item/，跳过 search 回退")
    p.add_argument("--captcha-wait-ms", type=int, default=15000, help="命中安全验证时额外等待（毫秒）")
    p.add_argument("--timeout-ms", type=int, default=30000, help="页面导航超时（毫秒）")
    args = p.parse_args()
    mode = _resolve_browser_mode(args.mode)

    if args.worker:
        run_worker(args.cdp_url, args.captcha_wait_ms, args.timeout_ms, mode=mode)
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
            mode=mode,
        )
        print(json.dumps(out, ensure_ascii=False))
        return

    if not args.name:
        raise SystemExit("请提供 --name、--batch 或 --worker")
    with open_session(mode, args.cdp_url, args.captcha_wait_ms, args.timeout_ms) as session:
        result = fetch_baike_browser(session, args.name, fast_item_only=args.fast_item_only)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
