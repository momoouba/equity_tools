#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
繁体→简体转换工具（与 zhconvUtils.js 共享 zh_t2s_mapping.json 映射表）
"""

import json
import os
from typing import Dict

_T2S_MAP: Dict[str, str] = {}


def load_t2s_mapping() -> None:
    """加载繁简映射 JSON（与 JS 侧 zhconvUtils.js 共用同一份映射）"""
    global _T2S_MAP
    if _T2S_MAP:
        return
    json_path = os.path.join(os.path.dirname(__file__), "zh_t2s_mapping.json")
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            _T2S_MAP = json.load(f)
    except Exception as e:
        import sys
        print(f"[zh_t2s] 警告：加载繁简映射失败({e})，将跳过繁简转换", file=sys.stderr)
        _T2S_MAP = {}


def to_simplified(text: str) -> str:
    """将繁体中文文本转换为简体（基于 zh_t2s_mapping.json）"""
    if not text or not _T2S_MAP:
        return text
    return "".join(_T2S_MAP.get(ch, ch) for ch in text)
