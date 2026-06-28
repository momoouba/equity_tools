# 验证依赖安装

## 步骤1：验证所有Python依赖

```bash
# 验证所有依赖是否安装成功
sudo docker compose exec app python3 -c "
import requests
import bs4
import lxml
from PIL import Image
from playwright.sync_api import sync_playwright
print('✓ 所有依赖安装成功')
print('  - requests:', requests.__version__)
print('  - beautifulsoup4:', bs4.__version__)
print('  - lxml: 已安装')
print('  - Pillow: 已安装')
print('  - playwright: 已安装')
"
```

## 步骤2：验证Playwright和Chromium

```bash
# 验证Playwright可以正常启动
sudo docker compose exec app python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    print('✓ Playwright和Chromium正常工作')
    browser.close()
"
```

## 步骤3：测试微信公众号文章提取

1. 登录系统
2. 找到标题为"相比于被AI改变，我们邀请你来一起参与构建和改变AI"的文章
3. 点击"重新分析"
4. 查看日志

## 步骤4：查看日志

```bash
# 实时查看日志
sudo docker compose logs -f app

# 或者查看最近的日志（过滤关键词）
sudo docker compose logs app --tail 100 | grep -E "(Playwright|反爬|提取|mmbiz|成功|requests|ModuleNotFoundError)"
```

## 预期结果

如果一切正常，应该看到：

```
[HTTP请求] 获取到HTML内容，长度: 5000字符
⚠️ 检测到反爬关键词: 环境异常
⚠️ HTTP请求获取到的是反爬验证页面，尝试使用Playwright无头浏览器...
[Playwright] 开始使用无头浏览器获取页面内容...
[Playwright] ✓ 成功获取HTML内容，长度: 50000字符
✓ Playwright成功获取到有效内容
[提取图片] 在HTML中找到 X 个img标签
[提取图片] HTML中包含 'mmbiz.qpic.cn' 的次数: X
✓ 成功提取文章内容
```

## 如果遇到问题

### 问题1：ModuleNotFoundError

如果仍然看到 `ModuleNotFoundError`，说明依赖没有正确安装：

```bash
# 检查已安装的包
sudo docker compose exec app pip list

# 手动安装缺失的包
sudo docker compose exec -u root app pip install --break-system-packages requests beautifulsoup4 lxml Pillow playwright
```

### 问题2：Playwright无法启动

```bash
# 检查Chromium是否安装
sudo docker compose exec app python3 -m playwright install chromium
```

