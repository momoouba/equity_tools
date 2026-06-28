# 微信公众号验证页面URL处理说明

## 问题描述

在舆情信息中，部分微信公众号文章的URL是验证页面（`wappoc_appmsgcaptcha`），而不是直接的文章链接。这导致：

1. **正文提取失败**：提取到的是验证页面的JavaScript和CSS代码，而不是实际文章内容
2. **图片识别未执行**：对于纯图片文章，没有执行图片分析的路径

### 示例URL格式

```
https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=xxx&target_url=https%3A%2F%2Fmp.weixin.qq.com%2Fs%3F__biz%3Dxxx%26mid%3Dxxx%26idx%3Dxxx%26sn%3Dxxx#rd
```

真实文章URL在`target_url`参数中（URL编码）。

## 解决方案

### 1. JavaScript层面处理

**文件：** `news/server/utils/newsAnalysis.js`

**修改位置：** `extractWeChatArticleContent`方法

**功能：**
- 检测URL是否包含`wappoc_appmsgcaptcha`
- 如果是验证页面，从URL参数中提取`target_url`
- 对`target_url`进行URL解码，获取真实的文章URL
- 使用真实URL调用Python脚本进行内容提取

**代码逻辑：**
```javascript
// 处理验证页面URL：如果是wappoc_appmsgcaptcha验证页面，提取target_url参数
let actualUrl = url;
try {
  const urlObj = new URL(url);
  if (urlObj.pathname.includes('wappoc_appmsgcaptcha') && urlObj.searchParams.has('target_url')) {
    const targetUrl = urlObj.searchParams.get('target_url');
    if (targetUrl) {
      actualUrl = decodeURIComponent(targetUrl);
      console.log(`[提取微信公众号文章] 检测到验证页面URL，提取真实文章URL: ${actualUrl}`);
    }
  }
} catch (urlError) {
  console.warn(`[提取微信公众号文章] 解析URL失败，使用原始URL: ${urlError.message}`);
}
```

### 2. Python脚本层面处理

**文件：** `news/server/utils/wechatArticleExtractor.py`

**修改位置：** `_fetch_html`方法

**功能：**
- 在Python脚本中也添加相同的URL处理逻辑（双重保障）
- 确保即使JavaScript层面没有处理，Python脚本也能自己处理验证页面URL

**代码逻辑：**
```python
# 处理验证页面URL：如果是wappoc_appmsgcaptcha验证页面，提取target_url参数
actual_url = url
if 'wappoc_appmsgcaptcha' in url and 'target_url' in url:
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        if 'target_url' in params and params['target_url']:
            actual_url = params['target_url'][0]
            # URL解码
            import urllib.parse
            actual_url = urllib.parse.unquote(actual_url)
            print(f"检测到验证页面URL，提取真实文章URL: {actual_url}", file=sys.stderr)
    except Exception as e:
        print(f"解析验证页面URL失败，使用原始URL: {str(e)}", file=sys.stderr)
```

### 3. 纯图片文章处理优化

**文件：** `news/server/utils/wechatArticleExtractor.py`

**修改位置：** `_combine_content`方法和`extract_article_content`方法

**功能：**
- 优化内容整合逻辑，确保纯图片文章（正文为空但图片识别成功）也能正确返回内容
- 增强图片识别的日志输出，方便调试

**改进点：**
1. 如果正文为空或太短（<50字符），但图片识别有内容，优先使用图片识别内容
2. 纯图片文章时，只返回图片识别内容，格式为：`[图片1文字识别内容]\n{文字内容}`
3. 增加详细的日志输出，包括图片数量、识别成功数量等

## 使用场景

### 场景1：验证页面URL + 纯文本文章
- 系统自动提取真实URL
- 正常提取正文内容
- 如果有图片，也会识别图片文字

### 场景2：验证页面URL + 纯图片文章
- 系统自动提取真实URL
- 正文为空或很短
- 自动识别图片中的文字
- 将图片识别内容作为正文内容

### 场景3：验证页面URL + 图文混合文章
- 系统自动提取真实URL
- 提取正文文本
- 识别图片文字
- 整合正文和图片文字

## 配置要求

### 图片识别功能

要使用图片识别功能，需要在AI模型配置中配置图片识别模型：

1. **用途类型**：`image_recognition`
2. **模型名称**：推荐使用 `Qwen2.5-VL-32B-Instruct` 或其他支持图片识别的模型
3. **API配置**：配置正确的API endpoint和API key

**配置位置：** 系统管理 → AI配置 → 添加/编辑配置 → 选择用途类型为"图片识别"

## 测试验证

### 测试步骤

1. **准备测试数据**：
   - 找到一条包含验证页面URL的新闻
   - URL格式：`https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=xxx&target_url=xxx`

2. **触发重新分析**：
   - 在舆情信息页面，找到该新闻
   - 点击"重新分析"按钮
   - 系统会自动提取真实URL并重新提取内容

3. **验证结果**：
   - 检查正文内容是否正确提取
   - 如果是图片文章，检查是否识别了图片文字
   - 查看日志，确认URL处理过程

### 日志输出示例

```
[提取微信公众号文章] 检测到验证页面URL，提取真实文章URL: https://mp.weixin.qq.com/s?__biz=xxx...
找到 3 张图片，开始识别图片文字...
图片 1 识别成功，文字长度: 256字符
图片 2 识别成功，文字长度: 189字符
[提取微信公众号文章] ✓ 成功从微信公众号提取内容，长度: 445字符
```

## 注意事项

1. **URL解码**：`target_url`参数是URL编码的，需要正确解码
2. **双重处理**：JavaScript和Python脚本都添加了URL处理逻辑，确保兼容性
3. **图片识别配置**：如果没有配置图片识别模型，纯图片文章将无法提取内容
4. **反爬机制**：如果遇到微信公众号的反爬页面（环境异常等），仍然无法提取内容

## 相关文件

- `news/server/utils/newsAnalysis.js` - JavaScript层面的URL处理
- `news/server/utils/wechatArticleExtractor.py` - Python脚本层面的URL处理和图片识别
- `news/server/utils/README_微信公众号文章提取.md` - 微信公众号文章提取功能说明

## 更新日期

2025-01-27

