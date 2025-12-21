# 测试Playwright功能

## 步骤1：验证Playwright和Chromium

```bash
# 验证Playwright可以正常启动浏览器
sudo docker compose exec app python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    print('✓ Playwright和Chromium正常工作')
    browser.close()
"
```

## 步骤2：测试微信公众号文章提取

1. **登录系统**
2. **找到标题为"相比于被AI改变，我们邀请你来一起参与构建和改变AI"的文章**
3. **点击"重新分析"**
4. **查看日志**

## 步骤3：查看实时日志

```bash
# 实时查看日志
sudo docker compose logs -f app

# 或者查看最近的日志（过滤关键词）
sudo docker compose logs app --tail 100 | grep -E "(Playwright|反爬|提取|mmbiz|成功|失败)"
```

## 预期结果

如果一切正常，应该看到类似输出：

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

### 问题1：Playwright无法启动浏览器

```bash
# 检查Chromium是否安装
sudo docker compose exec app python3 -m playwright install chromium
```

### 问题2：仍然无法提取内容

查看详细日志，确认：
- Playwright是否成功获取到HTML
- 图片URL是否正确提取
- OCR识别是否正常工作

