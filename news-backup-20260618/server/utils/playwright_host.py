"""
本地 Windows 与 Linux/Docker 共用：避免误用仅容器内存在的路径。

- 生产 Docker 常在环境中设置 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright（镜像内已安装浏览器）。
- 若在 Windows 上从 compose 复制了该变量，或路径不存在，Playwright 会找不到浏览器。
  此时移除无效变量，回退到 Playwright 默认目录（如 %LOCALAPPDATA%\\ms-playwright）。
"""
from __future__ import annotations

import os


def ensure_playwright_browser_path() -> None:
    key = "PLAYWRIGHT_BROWSERS_PATH"
    raw = os.environ.get(key, "").strip()
    if not raw:
        return
    try:
        if os.path.isdir(raw):
            return
    except OSError:
        pass
    try:
        del os.environ[key]
    except KeyError:
        pass
