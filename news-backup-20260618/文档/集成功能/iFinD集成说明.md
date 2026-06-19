# 同花顺 iFinD 数据接口集成说明

## 概述

本文档说明如何在系统中集成同花顺 iFinD 数据接口，用于获取港交所 IPO 上市申请数据。

## 架构设计

### 双环境支持

系统支持两种运行环境：

| 环境 | 认证方式 | SDK 类型 | 数据获取方式 |
|-----|---------|---------|-------------|
| Windows (本地开发) | 用户名+密码 或 Token | iFinDPy (本地) | 本地 SDK 调用 |
| Linux/Docker (生产) | refresh_token | HTTP API | RESTful API |

### 数据流

```
定时任务 → 计算日期区间 → 调用 ifind_ipo_fetch.py
                                    ↓
            Windows: 本地 iFinDPy SDK → THS_DR 函数
            Linux: HTTP API → 获取 access_token → 调用数据接口
                                    ↓
                            解析返回数据
                                    ↓
                            状态映射 → 入库
```

## 配置说明

### 1. 数据库配置表

配置存储在 `listing_data_config` 表中：

| 字段 | 说明 | 示例值 |
|-----|------|-------|
| `ifind_enabled` | 是否启用 iFinD | `1` (启用) / `0` (禁用) |
| `ifind_username` | iFinD 用户名 (加密存储) | `gf10566` |
| `ifind_password` | iFinD 密码 (加密存储) | - |
| `ifind_token` | refresh_token (加密存储) | - |
| `ifind_dr_code` | 数据报表代码 | `p04920` (港股IPO申请) |
| `ifind_query_params` | 查询参数 | `iv_sfss=0;iv_sqlx=0;iv_sqzt=0` |
| `ifind_fields` | 返回字段 | `p04920_f001:Y,p04920_f002:Y,...` |
| `ifind_fallback_to_hkex` | iFinD 失败时是否回退到网页抓取 | `1` / `0` |

### 2. 字段映射

iFinD 返回字段与系统字段映射：

| iFinD 字段 | 含义 | 系统字段 |
|-----------|------|---------|
| `p04920_f001` | 股票代码 | `code` |
| `p04920_f002` | 证券简称 | `project_name` |
| `p04920_f004` | 申请状态 | `status` (需映射) |
| `p04920_f005` | 申请状态更新日期 | 用于筛选 |
| `p04920_f006` | 通过聆讯日期 | 用于筛选 |
| `p04920_f007` | 首次申请日期 | `receive_date`, 用于筛选 |
| `p04920_f037` | 上市日期 | 用于筛选 |
| `p04920_f021` | 企业名称 | `company` |
| `p04920_f022` | 英文名称 | `company` (备选) |

### 3. 状态映射规则

从 iFinD 获取的数据根据日期匹配规则映射为系统状态：

| 匹配条件 | 系统状态 | 说明 |
|---------|---------|------|
| 首次申请日期在区间内 | **递交A1** | 新递表 |
| 通过聆讯日期在区间内 | **通过聆讯** | 已通过聆讯 |
| 上市日期在区间内 | **上市** | 已上市 |
| 状态更新日期在区间内 + 终止状态 | 保持原状态 | 失效/撤回/被拒绝/被发回 |

## Windows 环境部署

### 步骤 1: 下载 SDK

1. 从同花顺官网下载 Windows 版 iFinD 数据接口 SDK
2. 解压到项目根目录，文件夹命名为 `THSDataInterface_Windows`

### 步骤 2: 安装 SDK

```bash
cd THSDataInterface_Windows
python installiFinDPy.py
```

### 步骤 3: 获取 refresh_token

1. 打开同花顺 iFinD 金融数据终端
2. 登录账号（如 `gf10566`）
3. 进入「超级命令」→「工具」→「refresh_token 查询」
4. 复制 refresh_token

### 步骤 4: 配置系统

1. 进入管理后台 → 系统设置 → 上市数据配置
2. 启用 iFinD 接口
3. 填写用户名、密码（可选）、refresh_token
4. 保存配置

## Linux/Docker 环境部署

### 步骤 1: 准备 SDK

由于 SDK 文件较大且包含平台特定二进制文件，**不从代码仓库包含**，需要单独准备：

1. 从同花顺官网下载 Linux 版 iFinD 数据接口 SDK
2. 解压到 `news/deploy/ths_sdk/` 目录
3. 确保 `.dockerignore` 已排除该目录（避免上传到仓库）

### 步骤 2: Dockerfile 配置

Dockerfile 已配置自动安装：

```dockerfile
# 复制 SDK 到容器
COPY deploy/ths_sdk /opt/ths_sdk

# 运行安装脚本
RUN python3 /opt/ths_sdk/bin64/installiFinDPy.py /opt/ths_sdk
```

### 步骤 3: 系统依赖

Dockerfile 已安装必要的系统库：

```dockerfile
RUN apt-get install -y libidn11 libgssapi-krb5-2 libldap-2.5-0
```

### 步骤 4: 配置 Token

1. 使用 Windows 环境获取的 refresh_token
2. 在管理后台配置页面填写
3. 系统将自动使用该 token 通过 HTTP API 获取数据

## 数据获取流程

### 定时任务执行逻辑

```python
# 1. 计算日期区间
start_date = last_sync_range_end + 1 天
end_date = 昨天

# 2. 调用 iFinD 接口
result = THS_DR('p04920', query_params, fields)

# 3. 筛选和映射
for row in result:
    if first_apply_date in [start_date, end_date]:
        status = "递交A1"
    elif hear_date in [start_date, end_date]:
        status = "通过聆讯"
    elif list_date in [start_date, end_date]:
        status = "上市"
    elif status_upd_date in [start_date, end_date] and status in END_STATUSES:
        # 保持终止状态
        pass

# 4. 入库（按 exchange+company+status+board+f_update_time 去重）
```

### 错误处理

| 错误码 | 说明 | 处理 |
|-------|------|------|
| `-2` | Token 无效或过期 | 检查 refresh_token 是否过期，重新获取 |
| `-1` | 网络错误 | 检查网络连接，重试 |
| `0` | 成功 | - |

## 故障排查

### 问题 1: Linux 环境返回 "源表行数=0"

**可能原因**:
1. refresh_token 无效或过期
2. 日期区间内确实无数据
3. HTTP API 调用失败

**排查步骤**:
```bash
# 进入容器测试
sudo docker compose exec app bash

# 测试 HTTP API 获取 access_token
python3 << 'PYEOF'
import urllib.request
import json

refresh_token = "你的refresh_token"
url = "https://quantapi.51ifind.com/api/v1/get_access_token"
headers = {"Content-Type": "application/json", "refresh_token": refresh_token}

req = urllib.request.Request(url, headers=headers, method="POST")
try:
    with urllib.request.urlopen(req, timeout=30) as response:
        data = json.loads(response.read().decode('utf-8'))
        print("access_token:", data.get('data', {}).get('access_token'))
except Exception as e:
    print("错误:", e)
PYEOF
```

### 问题 2: Windows 环境登录失败

**可能原因**:
1. iFinD 客户端未启动
2. 用户名密码错误
3. SDK 未正确安装

**排查步骤**:
```bash
# 测试本地 SDK
python3 << 'PYEOF'
import sys
sys.path.insert(0, 'THSDataInterface_Windows/bin64')
import iFinDPy

ret = iFinDPy.THS_iFinDLogin("用户名", "密码")
print(f"登录结果: {ret}")
if ret == 0:
    print("登录成功")
    result = iFinDPy.THS_DR('p04920', 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0', 
        'p04920_f001:Y,p04920_f002:Y', 'format:dataframe')
    print(f"数据行数: {len(result)}")
PYEOF
```

### 问题 3: 状态映射不正确

检查 `ifind_ipo_fetch.py` 中的 `build_rows` 函数，确认：
1. 日期字段解析正确
2. 状态映射逻辑符合业务需求
3. 时区处理正确（使用北京时间）

## 参考文档

- 同花顺 iFinD 数据接口文档: https://quantapi.51ifind.com/
- Python 接口示例: https://quantapi.51ifind.com/gwstatic/static/ds_web/quantapi-web/example.html

## 更新记录

| 日期 | 版本 | 说明 |
|-----|------|------|
| 2026-04-04 | 1.0 | 初始版本，支持 Windows 本地 SDK 和 Linux HTTP API 双模式 |
