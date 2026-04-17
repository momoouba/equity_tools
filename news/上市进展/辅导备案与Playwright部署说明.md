# 辅导备案抓取与 Playwright 部署说明

本文说明 **上市进展 · 证监会辅导备案**（`eid.csrc.gov.cn` 公开发行辅导公示）抓取对 **Playwright + Chromium** 的依赖，以及在各环境下的安装与可选配置。**与微信公众号正文提取等场景共用同一套 Playwright 安装**，只需保证容器或本机已执行过浏览器安装命令。

## 功能与依赖关系

- 脚本路径：`news/server/utils/上市进展/guidance_progress_fetch.py`
- 当 `request_url`（或默认 URL）指向 **`https://eid.csrc.gov.cn/`** 且未关闭浏览器模式时，使用 **Playwright** 打开页面，模拟点击 **「备案时间」**（`filingDate`）表头，使列表按备案时间 **降序**；随后**校验首条可见行的备案日期**是否落在 **当前自然月或上一自然月**（上海时区「今天」为准），若不满足则**再次点击**「备案时间」并重新校正降序，最多 **`CSRC_GUIDANCE_FIRST_ROW_MONTH_RECHECK_CLICKS`** 轮；无数据时 **刷新页面重试**。
- 若 Playwright 不可用或未安装 Chromium，脚本会 **自动回退** 为纯 `requests` 拉取 HTML（**无**表头点击，排序依赖服务端返回的初始 HTML）。

## 安装步骤（推荐命令）

无论 Windows / Linux / macOS，**安装浏览器二进制**时优先使用下面写法，**不依赖** `Scripts` 目录是否在 `PATH` 中：

```bash
python -m playwright install chromium
```

若生产环境使用 **Python 3** 命令名为 `python3`：

```bash
python3 -m playwright install chromium
```

安装 Python 包（若尚未安装）：

```bash
pip install playwright
```

项目依赖声明见：`news/server/utils/requirements.txt`（已包含 `playwright`）。

### Windows 本机开发

1. `pip install playwright` 成功后，`playwright.exe` 可能位于  
   `...\Python\pythoncore-3.x-64\Scripts\`，若未加入系统 **PATH**，直接执行 `playwright install chromium` 会提示「不是内部或外部命令」。
2. 请始终使用：**`python -m playwright install chromium`**（与 `pip` 使用的解释器一致）。
3. Node 启动辅导同步时，若使用环境变量 **`PYTHON`** 指向特定解释器，浏览器也应通过 **同一解释器** 安装：  
   `"%PYTHON%" -m playwright install chromium`

### Docker / 服务器

与现有文档一致，在容器内以 **root** 安装浏览器（示例）：

```bash
sudo docker compose exec -u root app pip install playwright
sudo docker compose exec -u root app python3 -m playwright install chromium
```

修改 `requirements.txt` 后需 **重新构建镜像** 或进入容器补装，参见 `news/正常更新部署流程.md` 中「更新 Python 依赖」场景。

## 可选环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `CSRC_GUIDANCE_USE_PLAYWRIGHT` | 设为 `0` / `false` / `no` 时，对 eid 域名也 **不** 使用浏览器，仅用 HTTP | 开启 |
| `CSRC_GUIDANCE_PLAYWRIGHT_TIMEOUT_MS` | 页面导航超时（毫秒） | `90000` |
| `CSRC_GUIDANCE_PLAYWRIGHT_HEADLESS` | 设为 `0` 时为有头浏览器，便于本机排查 | `1`（无头） |
| `CSRC_GUIDANCE_AFTER_CLICK_MS` | 每次点击表头后的等待（毫秒） | `1200` |
| `CSRC_GUIDANCE_FIRST_ROW_MONTH_RECHECK_CLICKS` | 首条不在本月/上月时，额外点击「备案时间」并再校降序的最大轮数 | `3` |
| `CSRC_GUIDANCE_PAGE_URL` | 辅导公示页 URL（与配置里 `request_url` 二选一逻辑以代码为准） | 内置默认 |

命令行调试抓取脚本时，可加 **`--no-playwright`** 强制走 HTTP，不启动浏览器。

## 验证

在项目 `news` 目录下（与运行 Node 时使用同一 Python）：

```bash
python -c "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); b=p.chromium.launch(headless=True); b.close(); print('OK')"
```

快速验证辅导脚本能否 import（不发起真实外网时可配合 `--no-playwright`）：

```bash
python server/utils/上市进展/guidance_progress_fetch.py --start-date 2026-01-01 --end-date 2026-12-31 --no-playwright
```

## 相关文档

- `news/手动安装Playwright.md` — 容器内手动安装与排错  
- `news/验证依赖安装.md` — 依赖与 Chromium 自检命令  
- `news/正常更新部署流程.md` — 更新 `requirements.txt` / 重建镜像流程  

（**说明**：境外上市备案 Excel 的自动发现走 `requests` + 证监会 `getSearch` 接口，**不需要** Playwright。）
