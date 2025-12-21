# 验证Playwright安装和测试

## 步骤1：验证Playwright安装

```bash
# 进入容器并测试Playwright
sudo docker compose exec app python3 -c "from playwright.sync_api import sync_playwright; print('✓ Playwright安装成功')"

# 如果成功，应该看到：
# ✓ Playwright安装成功
```

## 步骤2：检查容器状态

```bash
# 查看容器状态
sudo docker compose ps

# 查看应用日志
sudo docker compose logs app --tail 50
```

## 步骤3：测试微信公众号文章提取

现在可以重新测试之前有问题的文章：

1. 登录系统
2. 找到标题为"相比于被AI改变，我们邀请你来一起参与构建和改变AI"的文章
3. 点击"重新分析"
4. 查看日志，应该能看到：
   - `[HTTP请求] 获取到HTML内容...`
   - `⚠️ 检测到反爬关键词...`
   - `[Playwright] 开始使用无头浏览器获取页面内容...`
   - `[Playwright] ✓ 成功获取HTML内容`
   - `✓ 成功提取文章内容`

## 步骤4：查看详细日志

```bash
# 实时查看日志
sudo docker compose logs -f app

# 或者查看最近的日志
sudo docker compose logs app --tail 100 | grep -E "(Playwright|反爬|提取|mmbiz)"
```

## 如果遇到问题

### 问题1：Playwright导入失败

```bash
# 检查Playwright是否在requirements.txt中
sudo docker compose exec app cat server/utils/requirements.txt | grep playwright

# 如果不在，需要重新构建
sudo docker compose exec app pip install playwright
sudo docker compose exec app playwright install chromium
```

### 问题2：Chromium未安装

```bash
# 手动安装Chromium
sudo docker compose exec -u root app playwright install chromium
```

### 问题3：权限问题

```bash
# 如果遇到权限问题，使用root用户执行
sudo docker compose exec -u root app playwright install chromium
```

