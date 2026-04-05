#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同花顺 iFinD（THS_iFinD / iFinDPy）港股上市申请抓取。

输入：
- --start-date / --end-date: YYYY-MM-DD 闭区间，按申请状态更新日期优先过滤
- --username / --password: iFinD 登录凭证（Windows 环境，有本地客户端）
- --token: iFinD token（Linux 环境，无 GUI）
- --dr-code: 默认 p04920
- --query-params: 默认 iv_sfss=0;iv_sqlx=0;iv_sqzt=0
- --fields: 默认 p04920_f001...（由配置项传入）
- --format: json/list/dataframe（内部统一转 DataFrame）

输出：
JSON（stdout）:
{
  "sourceRows": 0,
  "builtRows": 0,
  "rows": [...],
  "sample": [...]
}
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

import pandas as pd


EXCHANGE_HK = "港交所"


def _norm_ymd(v: Any) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    if not s:
        return ""
    s = s.replace("/", "-").replace(".", "-")
    # 兼容 2026-4-2 / 2026-04-02
    try:
        dt = datetime.fromisoformat(s[:10])
        return dt.strftime("%Y-%m-%d")
    except Exception:
        parts = s.split("-")
        if len(parts) >= 3:
            y = parts[0].zfill(4)
            m = parts[1].zfill(2)
            d = parts[2].zfill(2)
            return f"{y}-{m}-{d}"
    return s[:10]


def _pick_first(row: pd.Series, keys: Sequence[str]) -> str:
    for k in keys:
        if k in row.index:
            v = str(row.get(k) or "").strip()
            if v and v != "--":
                return v
    return ""


def _to_frame(result: Any) -> pd.DataFrame:
    if isinstance(result, pd.DataFrame):
        return result
    if isinstance(result, list):
        if len(result) > 0 and isinstance(result[0], dict):
            return pd.DataFrame(result)
        return pd.DataFrame(result)
    if isinstance(result, dict):
        if "tables" in result and isinstance(result["tables"], list) and result["tables"]:
            t0 = result["tables"][0]
            if isinstance(t0, list):
                return pd.DataFrame(t0)
            if isinstance(t0, dict):
                return pd.DataFrame([t0])
        return pd.DataFrame(result)
    
    # 处理 THSData 对象（iFinDPy 返回的类型）
    if hasattr(result, "data") and hasattr(result, "errorcode"):
        try:
            raw = result.data
            if isinstance(raw, bytes):
                # 尝试多种编码（iFinDPy 可能返回 GBK 编码）
                decoded = None
                for enc in ("utf-8", "gbk", "gb2312", "gb18030", "latin-1"):
                    try:
                        decoded = raw.decode(enc)
                        break
                    except Exception:
                        continue
                if decoded is None:
                    decoded = raw.decode("utf-8", errors="ignore")
                raw = decoded
            if isinstance(raw, str):
                # 处理 JSON 中的非法转义字符（iFinDPy 数据可能包含 \x 等不合法转义）
                import re
                raw = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', raw)
                parsed = json.loads(raw)
                if "tables" in parsed and parsed["tables"]:
                    t0 = parsed["tables"][0]
                    if "table" in t0 and isinstance(t0["table"], dict):
                        return pd.DataFrame(t0["table"])
        except Exception as e:
            # 解析失败时静默返回空 DataFrame，避免日志污染
            pass
    
    return pd.DataFrame()


def _get_access_token_via_http(refresh_token: str) -> str:
    """
    通过 HTTP API 获取 access_token（Linux 环境使用）
    参考: https://quantapi.51ifind.com/gwstatic/static/ds_web/quantapi-web/example.html
    """
    import urllib.request
    import urllib.error
    
    url = "https://quantapi.51ifind.com/api/v1/get_access_token"
    headers = {
        "Content-Type": "application/json",
        "refresh_token": refresh_token
    }
    
    try:
        req = urllib.request.Request(url, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode('utf-8'))
            if 'data' in data and 'access_token' in data['data']:
                return data['data']['access_token']
            else:
                raise RuntimeError(f"获取 access_token 失败: {data}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP 错误 {e.code}: {e.reason}")
    except Exception as e:
        raise RuntimeError(f"请求 access_token 失败: {e}")


def _call_ths_dr_http_api(access_token: str, dr_code: str, query_params: str, fields: str) -> pd.DataFrame:
    """
    使用 HTTP API 调用 THS_DR（Linux 环境）
    """
    import urllib.request
    import urllib.error
    
    url = "https://quantapi.51ifind.com/api/v1/data_pool"
    headers = {
        "Content-Type": "application/json",
        "access_token": access_token
    }
    
    # 构建请求参数
    # 将 fields 从 "p04920_f001:Y,p04920_f002:Y" 格式转换为列表
    output_fields = [f.strip() for f in fields.split(',')]
    
    # 解析 query_params (如 "iv_sfss=0;iv_sqlx=0;iv_sqzt=0")
    function_params = {}
    for param in query_params.split(';'):
        if '=' in param:
            key, value = param.split('=', 1)
            function_params[key.strip()] = value.strip()
    
    payload = {
        "reportname": dr_code,
        "functionpara": function_params,
        "outputpara": ','.join(output_fields)
    }
    
    try:
        req = urllib.request.Request(
            url, 
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.loads(response.read().decode('utf-8'))
            
            # 解析返回的数据
            if 'tables' in data and data['tables']:
                t0 = data['tables'][0]
                if 'table' in t0 and isinstance(t0['table'], dict):
                    return pd.DataFrame(t0['table'])
            return pd.DataFrame()
    except Exception as e:
        raise RuntimeError(f"HTTP API 调用失败: {e}")


def _call_ths_dr(username: str, password: str, token: str, dr_code: str, query_params: str, fields: str, fmt: str) -> pd.DataFrame:
    """
    调用同花顺 iFinD 数据接口。
    支持两种 SDK 和两种认证方式：
    1. THS_iFinD（新版）
    2. iFinDPy（旧版，常见于 THSDataInterface_Windows）
    3. HTTP API（Linux 环境，使用 refresh_token 获取 access_token）
    
    认证方式：
    - Windows：用户名 + 密码（本地 SDK）
    - Linux：refresh_token -> HTTP API 获取 access_token
    """
    
    # 检测是否在 Linux 环境（有 token 但没有本地 SDK登录成功）
    is_linux = False
    try:
        import platform
        is_linux = platform.system() == "Linux"
    except:
        pass
       
    # 如果是 Linux 环境且有 token，使用 HTTP API
    if is_linux and token:
        try:
            # 使用 refresh_token 获取 access_token
            access_token = _get_access_token_via_http(token)
            print(f"[iFinD] HTTP API 获取 access_token 成功", file=sys.stderr)
            return _call_ths_dr_http_api(access_token, dr_code, query_params, fields)
        except Exception as e:
            print(f"[iFinD] HTTP API 方式失败: {e}，尝试本地 SDK...", file=sys.stderr)
            # 如果 HTTP API 失败，继续尝试本地 SDK
            pass
    
    # 本地 SDK 方式（Windows 环境）
    ths = None
    module_name = ""

    # 优先尝试新版 SDK
    try:
        import THS_iFinD as ths_new  # type: ignore
        ths = ths_new
        module_name = "THS_iFinD"
    except Exception:
        pass

    # 回退到旧版 SDK
    if ths is None:
        try:
            import iFinDPy as ths_old  # type: ignore
            ths = ths_old
            module_name = "iFinDPy"
        except Exception as e:
            raise RuntimeError(f"未安装 THS_iFinD 或 iFinDPy: {e}")

    login_ok = False
    login_errors: List[str] = []

    # 方式1：用户名 + 密码（Windows 环境）
    if username and password and hasattr(ths, "THS_iFinDLogin"):
        try:
            ret = ths.THS_iFinDLogin(username, password)
            txt = str(ret or "")
            if ret == 0 or "success" in txt.lower() or "登录成功" in txt:
                login_ok = True
        except Exception as e:
            login_errors.append(f"用户名密码登录: {e}")

    # 方式2：Token（Linux 本地 SDK 环境 - 通常不会走到这里）
    if not login_ok and token and hasattr(ths, "THS_iFinDLogin"):
        try:
            ret = ths.THS_iFinDLogin("", token)
            txt = str(ret or "")
            if ret == 0 or "success" in txt.lower() or "登录成功" in txt:
                login_ok = True
        except Exception as e:
            login_errors.append(f"Token登录: {e}")

    if not login_ok and login_errors:
        raise RuntimeError(f"iFinD 登录失败 ({module_name}): {' | '.join(login_errors[:3])}")

    # 调用 THS_DR
    if not hasattr(ths, "THS_DR"):
        raise RuntimeError(f"{module_name} 中未找到 THS_DR")

    # 调试：打印 THS_DR 调用参数（可保留用于生产排查）
    # print(f"[DEBUG] THS_DR 调用: code={dr_code}, params={query_params}", file=sys.stderr)
    
    result = ths.THS_DR(dr_code, query_params, fields, f"format:{fmt}")
    
    frame = _to_frame(result)
    if frame.empty and hasattr(ths, "THS_Trans2DataFrame"):
        try:
            frame = ths.THS_Trans2DataFrame(result)
        except Exception:
            pass
    
    return frame


def build_rows(df: pd.DataFrame, start_date: str, end_date: str) -> List[Dict[str, Any]]:
    """
    按多日期+状态组合筛选港股IPO数据：
    1. 首次申请日期(p04920_f007)在区间内 → 抓取
    2. 通过聆讯日期(p04920_f006)在区间内 → 抓取
    3. 上市日期(p04920_f037)在区间内 → 抓取
    4. 申请状态更新日期(p04920_f005)在区间内 + 状态是失效/撤回/被拒绝/被发回 → 抓取
    """
    out: List[Dict[str, Any]] = []
    if df.empty:
        return out

    # 调试：打印数据框列名和前几条数据
    print(f"[DEBUG] 数据框列名: {list(df.columns)}", file=sys.stderr)
    print(f"[DEBUG] 数据框前3行:\n{df.head(3).to_string()}", file=sys.stderr)
    print(f"[DEBUG] 筛选区间: {start_date} ~ {end_date}", file=sys.stderr)

    # 终止状态集合
    END_STATUSES = {"失效", "撤回", "被拒绝", "被发回", "拒绝", "发回"}

    for _, row in df.iterrows():
        code = _pick_first(row, ("p04920_f001", "股票代码", "证券代码", "同花顺代码"))
        short = _pick_first(row, ("p04920_f002", "证券简称", "股票简称", "项目简称"))
        status = _pick_first(row, ("p04920_f004", "申请状态")) or "-"
        
        # 四个日期字段
        first_apply_date = _norm_ymd(_pick_first(row, ("p04920_f007", "首次申请日期", "申请日期")))  # 首次申请日期
        hear_date = _norm_ymd(_pick_first(row, ("p04920_f006", "通过聆讯日期", "聆讯日期")))  # 通过聆讯日期
        list_date = _norm_ymd(_pick_first(row, ("p04920_f037", "上市日期")))  # 上市日期
        status_upd_date = _norm_ymd(_pick_first(row, ("p04920_f005", "申请状态更新日期", "状态更新日期")))  # 申请状态更新日期
        
        # 其他字段
        receive_date = first_apply_date  # 受理日期用首次申请日期
        board = _pick_first(row, ("板块", "拟上市板块")) or "主板"
        company = _pick_first(row, ("p04920_f021", "企业名称", "公司全称"))
        if not company:
            company = _pick_first(row, ("p04920_f022", "英文名称", "企业英文名称")) or short or code

        if not company:
            continue

        # 按四种组合判断是否命中
        matched = False
        match_reason = ""
        update_ymd = ""
        final_status = status  # 最终状态，可能根据匹配原因调整

        # 1. 首次申请日期在区间内 → 新递表（状态改为"递交A1"）
        if first_apply_date and start_date <= first_apply_date <= end_date:
            matched = True
            match_reason = "首次申请"
            update_ymd = first_apply_date
            final_status = "递交A1"  # 首次申请时状态应为"递交A1"

        # 2. 通过聆讯日期在区间内 → 通过聆讯
        if not matched and hear_date and start_date <= hear_date <= end_date:
            matched = True
            match_reason = "通过聆讯"
            update_ymd = hear_date
            final_status = "通过聆讯"

        # 3. 上市日期在区间内 → 上市
        if not matched and list_date and start_date <= list_date <= end_date:
            matched = True
            match_reason = "上市"
            update_ymd = list_date
            final_status = "上市"

        # 4. 申请状态更新日期在区间内 + 状态是终止类 → 状态变更
        if not matched and status_upd_date and start_date <= status_upd_date <= end_date:
            if any(s in status for s in END_STATUSES):
                matched = True
                match_reason = "状态变更"
                update_ymd = status_upd_date
                # 保持原始终止状态

        if not matched:
            continue

        out.append(
            {
                "exchange": EXCHANGE_HK,
                "board": board,
                "company": company,
                "project_name": short or company,
                "status": final_status,
                "register_address": "",
                "code": code,
                "receive_date": receive_date or None,
                "f_update_time": f"{update_ymd} 00:00:00",
                "_match_reason": match_reason,  # 调试用
            }
        )
    return out


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(description="THS_iFinD 港股上市申请抓取")
    p.add_argument("--start-date", required=True)
    p.add_argument("--end-date", required=True)
    p.add_argument("--username", default="")
    p.add_argument("--password", default="")
    p.add_argument("--token", default="")
    p.add_argument("--dr-code", default="p04920")
    p.add_argument("--query-params", default="iv_sfss=0;iv_sqlx=0;iv_sqzt=0")
    p.add_argument(
        "--fields",
        default="p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y",
    )
    p.add_argument("--format", default="json", choices=("json", "list", "dataframe"))
    args = p.parse_args(argv)

    try:
        df = _call_ths_dr(args.username, args.password, args.token, args.dr_code, args.query_params, args.fields, args.format)
        rows = build_rows(df, args.start_date[:10], args.end_date[:10])
        out = {
            "sourceRows": int(len(df)),
            "builtRows": len(rows),
            "rows": rows,
            "sample": rows[:5],
        }
        if hasattr(sys.stdout, "reconfigure"):
            try:
                sys.stdout.reconfigure(encoding="utf-8")
            except Exception:
                pass
        print(json.dumps(out, ensure_ascii=False))
        return 0
    except Exception as e:
        print(f"iFinD 抓取失败: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
