#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
港交所 IPO 申请数据 → 上市库 ipo_progress

数据来源（按配置）：
1) 默认 hkex-web：港交所官网 consolidated index xlsx +「新上市信息」HTML；
2) --source akshare：AkShare hk_ipo_application()（若不存在则回退 hkex-web，除非 HK_IPO_DISABLE_HKEX_FALLBACK=1）；
3) 环境变量 HK_IPO_CSV_PATH 或命令行 --csv：手工 UTF-8 CSV（优先级最高）。

与 news/server/utils/listing/listingExchangeCrawler.js 中 insertRows 规则对齐：
业务唯一键 exchange + company + status + board + 更新日历日（DATE(f_update_time)）；同一递表可在不同日期多条。

环境变量（与 Node db.js 一致）：DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

HK_IPO_SOURCE / --source：默认 hkex-web；设为 akshare 时用 AkShare（失败再回退官网）。CSV 见 HK_IPO_CSV_PATH。

HK_IPO_DISABLE_LISTING_DISCLOSURE_MERGE：设为 1/true 时不合并披露易 91000 类（申请版本/整体协调人/聆讯后数据集）增量行。
HK_IPO_DISCLOSURE_ROW_RANGE：单次 titleSearchServlet 拉取条数上限，默认 1000。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pandas as pd
import pymysql

# ---------- 繁简转换（与 zhconvUtils.js 共享映射表）----------
from zh_t2s import load_t2s_mapping, to_simplified as _to_simplified

# ---------- 列名候选（与 hk_ipo_application 常见字段及手工导出表头兼容）----------

COL_APPLY_DATE = ("申请日期", "递交申请日期", "申请日期(YYYY-MM-DD)")
COL_HEARING_DATE = ("通过聆讯日期", "聆讯通过日期")
COL_LIST_DATE = ("上市日期",)
COL_STATUS_UPD_DATE = ("申请状态更新日期", "状态更新日期", "申请状态更新日")
COL_STATUS = ("申请状态", "状态")
COL_COMPANY = ("公司全称", "公司名称", "发行人名称", "名称")
COL_SHORT = ("股票简称", "简称", "股份简称")
COL_CODE = ("股票代码", "股份代号", "代码")
COL_BOARD = ("板块", "上市板块", "市场")
COL_REG = ("注册地", "注册地点", "注册地/国家/地区")

EXCHANGE_HK = "港交所"
STATUS_END_SET = frozenset({"失效", "撤回", "拒绝", "发回"})


def _pick_col(cols: Sequence[str], candidates: Tuple[str, ...]) -> Optional[str]:
    s = set(cols)
    for c in candidates:
        if c in s:
            return c
    return None


def _norm_ymd(v: Any) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    t = str(v).strip()
    if not t:
        return ""
    t = t.replace(".", "/").replace("-", "/")
    for fmt in ("%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(t[:10], fmt).strftime("%Y-%m-%d")
        except Exception:
            continue
    s = str(v).strip()[:10]
    return s if len(s) == 10 and s[4:5] == "-" and s[7:8] == "-" else ""


def _board_zh(v: Any) -> str:
    s = str(v or "").strip()
    if not s:
        return "主板"
    if len(s) > 20:
        s = s[:20]
    u = s.upper()
    if "GEM" in u or "創業" in s or "创业" in s:
        return "GEM"
    return s


def _parse_dt_ms(s: str) -> Optional[int]:
    if not s:
        return None
    try:
        t = datetime.fromisoformat(s.replace("T", " ")[:19])
        return int(t.timestamp() * 1000)
    except Exception:
        try:
            t = datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
            return int(t.timestamp() * 1000)
        except Exception:
            return None


def load_hk_ipo_dataframe(csv_path: Optional[str], source: str) -> Tuple[pd.DataFrame, str]:
    """返回 (DataFrame, 实际数据源标签)。默认官网；source=akshare 时用 AkShare，无 hk_ipo_application 则回退官网（除非禁用回退）。"""
    if csv_path:
        path = os.path.abspath(csv_path)
        if not os.path.isfile(path):
            raise FileNotFoundError(f"CSV 不存在: {path}")
        return pd.read_csv(path, encoding="utf-8-sig"), "csv"

    src = (source or "hkex-web").strip().lower()
    if src in ("hkex-web", "hkex", "web"):
        from hkex_ipo_scraper import fetch_hkex_web_combined_dataframe  # noqa: PLC0415

        return fetch_hkex_web_combined_dataframe(), "hkex-web"

    import akshare as ak  # noqa: PLC0415

    fn = getattr(ak, "hk_ipo_application", None)
    if not callable(fn):
        off = os.environ.get("HK_IPO_DISABLE_HKEX_FALLBACK", "").strip().lower()
        if off in ("1", "true", "yes"):
            raise RuntimeError(
                "当前 akshare 未提供 hk_ipo_application()，且已禁用港交所回退（HK_IPO_DISABLE_HKEX_FALLBACK）。"
                "可升级 akshare、设置 HK_IPO_SOURCE=hkex-web，或使用 --csv / HK_IPO_CSV_PATH。"
            )
        from hkex_ipo_scraper import fetch_hkex_web_combined_dataframe  # noqa: PLC0415

        print(
            "[hk_ipo_sync] akshare has no hk_ipo_application; fallback to HKEX new-listing HTML.",
            file=sys.stderr,
        )
        return fetch_hkex_web_combined_dataframe(), "hkex-web-fallback"
    return fn(), "akshare"


def daterange_inclusive(a: str, b: str) -> List[str]:
    x = date.fromisoformat(a[:10])
    y = date.fromisoformat(b[:10])
    if x > y:
        raise ValueError("start-date 不能晚于 end-date")
    out: List[str] = []
    cur = x
    while cur <= y:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


def build_rows_for_day(df: pd.DataFrame, today: str) -> List[Dict[str, Any]]:
    cols = list(df.columns)
    c_apply = _pick_col(cols, COL_APPLY_DATE)
    c_hear = _pick_col(cols, COL_HEARING_DATE)
    c_list = _pick_col(cols, COL_LIST_DATE)
    c_sud = _pick_col(cols, COL_STATUS_UPD_DATE)
    c_stat = _pick_col(cols, COL_STATUS)
    c_comp = _pick_col(cols, COL_COMPANY)
    c_short = _pick_col(cols, COL_SHORT)
    c_code = _pick_col(cols, COL_CODE)
    c_board = _pick_col(cols, COL_BOARD)
    c_reg = _pick_col(cols, COL_REG)

    need = [c_apply, c_hear, c_list, c_sud, c_stat]
    if any(x is None for x in need):
        raise RuntimeError(f"数据表缺少必要列，当前列: {cols!r}")

    rows_out: List[Dict[str, Any]] = []
    seen_key: set[Tuple[str, str, str, str]] = set()

    for _, row in df.iterrows():
        apply_d = _norm_ymd(row.get(c_apply))
        hear_d = _norm_ymd(row.get(c_hear))
        list_d = _norm_ymd(row.get(c_list))
        sud_d = _norm_ymd(row.get(c_sud))
        st_raw = str(row.get(c_stat) or "").strip() or "-"

        kinds: List[str] = []
        if apply_d == today:
            kinds.append("新递表")
        if hear_d == today:
            kinds.append("通过聆讯")
        if list_d == today:
            kinds.append("上市")
        elif sud_d == today and st_raw == "新上市":
            # 港交所网页等来源：上市日期与状态更新日同一列（如仅「申请状态更新日期」有值）
            kinds.append("上市")
        if sud_d == today and st_raw in STATUS_END_SET:
            kinds.append("状态变更")
        if sud_d == today and st_raw == "處理中":
            kinds.append("披露更新")
        if not kinds:
            continue

        company = str(row.get(c_comp) or "").strip() if c_comp else ""
        if not company:
            continue
        company = _to_simplified(company)
        short = str(row.get(c_short) or "").strip() if c_short else ""
        short = _to_simplified(short)
        code = str(row.get(c_code) or "").strip() if c_code else ""
        board = _board_zh(row.get(c_board)) if c_board else "主板"
        reg = str(row.get(c_reg) or "").strip() if c_reg else ""
        receive = None

        for ek in kinds:
            status = st_raw
            key = (EXCHANGE_HK, company, status, board)
            if key in seen_key:
                status = f"{st_raw}（{ek}）"
                if len(status) > 50:
                    status = status[:50]
                key = (EXCHANGE_HK, company, status, board)
            seen_key.add(key)

            f_update = f"{today} 00:00:00"
            receive = today
            rows_out.append(
                {
                    "exchange": EXCHANGE_HK,
                    "board": board,
                    "company": company,
                    "project_name": short or company,
                    "status": status,
                    "register_address": reg,
                    "code": code,
                    "receive_date": receive,
                    "f_update_time": f_update,
                    "_event_kind": ek,
                }
            )
    return rows_out


def sample_row_dates_for_debug(df: pd.DataFrame, limit: int = 8) -> List[Dict[str, str]]:
    """同步区间未生成任何待写行时，输出样例行的日期字段，便于核对港交所 PDF 路径日期是否在区间内。"""
    cols = list(df.columns)
    c_apply = _pick_col(cols, COL_APPLY_DATE)
    c_hear = _pick_col(cols, COL_HEARING_DATE)
    c_list = _pick_col(cols, COL_LIST_DATE)
    c_sud = _pick_col(cols, COL_STATUS_UPD_DATE)
    c_stat = _pick_col(cols, COL_STATUS)
    c_comp = _pick_col(cols, COL_COMPANY)
    out: List[Dict[str, str]] = []
    for _, row in df.head(limit).iterrows():
        out.append(
            {
                "company": (str(row.get(c_comp) or "").strip()[:120] if c_comp else ""),
                "apply": _norm_ymd(row.get(c_apply)) if c_apply else "",
                "hear": _norm_ymd(row.get(c_hear)) if c_hear else "",
                "list": _norm_ymd(row.get(c_list)) if c_list else "",
                "statusUpd": _norm_ymd(row.get(c_sud)) if c_sud else "",
                "status": (str(row.get(c_stat) or "").strip()[:40] if c_stat else ""),
            }
        )
    return out


def get_db_conf() -> Dict[str, Any]:
    host = os.environ.get("DB_HOST", "localhost")
    port = int(os.environ.get("DB_PORT", "3306") or 3306)
    user = os.environ.get("DB_USER", "root")
    password = os.environ.get("DB_PASSWORD", "")
    name = os.environ.get("DB_NAME", "investment_tools")
    return {"host": host, "port": port, "user": user, "password": password, "database": name, "charset": "utf8mb4"}


def fetch_admin_id(conn: pymysql.connections.Connection) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT F_Id FROM users WHERE account = 'admin' LIMIT 1")
        r = cur.fetchone()
        if not r:
            raise RuntimeError("未找到 account=admin 用户，无法写入 ipo_progress")
        return str(r[0])


def _recv_ymd(v: Any) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if hasattr(v, "strftime"):
        try:
            return v.strftime("%Y-%m-%d")
        except Exception:
            return ""
    return str(v).strip()[:10]


def _hk_row_log_payload(r: Dict[str, Any]) -> Dict[str, str]:
    """供日志 / JSON 输出的港股同行字段（截断避免单行过长）。"""
    return {
        "exchange": str(r.get("exchange") or EXCHANGE_HK),
        "board": str(r.get("board") or ""),
        "status": str(r.get("status") or ""),
        "company": str(r.get("company") or "")[:400],
        "project_name": str(r.get("project_name") or "")[:200],
        "f_update_time": str(r.get("f_update_time") or "")[:19],
        "receive_date": _recv_ymd(r.get("receive_date")),
        "code": str(r.get("code") or ""),
        "register_address": str(r.get("register_address") or "")[:200],
        "event_kind": str(r.get("_event_kind") or ""),
    }


def insert_rows_mysql(rows: List[Dict[str, Any]], admin_id: str, dry_run: bool) -> Dict[str, Any]:
    inserted = 0
    updated_earlier = 0
    skipped = 0
    skipped_no_company = 0
    skipped_no_date = 0
    skipped_dup = 0

    row_outcomes: List[Dict[str, Any]] = []

    if dry_run:
        return {
            "inserted": 0,
            "updatedEarlier": 0,
            "skipped": 0,
            "skipBreakdown": {
                "skippedNoCompany": 0,
                "skippedNoDate": 0,
                "skippedDupSameOrLater": 0,
            },
            "dryRun": True,
            "writeRowOutcomes": [],
        }

    if not rows:
        return {
            "inserted": 0,
            "updatedEarlier": 0,
            "skipped": 0,
            "skipBreakdown": {
                "skippedNoCompany": 0,
                "skippedNoDate": 0,
                "skippedDupSameOrLater": 0,
            },
            "dryRun": False,
            "writeRowOutcomes": [],
        }

    conf = get_db_conf()
    conn = pymysql.connect(**conf)
    try:
        admin = admin_id
        for r in rows:
            company = (r.get("company") or "").strip()
            if not company:
                skipped_no_company += 1
                skipped += 1
                row_outcomes.append({"action": "skipped_no_company", "row": _hk_row_log_payload(r)})
                continue
            date_str = str(r.get("f_update_time") or "")[:10]
            if not date_str:
                skipped_no_date += 1
                skipped += 1
                row_outcomes.append({"action": "skipped_no_date", "row": _hk_row_log_payload(r)})
                continue
            exchange = str(r.get("exchange") or "").strip()
            status = str(r.get("status") or "-").strip() or "-"
            board = str(r.get("board") or "").strip()
            new_ts = _parse_dt_ms(str(r.get("f_update_time") or f"{date_str} 00:00:00"))
            if new_ts is None:
                skipped_no_date += 1
                skipped += 1
                row_outcomes.append({"action": "skipped_bad_timestamp", "row": _hk_row_log_payload(r)})
                continue

            # 与 listingExchangeCrawler.insertRows 一致：业务键含「更新日历日」，同一公司同状态可在不同日期多条。
            # 旧逻辑按 exchange+company+status+board 只取最早一行比对 new_ts，会把「更早日期已有递表」误判为已覆盖，
            # 从而跳过本次应新增的日历日（日志里常表现为 builtRows 较大但 inserted 很少）。
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT f_id, f_update_time, code, project_name, register_address, receive_date
                       FROM ipo_progress
                       WHERE F_DeleteMark = 0 AND exchange = %s AND company = %s AND status = %s AND board = %s
                         AND DATE(f_update_time) = %s
                       ORDER BY f_id ASC LIMIT 1""",
                    (exchange, company, status, board, date_str),
                )
                existing_same_day = cur.fetchall()

            if existing_same_day:
                row_ex = existing_same_day[0]
                fid = row_ex[0]
                old_code_s = str(row_ex[2] or "").strip()
                old_pn_s = str(row_ex[3] or "").strip()
                old_reg_s = str(row_ex[4] or "").strip()
                old_recv_s = _recv_ymd(row_ex[5])
                new_code = str(r.get("code") or "").strip()
                new_pn = str(r.get("project_name") or company).strip()
                new_reg = str(r.get("register_address") or "").strip()
                new_recv_s = _recv_ymd(r.get("receive_date"))
                need_refresh = (
                    (old_recv_s != new_recv_s and new_recv_s)
                    or (not old_code_s and new_code)
                    or (not old_pn_s and new_pn)
                    or (not old_reg_s and new_reg)
                )
                if need_refresh:
                    recv_out = row_ex[5]
                    if old_recv_s != new_recv_s and new_recv_s:
                        recv_out = r.get("receive_date")
                    cur_rf = conn.cursor()
                    cur_rf.execute(
                        """UPDATE ipo_progress SET
                             code = %s, project_name = %s, register_address = %s, receive_date = %s,
                             F_LastModifyUserId = %s, F_LastModifyTime = NOW()
                           WHERE f_id = %s AND F_DeleteMark = 0""",
                        (
                            new_code or old_code_s,
                            new_pn or old_pn_s,
                            new_reg or old_reg_s,
                            recv_out,
                            admin,
                            fid,
                        ),
                    )
                    conn.commit()
                    updated_earlier += 1
                    row_outcomes.append({"action": "refreshed_same_day", "row": _hk_row_log_payload(r)})
                else:
                    row_outcomes.append({"action": "skipped_same_day_exists", "row": _hk_row_log_payload(r)})
                skipped_dup += 1
                skipped += 1
                continue

            cur3 = conn.cursor()
            cur3.execute(
                """INSERT INTO ipo_progress (
                     f_create_date, f_update_time, code, project_name, status, register_address, receive_date,
                     company, board, exchange, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime, F_DeleteMark
                   ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), 0)""",
                (
                    date_str,
                    r.get("f_update_time") or f"{date_str} 00:00:00",
                    r.get("code") or "",
                    r.get("project_name") or company,
                    status,
                    r.get("register_address") or "",
                    r.get("receive_date"),
                    company,
                    board,
                    exchange,
                    admin,
                    admin,
                ),
            )
            conn.commit()
            inserted += 1
            row_outcomes.append({"action": "inserted", "row": _hk_row_log_payload(r)})
    finally:
        conn.close()

    return {
        "inserted": inserted,
        "updatedEarlier": updated_earlier,
        "skipped": skipped,
        "skipBreakdown": {
            "skippedNoCompany": skipped_no_company,
            "skippedNoDate": skipped_no_date,
            "skippedDupSameOrLater": skipped_dup,
        },
        "writeRowOutcomes": row_outcomes,
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(description="港交所 IPO → ipo_progress")
    p.add_argument("--start-date", required=True, help="YYYY-MM-DD（闭区间）")
    p.add_argument("--end-date", required=True, help="YYYY-MM-DD（闭区间）")
    p.add_argument("--csv", default=None, help="覆盖环境变量 HK_IPO_CSV_PATH")
    p.add_argument(
        "--source",
        default=os.environ.get("HK_IPO_SOURCE", "hkex-web"),
        choices=("akshare", "hkex-web"),
        help="hkex-web=默认，港交所官网 xlsx+网页；akshare=hk_ipo_application（若存在，否则可回退官网）",
    )
    p.add_argument("--dry-run", action="store_true", help="只解析并打印条数，不写库")
    args = p.parse_args(argv)

    csv_path = args.csv or os.environ.get("HK_IPO_CSV_PATH") or None

    # 加载繁简转换映射表
    load_t2s_mapping()

    try:
        df, resolved_source = load_hk_ipo_dataframe(csv_path, args.source)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2
    except Exception as e:
        print(f"加载数据失败: {e}", file=sys.stderr)
        return 1

    disc_off = os.environ.get("HK_IPO_DISABLE_LISTING_DISCLOSURE_MERGE", "").strip().lower()
    if not csv_path and disc_off not in ("1", "true", "yes"):
        from hkex_ipo_scraper import fetch_hkex_listing_application_disclosures  # noqa: PLC0415

        try:
            extra = fetch_hkex_listing_application_disclosures(args.start_date[:10], args.end_date[:10])
            if extra is not None and not extra.empty:
                df = pd.concat([df, extra], ignore_index=True)
                dedupe_cols = [c for c in ["公司全称", "申请状态", "板块", "申请状态更新日期"] if c in df.columns]
                if dedupe_cols:
                    df = df.drop_duplicates(subset=dedupe_cols, keep="first")
        except Exception as e:
            print(f"[hk_ipo_sync] 合并披露易91000增量失败（已忽略）: {e}", file=sys.stderr)

    days = daterange_inclusive(args.start_date, args.end_date)
    all_rows: List[Dict[str, Any]] = []
    for d in days:
        all_rows.extend(build_rows_for_day(df, d))

    no_match_sample: Optional[List[Dict[str, str]]] = None
    if not all_rows and len(df) > 0:
        no_match_sample = sample_row_dates_for_debug(df, limit=8)

    admin_id = ""
    if not args.dry_run:
        conf = get_db_conf()
        conn = pymysql.connect(**conf)
        try:
            admin_id = fetch_admin_id(conn)
        finally:
            conn.close()

    summary = insert_rows_mysql(all_rows, admin_id, args.dry_run)

    built_detail = [_hk_row_log_payload(r) for r in all_rows]

    out = {
        "startDate": args.start_date[:10],
        "endDate": args.end_date[:10],
        "resolvedSource": resolved_source,
        "sourceRows": int(len(df)),
        "builtRows": len(all_rows),
        "builtRowsDetail": built_detail,
        "inserted": summary.get("inserted", 0),
        "updatedEarlier": summary.get("updatedEarlier", 0),
        "skipped": summary.get("skipped", 0),
        "skipBreakdown": summary.get("skipBreakdown"),
        "writeRowOutcomes": summary.get("writeRowOutcomes") or [],
        "dryRun": summary.get("dryRun"),
        "exchange": EXCHANGE_HK,
        "noMatchSample": no_match_sample,
    }
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    print(json.dumps(out, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
