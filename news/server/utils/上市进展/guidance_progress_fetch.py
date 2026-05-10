#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import io
import json
import os
import re
import shlex
import sys
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_pw_utils = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _pw_utils not in sys.path:
    sys.path.insert(0, _pw_utils)
from playwright_host import ensure_playwright_browser_path  # noqa: E402

DEFAULT_CSRC_GUIDANCE_URL = "http://eid.csrc.gov.cn/csrcfd/index_f.html"
RE_ONCLICK_DATE = re.compile(r"'(\d{4}-\d{2}-\d{2})'")
# 单元格内常见 2026-04-14 或 2026/04/14
RE_CELL_YMD = re.compile(r"(\d{4}[-/]\d{1,2}[-/]\d{1,2})")
TZ_SH = ZoneInfo("Asia/Shanghai")
PW_PAGE_BREAK = "\n<!--CSRC_GUIDANCE_PAGE_BREAK-->\n"


def _parse_iso_date(s):
    s = _norm_date(s)
    if not s or len(s) < 10:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _resolve_proxy_for_playwright():
    """从环境变量读取代理地址，返回 Playwright proxy 参数或 None。"""
    proxy_url = (
        os.environ.get("ALL_PROXY")
        or os.environ.get("HTTPS_PROXY")
        or os.environ.get("HTTP_PROXY")
        or ""
    ).strip()
    if not proxy_url:
        return None
    if not proxy_url.startswith(("http://", "https://", "socks5://", "socks5h://")):
        proxy_url = "http://" + proxy_url
    return proxy_url


def _bool_env(name, default=True):
    raw = os.environ.get(name, "1" if default else "0").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _strip_outer_quotes(s):
    t = str(s or "").strip()
    if len(t) >= 2 and t[0] == t[-1] and t[0] in ("'", '"'):
        return t[1:-1].strip()
    return t


def _parse_shell_like_args(s):
    t = _strip_outer_quotes(str(s or "").strip())
    if not t:
        return []
    try:
        return shlex.split(t, posix=True)
    except ValueError:
        return [t]


def _playwright_launch_args():
    """
    Playwright 启动参数合并顺序：
    - 固定基础参数（反自动化指纹）
    - PLAYWRIGHT_CHROMIUM_ARGS（Playwright 官方环境变量）
    - CSRC_GUIDANCE_PLAYWRIGHT_EXTRA_ARGS（项目自定义，shell-like）
    """
    base = ["--disable-blink-features=AutomationControlled"]
    merged = list(base)

    def extend_unique(items):
        for it in items:
            if not it:
                continue
            if it not in merged:
                merged.append(it)

    extend_unique(_parse_shell_like_args(os.environ.get("PLAYWRIGHT_CHROMIUM_ARGS", "")))
    extend_unique(_parse_shell_like_args(os.environ.get("CSRC_GUIDANCE_PLAYWRIGHT_EXTRA_ARGS", "")))
    return merged


def _is_packaged_chromium_wrapper(path):
    """Debian/Ubuntu 常见包装脚本路径（真实二进制一般在 /usr/lib/chromium/chromium）。"""
    if not path:
        return False
    p = path.strip()
    if p in ("/usr/bin/chromium", "/usr/bin/chromium-browser"):
        return True
    return os.path.basename(p) in ("chromium", "chromium-browser") and p.startswith("/usr/bin/")


def _resolve_chromium_executable():
    """
    Debian/Ubuntu 的 /usr/bin/chromium 常为包装脚本，在 Docker + Playwright 下易触发
    chrome_crashpad_handler: --database is required。优先使用包内真实二进制。
    """
    preferred = str(os.environ.get("CSRC_GUIDANCE_PLAYWRIGHT_EXECUTABLE", "")).strip()
    real_bins = [
        "/usr/lib/chromium/chromium",
        "/usr/lib64/chromium/chromium",
        "/usr/lib/chromium/chrome",
    ]
    fallbacks = ["/usr/bin/chromium", "/usr/bin/chromium-browser"]
    candidates = []
    # 自定义绝对路径（非发行版包装脚本）优先
    if preferred and not _is_packaged_chromium_wrapper(preferred):
        candidates.append(preferred)
    candidates.extend(real_bins)
    if preferred:
        candidates.append(preferred)
    for fb in fallbacks:
        if fb not in candidates:
            candidates.append(fb)

    seen = set()
    for p in candidates:
        if not p or p in seen:
            continue
        seen.add(p)
        try:
            rp = os.path.realpath(p)
        except OSError:
            rp = p
        if os.path.isfile(rp) and os.access(rp, os.X_OK):
            return rp
    return preferred or "/usr/lib/chromium/chromium"


def _playwright_launch_env():
    """继承进程环境，并为 crashpad 提供可写目录（部分容器缺省路径会异常）。"""
    env = dict(os.environ)
    db = str(env.get("CHROME_CRASHPAD_DATABASE", "")).strip()
    if not db:
        db = os.path.join(tempfile.gettempdir(), "chromium-crashpad-db")
    try:
        os.makedirs(db, mode=0o755, exist_ok=True)
    except OSError:
        pass
    env["CHROME_CRASHPAD_DATABASE"] = db
    return env


def _build_csrc_url_candidates(url):
    """构造证监会辅导页候选 URL，提升不同网络环境成功率。"""
    u = str(url or "").strip()
    if not u:
        return []
    out = [u]
    low = u.lower()
    if "eid.csrc.gov.cn/csrcfd/" in low:
        # 对证监会辅导页做 http/https + index/index_f 兜底尝试
        variants = [
            "http://eid.csrc.gov.cn/csrcfd/index_f.html",
            "https://eid.csrc.gov.cn/csrcfd/index_f.html",
            "http://eid.csrc.gov.cn/csrcfd/index.html",
            "https://eid.csrc.gov.cn/csrcfd/index.html",
        ]
        for v in variants:
            if v not in out:
                out.append(v)
    return out


def _fetch_html_playwright(page_url):
    """
    证监会辅导公示页为前端排序：模拟点击「备案时间」表头，使备案时间降序；
    若首条不在当前自然月则再点一次；无数据则刷新页面重试一轮。
    """
    try:
        from playwright.sync_api import sync_playwright  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError("未安装 playwright，请执行: pip install playwright && playwright install chromium") from e

    timeout_ms = int(os.environ.get("CSRC_GUIDANCE_PLAYWRIGHT_TIMEOUT_MS", "90000"))
    headless = os.environ.get("CSRC_GUIDANCE_PLAYWRIGHT_HEADLESS", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )
    proxy_url = _resolve_proxy_for_playwright()

    def click_filing_date_header(page):
        loc = page.locator('th[onclick*="filingDate"]').first
        loc.wait_for(state="visible", timeout=20000)
        loc.click(timeout=15000)

    def top_filing_dates_js():
        return """() => {
          const re = /(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})/;
          const seen = new Set();
          const trs = [];
          const add = (tr) => {
            if (!tr || seen.has(tr)) return;
            seen.add(tr);
            const st = tr.getAttribute('style') || '';
            if (/display\\s*:\\s*none/i.test(st)) return;
            trs.push(tr);
          };
          document.querySelectorAll('tr[onclick*="downloadPdf1"]').forEach(add);
          document.querySelectorAll('td[onclick*="downloadPdf1"]').forEach((td) => add(td.closest('tr')));
          const out = [];
          for (const tr of trs) {
            const tds = tr.querySelectorAll(':scope > td');
            let hit = '';
            for (const td of tds) {
              const t = (td.textContent || '').trim().replace(/\\s+/g, '');
              const m = t.match(re);
              if (m) { hit = m[1].replace(/\\//g, '-'); break; }
            }
            if (hit) out.push(hit);
            if (out.length >= 4) break;
          }
          return out;
        }"""

    def count_visible_rows(page):
        return page.evaluate(
            """() => {
          const seen = new Set();
          let n = 0;
          const add = (tr) => {
            if (!tr || seen.has(tr)) return;
            seen.add(tr);
            const st = tr.getAttribute('style') || '';
            if (/display\\s*:\\s*none/i.test(st)) return;
            n++;
          };
          document.querySelectorAll('tr[onclick*="downloadPdf1"]').forEach(add);
          document.querySelectorAll('td[onclick*="downloadPdf1"]').forEach((td) => add(td.closest('tr')));
          return n;
        }"""
        )

    def first_row_signature(page):
        return page.evaluate(
            """() => {
          const pickRows = () => {
            const seen = new Set();
            const trs = [];
            const add = (tr) => {
              if (!tr || seen.has(tr)) return;
              seen.add(tr);
              const st = tr.getAttribute('style') || '';
              if (/display\\s*:\\s*none/i.test(st)) return;
              trs.push(tr);
            };
            document.querySelectorAll('tr[onclick*="downloadPdf1"]').forEach(add);
            document.querySelectorAll('td[onclick*="downloadPdf1"]').forEach((td) => add(td.closest('tr')));
            return trs;
          };
          const trs = pickRows();
          if (!trs.length) return '';
          const t = (trs[0].innerText || trs[0].textContent || '').replace(/\\s+/g, ' ').trim();
          return t.slice(0, 160);
        }"""
        )

    def goto_next_page(page):
        """尝试翻到下一页，成功返回 True。"""
        next_candidates = [
            'a:has-text("下一页")',
            'a:has-text("下页")',
            'a[title*="下一页"]',
            '.pagination a.next',
            '.page a.next',
            'a.next',
        ]
        for sel in next_candidates:
            try:
                loc = page.locator(sel).first
                if loc.count() == 0:
                    continue
                cls = (loc.get_attribute("class") or "").lower()
                if "disabled" in cls:
                    continue
                text = (loc.inner_text(timeout=1200) or "").strip()
                if text and ("下一页" not in text and "下页" not in text and ">" not in text):
                    continue
                loc.click(timeout=4000)
                page.wait_for_timeout(int(os.environ.get("CSRC_GUIDANCE_AFTER_PAGE_MS", "1400")))
                return True
            except Exception:
                continue
        # 兜底：匹配 href/javascript 中含 next 的翻页控件
        try:
            js_hit = page.evaluate(
                """() => {
              const nodes = Array.from(document.querySelectorAll('a[onclick],a[href]'));
              for (const a of nodes) {
                const cls = (a.className || '').toLowerCase();
                if (cls.includes('disabled')) continue;
                const txt = (a.textContent || '').trim();
                const oc = (a.getAttribute('onclick') || '').toLowerCase();
                const href = (a.getAttribute('href') || '').toLowerCase();
                if (
                  txt.includes('下一页') || txt.includes('下页') ||
                  oc.includes('next') || href.includes('next')
                ) {
                  a.click();
                  return true;
                }
              }
              return false;
            }"""
            )
            if js_hit:
                page.wait_for_timeout(int(os.environ.get("CSRC_GUIDANCE_AFTER_PAGE_MS", "1400")))
                return True
        except Exception:
            pass
        return False

    def apply_sort_logic(page):
        """点击「备案时间」表头：保证降序；再校验首条日期须在本月或上月，否则继续点击并重校降序。"""
        today = datetime.now(TZ_SH).date()

        def read_dates():
            raw = page.evaluate(top_filing_dates_js())
            return [_parse_iso_date(x) for x in (raw or []) if x]

        def wait_after_click():
            page.wait_for_timeout(int(os.environ.get("CSRC_GUIDANCE_AFTER_CLICK_MS", "1200")))

        def ensure_descending():
            """首行备案日期应 >= 第二行（降序）；否则再点表头切换升降序。"""
            for _ in range(2):
                dates = read_dates()
                if len(dates) >= 2 and dates[0] and dates[1] and dates[0] < dates[1]:
                    click_filing_date_header(page)
                    wait_after_click()
                else:
                    break

        def first_row_in_current_or_previous_month(d0):
            """首条应在「今天所在自然月」或「上一个自然月」（上海时区）。"""
            if not d0:
                return False
            cur_y, cur_m = today.year, today.month
            if cur_m == 1:
                prev_y, prev_m = cur_y - 1, 12
            else:
                prev_y, prev_m = cur_y, cur_m - 1
            ym = (d0.year, d0.month)
            return ym == (cur_y, cur_m) or ym == (prev_y, prev_m)

        # 第一次：激活按备案时间排序
        click_filing_date_header(page)
        wait_after_click()
        ensure_descending()

        # 校验首条备案时间：须在本月或上月；否则再次点击「备案时间」，再校正降序（可多次）
        max_extra = max(
            1,
            int(os.environ.get("CSRC_GUIDANCE_FIRST_ROW_MONTH_RECHECK_CLICKS", "3")),
        )
        for attempt in range(max_extra):
            dates = read_dates()
            if not dates or not dates[0]:
                break
            if first_row_in_current_or_previous_month(dates[0]):
                break
            click_filing_date_header(page)
            wait_after_click()
            ensure_descending()

    html_holder = {"html": ""}

    ensure_playwright_browser_path()
    with sync_playwright() as p:
        launch_kwargs = {
            "headless": headless,
            "args": _playwright_launch_args(),
            "proxy": {"server": proxy_url} if proxy_url else None,
        }
        # 默认使用 PLAYWRIGHT_BROWSERS_PATH 下与当前 playwright 版本匹配的 Chromium（推荐）。
        # 仅当显式配置 CSRC_GUIDANCE_PLAYWRIGHT_EXECUTABLE 时才覆盖为系统浏览器（易与 Playwright 不兼容）。
        exe_override = str(os.environ.get("CSRC_GUIDANCE_PLAYWRIGHT_EXECUTABLE", "")).strip()
        if exe_override:
            launch_kwargs["executable_path"] = _resolve_chromium_executable()
            launch_kwargs["env"] = _playwright_launch_env()
        browser = p.chromium.launch(**launch_kwargs)
        try:
            ctx = browser.new_context(
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                ignore_https_errors=not _bool_env("CSRC_GUIDANCE_TLS_VERIFY", default=True),
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
            )
            page = ctx.new_page()
            for reload_pass in range(2):
                if reload_pass:
                    page.reload(wait_until="domcontentloaded", timeout=timeout_ms)
                    page.wait_for_timeout(2000)
                page.goto(page_url, wait_until="domcontentloaded", timeout=timeout_ms)
                page.wait_for_timeout(1500)
                try:
                    page.wait_for_selector(
                        'td[onclick*="downloadPdf1"], tr[onclick*="downloadPdf1"]',
                        timeout=25000,
                        state="attached",
                    )
                except Exception:
                    if reload_pass == 0:
                        continue
                    raise RuntimeError("辅导公示表格未加载（无数据行）")
                n0 = count_visible_rows(page)
                if n0 == 0 and reload_pass == 0:
                    continue
                apply_sort_logic(page)
                n1 = count_visible_rows(page)
                if n1 == 0 and reload_pass == 0:
                    continue
                page_htmls = [page.content()]
                paginate_enabled = _bool_env("CSRC_GUIDANCE_PAGINATE", default=True)
                max_pages = max(
                    1,
                    int(os.environ.get("CSRC_GUIDANCE_MAX_PAGES", "30")),
                )
                if paginate_enabled and max_pages > 1:
                    last_sig = first_row_signature(page)
                    for _ in range(max_pages - 1):
                        moved = goto_next_page(page)
                        if not moved:
                            break
                        try:
                            page.wait_for_selector(
                                'td[onclick*="downloadPdf1"], tr[onclick*="downloadPdf1"]',
                                timeout=12000,
                                state="attached",
                            )
                        except Exception:
                            break
                        cur_sig = first_row_signature(page)
                        if cur_sig and cur_sig == last_sig:
                            break
                        last_sig = cur_sig or last_sig
                        page_htmls.append(page.content())
                html_holder["html"] = PW_PAGE_BREAK.join(page_htmls)
                break
            if not html_holder["html"]:
                html_holder["html"] = page.content()
        finally:
            browser.close()

    if not html_holder["html"]:
        raise RuntimeError("Playwright 未取得页面 HTML")
    return html_holder["html"]


def _norm_date(v):
    s = str(v or "").strip()
    if not s:
        return ""
    s = s.replace("/", "-").replace(".", "-").replace("年", "-").replace("月", "-").replace("日", "")
    if len(s) >= 10:
        s = s[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%Y-%m-%d")
    except Exception:
        return ""


def _extract_csrc_guidance_company_name(s):
    """报告标题/混写文案 → 仅保留公司全称（与 Node extractCsrcGuidanceCompanyName 对齐）。
    注意：如果输入已经是公司名称（如从辅导对象列获取），直接返回，不做额外提取。
    """
    t = str(s or "").strip()
    if not t:
        return ""
    # 如果输入不包含"报告"、"辅导"等关键字，说明已经是公司名称，直接返回
    report_keywords = ("报告", "辅导备案", "辅导工作", "首次公开发行", "公开发行")
    if not any(kw in t for kw in report_keywords):
        return t
    # 从报告标题中提取公司名称
    if t.startswith("关于"):
        t = t[2:].strip()
    suffixes = (
        "首次公开发行股票并上市辅导备案报告",
        "首次公开发行股票并在科创板上市辅导备案报告",
        "首次公开发行股票并在创业板上市辅导备案报告",
        "辅导备案报告",
        "辅导工作进展情况报告",
        "辅导工作进展报告",
        "辅导工作总结报告",
        "上市辅导备案报告",
        "公开发行辅导备案报告",
    )
    for suf in suffixes:
        i = t.find(suf)
        if i > 0:
            t = t[:i]
            break
    else:
        for key in (
            "首次公开发行股票",
            "首次公开发行",
            "公开发行股票并上市",
            "辅导工作进展",
            "上市辅导",
        ):
            i = t.find(key)
            if i > 0:
                t = t[:i]
                break
    t = re.sub(r"（[^）]{0,40}）\s*$", "", t)
    t = re.sub(r"\([^)]{0,40}\)\s*$", "", t)
    return t.strip()


def _pick(d, names):
    for n in names:
        if n in d:
            return d.get(n)
    return None


def _build_rows(df, start_date, end_date):
    rows = []
    for _, r in df.iterrows():
        d = r.to_dict()
        # 优先从辅导对象列获取公司名称（第一列），其次是企业名称、公司名称等
        company = _extract_csrc_guidance_company_name(
            str(_pick(d, ["辅导对象", "企业名称", "公司名称", "公司", "发行人", "名称"]) or "").strip()
        )
        if not company:
            continue
        # 证监会公开发行辅导公示常见字段为「备案时间」
        record_date = _norm_date(
            _pick(d, ["辅导备案日期", "备案日期", "备案时间", "受理日期", "日期", "时间"])
        )
        if not record_date:
            continue
        if record_date < start_date or record_date > end_date:
            continue
        status = str(
            _pick(d, ["当前状态", "辅导状态", "进度状态", "状态"]) or "辅导备案"
        ).strip() or "辅导备案"
        dispatch_office = str(
            _pick(d, ["派出机构", "证监局", "辅导机构所在派出机构"]) or ""
        ).strip()
        board = str(_pick(d, ["拟上市板块", "板块", "上市板块"]) or "").strip()
        code = str(_pick(d, ["证券代码", "股票代码", "代码"]) or "").strip()
        rows.append(
            {
                "company": company,
                "record_date": record_date,
                "status": status,
                "register_address": dispatch_office,
                "board": board,
                "code": code,
            }
        )
    return rows


def _td_cell_text(td):
    if not td:
        return ""
    ti = (td.get("title") or "").strip()
    if ti:
        return ti
    return (td.get_text() or "").strip()


def _td_cell_text_counseling_target(td):
    """辅导对象列：官网常见重复 title（先全文报告名、后公司名），解析器只保留首个 title。
    优先取单元格可见文本；仅当正文为空时再退回 title（兼容折叠行仅 title 有值）。"""
    if not td:
        return ""
    text = (td.get_text() or "").strip()
    if text:
        return text
    return (td.get("title") or "").strip()


def _parse_csrcfd_table_header(table):
    """从含「备案时间」的表头行解析列下标（与公开发行辅导公示等页面一致）。"""
    for tr in table.find_all("tr", limit=40):
        ths = tr.find_all("th")
        cells = ths if len(ths) >= 3 else tr.find_all(["th", "td"])
        if len(cells) < 3:
            continue
        labels = [re.sub(r"\s+", "", (c.get_text() or "").strip()) for c in cells]
        if not any("备案时间" in lb for lb in labels):
            continue
        idx = {}
        for i, lab in enumerate(labels):
            # 辅导对象列（第一列），可能命名为"辅导对象"、"企业名称"、"公司名称"等
            if "辅导对象" in lab or "企业名称" in lab or "公司名称" in lab or "公司" in lab:
                idx["company"] = i
            if "备案时间" in lab:
                idx["date"] = i
            if "辅导状态" in lab:
                idx["status"] = i
            if "派出机构" in lab:
                idx["dispatch"] = i
            if "报告类型" in lab:
                idx["board"] = i
        # 必须找到日期列，公司列尽量找（如果没有则使用第一列作为fallback）
        if "date" in idx:
            if "company" not in idx:
                # fallback: 使用第一列作为公司名称列
                idx["company"] = 0
            return idx, len(cells)
    return None, 0


def _first_ymd_in_tds(tds):
    for i, td in enumerate(tds):
        m = RE_CELL_YMD.search(_td_cell_text(td))
        if m:
            d = _norm_date(m.group(1))
            if d:
                return d, i
    return "", -1


def _iter_guidance_data_trs(soup):
    """downloadPdf1 可能挂在 tr 或 td 上（公开发行辅导公示常见为 td）。"""
    seen = set()
    for tag in soup.find_all(attrs={"onclick": True}):
        oc = tag.get("onclick") or ""
        if "downloadpdf1" not in oc.lower():
            continue
        tr = tag if tag.name == "tr" else tag.find_parent("tr")
        if tr is None:
            continue
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 2:
            continue
        tid = id(tr)
        if tid in seen:
            continue
        seen.add(tid)
        yield tr


def _row_onclick_pdf(tr):
    o = (tr.get("onclick") or "").strip()
    if "downloadpdf1" in o.lower():
        return o
    for td in tr.find_all("td", recursive=False):
        o = (td.get("onclick") or "").strip()
        if "downloadpdf1" in o.lower():
            return o
    return ""


def _company_from_tds_backward(tds, before_idx):
    for j in range(min(before_idx, len(tds)) - 1, -1, -1):
        c = _td_cell_text_counseling_target(tds[j])
        if not c or len(c) < 2:
            continue
        if "报告" in c or "进展" in c:
            continue
        if RE_CELL_YMD.search(c.strip()):
            continue
        return c
    return ""


def _rows_from_csrcfd_dom(html, start_date, end_date):
    """证监会辅导备案列表：含 downloadPdf1 的 tr（onclick 常在 td 上）；列位按表头或扫描日期。"""
    from bs4 import BeautifulSoup  # noqa: PLC0415

    soup = BeautifulSoup(html, "lxml")
    table_header_cache = {}
    out = []

    for tr in _iter_guidance_data_trs(soup):
        oc = _row_onclick_pdf(tr)
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 3:
            continue

        table = tr.find_parent("table")
        hidx, n_th = (None, 0)
        if table is not None:
            tid = id(table)
            if tid not in table_header_cache:
                table_header_cache[tid] = _parse_csrcfd_table_header(table)
            hidx, n_th = table_header_cache[tid]

        record_date = ""
        company = ""
        status = "辅导备案"
        dispatch = ""
        board = ""
        date_col_idx = -1

        prefix = max(0, len(tds) - n_th) if n_th else 0

        if hidx and n_th:
            ci = prefix + hidx["company"]
            di = prefix + hidx["date"]
            if ci < len(tds):
                company = _td_cell_text_counseling_target(tds[ci])
            if di < len(tds):
                m = RE_CELL_YMD.search(_td_cell_text(tds[di]))
                if m:
                    record_date = _norm_date(m.group(1))
                    date_col_idx = di
            si = prefix + hidx.get("status", 999)
            if si < len(tds):
                status = _td_cell_text(tds[si]) or "辅导备案"
            gi = prefix + hidx.get("dispatch", 999)
            if gi < len(tds):
                dispatch = _td_cell_text(tds[gi])
            bi = prefix + hidx.get("board", 999)
            if bi < len(tds):
                board = _td_cell_text(tds[bi])

        if not record_date:
            record_date, date_col_idx = _first_ymd_in_tds(tds)
            if not record_date:
                date_col_idx = -1

        if not record_date:
            for m in RE_ONCLICK_DATE.finditer(oc):
                d = _norm_date(m.group(1))
                if d:
                    record_date = d
                    break

        if not company and date_col_idx >= 0:
            company = _company_from_tds_backward(tds, date_col_idx)
        if not company:
            for td in tds:
                raw = _td_cell_text_counseling_target(td)
                if raw and len(raw) >= 4 and "报告" not in raw and "进展" not in raw:
                    company = raw
                    break
        if not company:
            continue
        if not record_date:
            continue
        if record_date < start_date or record_date > end_date:
            continue

        out.append(
            {
                "company": _extract_csrc_guidance_company_name(company.strip()),
                "record_date": record_date,
                "status": (status or "辅导备案").strip() or "辅导备案",
                "register_address": dispatch.strip(),
                "board": board.strip(),
                "code": "",
            }
        )
    return out


def _read_html_source(url, use_playwright=True):
    import pandas as pd  # noqa: PLC0415
    import requests  # noqa: PLC0415

    if not url:
        raise RuntimeError("source=html 但未配置 CSRC_GUIDANCE_PAGE_URL")

    html = None
    fetch_via = "requests"
    candidates = _build_csrc_url_candidates(url)
    tls_verify = _bool_env("CSRC_GUIDANCE_TLS_VERIFY", default=True)

    pw_ok = (
        use_playwright
        and os.environ.get("CSRC_GUIDANCE_USE_PLAYWRIGHT", "1").strip().lower()
        not in ("0", "false", "no")
        and "eid.csrc.gov.cn" in (url or "").lower()
    )
    require_pw = _bool_env("CSRC_GUIDANCE_REQUIRE_PLAYWRIGHT", default=False)
    if pw_ok:
        last_pw_err = None
        for candidate_url in candidates:
            try:
                html = _fetch_html_playwright(candidate_url)
                fetch_via = f"playwright:{candidate_url}"
                break
            except Exception as e:
                last_pw_err = e
        if html is None and last_pw_err is not None:
            print(
                f"[guidance_progress_fetch] Playwright 拉取失败，回退 requests: {last_pw_err}",
                file=sys.stderr,
            )
            if require_pw:
                raise RuntimeError(
                    f"Playwright 拉取失败且已启用 CSRC_GUIDANCE_REQUIRE_PLAYWRIGHT=1: {last_pw_err}"
                )

    def looks_like_guidance_payload(raw_html):
        t = str(raw_html or "")
        low = t.lower()
        if "downloadpdf1" in low:
            return True
        key_hit = 0
        for k in ("辅导对象", "备案时间", "辅导状态", "派出机构"):
            if k in t:
                key_hit += 1
        return key_hit >= 2

    if html is None:
        try:
            import urllib3  # noqa: PLC0415

            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        except Exception:
            pass
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": "http://eid.csrc.gov.cn/",
            "Connection": "keep-alive",
        }
        # requests 支持从环境变量 HTTP_PROXY/HTTPS_PROXY 读取代理
        errs = []
        for candidate_url in candidates:
            try:
                resp = requests.get(candidate_url, headers=headers, timeout=30, verify=tls_verify)
                resp.raise_for_status()
                body = resp.text
                if not looks_like_guidance_payload(body):
                    errs.append(f"{candidate_url}: non-guidance-page")
                    continue
                html = body
                fetch_via = f"requests:{candidate_url}:verify={int(bool(tls_verify))}"
                break
            except requests.exceptions.SSLError as e:
                errs.append(f"{candidate_url} SSL: {e}")
                if tls_verify:
                    try:
                        resp = requests.get(candidate_url, headers=headers, timeout=30, verify=False)
                        resp.raise_for_status()
                        body = resp.text
                        if not looks_like_guidance_payload(body):
                            errs.append(f"{candidate_url} verify=0: non-guidance-page")
                            continue
                        html = body
                        fetch_via = f"requests:{candidate_url}:verify=0"
                        break
                    except Exception as e2:
                        errs.append(f"{candidate_url} verify=0: {e2}")
            except Exception as e:
                errs.append(f"{candidate_url}: {e}")
        if html is None:
            raise RuntimeError(" ; ".join(errs[-6:]) or "请求证监会页面失败")
    df = None
    try:
        # 必须包一层 StringIO：否则部分环境会把长 HTML 当成「文件路径」触发 ENOENT
        tables = pd.read_html(io.StringIO(html))
        if tables:
            expected_cols = ("辅导对象", "备案时间", "备案日期", "辅导状态", "派出机构")
            picked = []
            for t in tables:
                cols = [str(c).strip() for c in t.columns]
                if any(any(ec in c for ec in expected_cols) for c in cols):
                    picked.append(t)
            using = picked if picked else tables
            df = using[0] if len(using) == 1 else pd.concat(using, ignore_index=True)
    except (ValueError, ImportError, OSError, FileNotFoundError):
        df = None
    return html, df, fetch_via


def _read_source(url, csv_path, source_mode, use_playwright=True):
    import pandas as pd  # noqa: PLC0415

    mode = (source_mode or "html").strip().lower()
    if mode == "csv":
        if not csv_path:
            raise RuntimeError("source=csv 但未配置 CSRC_GUIDANCE_CSV_PATH")
        return None, pd.read_csv(csv_path, encoding="utf-8"), "csv"
    if mode != "html":
        raise RuntimeError(f"不支持的 source 模式: {source_mode}")
    html, df, fetch_via = _read_html_source(url, use_playwright=use_playwright)
    return html, df, f"html-{fetch_via}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--start-date", required=True)
    p.add_argument("--end-date", required=True)
    p.add_argument(
        "--url",
        default=os.environ.get("CSRC_GUIDANCE_PAGE_URL", DEFAULT_CSRC_GUIDANCE_URL).strip(),
    )
    p.add_argument("--csv", default=os.environ.get("CSRC_GUIDANCE_CSV_PATH", "").strip())
    p.add_argument("--source", default=os.environ.get("CSRC_GUIDANCE_SOURCE", "html").strip())
    p.add_argument(
        "--no-playwright",
        action="store_true",
        help="禁用浏览器模拟（仅用 requests 拉 HTML）",
    )
    args = p.parse_args()

    start_date = args.start_date.strip()[:10]
    end_date = args.end_date.strip()[:10]
    url = args.url
    csv_path = args.csv
    source_mode = args.source
    if not csv_path and not url:
        raise RuntimeError("未提供数据源，请设置 CSRC_GUIDANCE_PAGE_URL 或 CSRC_GUIDANCE_CSV_PATH")

    use_pw = not getattr(args, "no_playwright", False)
    html_snap, df, source_name = _read_source(url, csv_path, source_mode, use_playwright=use_pw)
    rows = []
    parser_note = source_name
    source_rows = 0

    if source_name == "csv":
        source_rows = int(len(df.index))
        rows = _build_rows(df, start_date, end_date)
    else:
        if df is not None:
            source_rows = int(len(df.index))
            rows = _build_rows(df, start_date, end_date)
        # 辅导公示 DOM 解析更可靠：只要页面含列表脚本，优先采用 DOM 结果（覆盖 pandas 列名错位）
        if html_snap and "downloadpdf1" in html_snap.lower():
            html_parts = (
                [x for x in html_snap.split(PW_PAGE_BREAK) if x.strip()]
                if PW_PAGE_BREAK in html_snap
                else [html_snap]
            )
            dom_rows = []
            seen = set()
            for part in html_parts:
                chunk_rows = _rows_from_csrcfd_dom(part, start_date, end_date)
                for r in chunk_rows:
                    key = (
                        str(r.get("company", "")).strip(),
                        str(r.get("record_date", "")).strip(),
                        str(r.get("status", "")).strip(),
                    )
                    if key in seen:
                        continue
                    seen.add(key)
                    dom_rows.append(r)
            if dom_rows:
                rows = dom_rows
                parser_note = f"{source_name}-dom"
                source_rows = len(dom_rows)

    if not rows:
        if source_name == "csv":
            raise RuntimeError("CSV 在指定日期窗口内无有效行，请检查列名与日期列")
        if not html_snap or "downloadpdf1" not in html_snap.lower():
            raise RuntimeError(
                "页面中未发现辅导备案列表，请检查 CSRC_GUIDANCE_PAGE_URL 是否为证监会辅导公示页"
            )

    print(
        json.dumps(
            {
                "ok": True,
                "source": parser_note,
                "sourceRows": source_rows,
                "builtRows": len(rows),
                "rows": rows,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        msg = str(e).strip()
        if len(msg) > 800:
            msg = msg[:800] + "…"
        print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
