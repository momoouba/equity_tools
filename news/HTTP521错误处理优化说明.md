# HTTP 521错误处理优化说明

## 📋 问题描述

在抓取中国经营网（cb.com.cn）新闻时，遇到HTTP 521错误：
```
Request failed with status code 521
```

HTTP 521错误通常表示：
- Cloudflare等CDN的反爬虫机制
- 网站需要JavaScript渲染才能访问
- 服务器检测到非浏览器请求

## 🔧 优化内容

### 1. 优化请求头

添加了更完整的浏览器请求头，模拟真实浏览器访问：

```javascript
headers: {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1'
}
```

### 2. 针对中国经营网的特殊处理

对于 `cb.com.cn` 和 `cbnet.com` 域名，添加了：
- `Referer`: `https://www.cb.com.cn/`
- `Origin`: `https://www.cb.com.cn`

### 3. 521错误重试机制

当检测到521错误时：
1. 自动使用更完整的浏览器请求头重试
2. 添加额外的浏览器特征（DNT、Sec-Ch-Ua等）
3. 如果重试仍然失败，记录详细的错误信息

### 4. 错误处理优化

- 超时时间从15秒增加到20秒
- 允许521状态码通过validateStatus检查（以便进行重试）
- 提供清晰的错误提示和建议

## 📝 修改的文件

- `server/utils/newsAnalysis.js`
  - `fetchContentFromUrl` 方法：优化请求头和错误处理

## 🚀 部署步骤

### 方法1：上传文件（快速）

1. **上传修改的文件**：
   - `server/utils/newsAnalysis.js`

2. **重启应用**：
   ```bash
   cd /opt/newsapp/news
   docker compose restart app
   ```

### 方法2：重新构建镜像

```bash
cd /opt/newsapp/news
docker compose down
docker compose build --no-cache app
docker compose up -d
```

## ✅ 验证方法

1. **测试中国经营网新闻**：
   - 找到一条来自中国经营网的新闻（URL包含 `cb.com.cn`）
   - 触发AI分析或正文提取

2. **查看日志**：
   ```bash
   docker compose logs app | grep "fetchContentFromUrl"
   ```

3. **预期结果**：
   - 如果成功：应该看到成功提取内容的日志
   - 如果仍然521错误：会看到重试日志和清晰的错误提示

## ⚠️ 注意事项

### HTTP 521错误的限制

HTTP 521错误通常需要：
1. **JavaScript渲染**：网站内容需要通过JavaScript动态加载
2. **Cookie/Session**：可能需要先访问首页建立会话
3. **等待时间**：可能需要等待JavaScript执行完成

### 当前解决方案的限制

当前的优化主要针对：
- ✅ 改善请求头，减少被识别为爬虫的概率
- ✅ 添加重试机制
- ❌ 不支持JavaScript渲染（需要Playwright/Puppeteer）

### 如果仍然失败

如果优化后仍然遇到521错误，可以考虑：

1. **手动处理**：
   - 手动访问URL获取内容
   - 将内容复制到系统中

2. **使用Playwright**（需要额外开发）：
   - 在Node.js中集成Playwright
   - 使用无头浏览器渲染JavaScript页面

3. **使用代理服务**：
   - 使用专业的网页抓取服务
   - 或使用代理IP轮换

## 🔍 故障排查

### 问题1：仍然返回521错误

**检查**：
- 查看日志中的请求头信息
- 确认URL是否正确

**解决**：
- 521错误可能需要JavaScript渲染，当前方案无法完全解决
- 考虑使用Playwright或手动处理

### 问题2：超时错误

**检查**：
- 查看日志中的超时时间
- 确认网络连接是否正常

**解决**：
- 可以适当增加超时时间（当前为20秒）

### 问题3：其他HTTP错误

**检查**：
- 查看日志中的HTTP状态码
- 确认网站是否可访问

**解决**：
- 根据具体错误码进行处理
- 可能需要添加针对特定网站的特殊处理

## 📞 技术支持

如果遇到问题，请提供：
1. 具体的新闻URL
2. 服务器日志（包含 `[fetchContentFromUrl]` 相关日志）
3. HTTP状态码和错误信息
