# 手动安装Playwright

## 上市进展 · 辅导备案（2026-04 起）

`eid.csrc.gov.cn` 辅导公示列表的抓取在 `guidance_progress_fetch.py` 中默认使用 **Playwright** 模拟点击「备案时间」排序。部署时除安装 Python 包外，**必须**安装 Chromium 浏览器二进制，详见：

- **`news/上市进展/辅导备案与Playwright部署说明.md`**

**Windows 本机**：`pip install playwright` 后若直接运行 `playwright install chromium` 提示找不到命令，是因为 `Scripts` 未加入 PATH，请使用：

```powershell
python -m playwright install chromium
```

---

## 问题
容器启动后，Playwright模块未安装。

## 解决方案：在容器内手动安装

### 步骤1：检查当前状态

```bash
# 检查pip是否已安装playwright
sudo docker compose exec app pip list | grep playwright

# 检查Python路径
sudo docker compose exec app python3 -c "import sys; print(sys.path)"
```

### 步骤2：安装Playwright

```bash
# 使用root权限安装（因为可能需要系统权限）
sudo docker compose exec -u root app pip install playwright

# 或者如果上面失败，尝试指定镜像源
sudo docker compose exec -u root app pip install -i https://pypi.tuna.tsinghua.edu.cn/simple playwright
```

### 步骤3：安装Chromium浏览器

```bash
# 推荐：不依赖 PATH 中的 playwright 可执行文件（与 pip 使用同一 Python）
sudo docker compose exec -u root app python3 -m playwright install chromium

# 若已将 Python Scripts 加入 PATH，也可：
# sudo docker compose exec -u root app playwright install chromium
```

### 步骤4：验证安装

```bash
# 验证Playwright模块
sudo docker compose exec app python3 -c "from playwright.sync_api import sync_playwright; print('✓ Playwright安装成功')"

# 验证Chromium是否安装
sudo docker compose exec app python3 -c "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); print('✓ Chromium可用')"
```

## 如果安装失败

### 问题1：pip install playwright 失败

```bash
# 检查网络连接
sudo docker compose exec app ping -c 2 pypi.tuna.tsinghua.edu.cn

# 尝试使用其他镜像源
sudo docker compose exec -u root app pip install -i https://pypi.org/simple playwright
```

### 问题2：playwright install chromium 失败

```bash
# 检查磁盘空间
sudo docker compose exec app df -h

# 手动指定安装路径
sudo docker compose exec -u root app PLAYWRIGHT_BROWSERS_PATH=/app/.playwright playwright install chromium
```

### 问题3：权限问题

```bash
# 确保使用 root，并用 python -m 安装浏览器（推荐）
sudo docker compose exec -u root app sh -c "pip install playwright && python3 -m playwright install chromium"
```

## 永久解决方案：重新构建镜像

如果手动安装成功，但希望永久解决，需要重新构建镜像并确保Playwright安装成功：

```bash
# 查看构建日志，确认Playwright安装步骤
sudo docker compose build app 2>&1 | grep -i playwright

# 如果构建时安装失败，需要修复Dockerfile
```

