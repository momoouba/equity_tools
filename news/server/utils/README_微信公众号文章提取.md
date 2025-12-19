# 微信公众号文章内容提取功能说明

## 功能概述

当新榜接口返回的content内容是JavaScript/CSS代码（乱码）时，系统会自动调用Python脚本从微信公众号文章URL提取正文内容和图片文字。

## 工作流程

1. **检测乱码**：系统检测到content包含JavaScript/CSS代码
2. **提取内容**：调用Python脚本从source_url爬取微信公众号文章
3. **图片识别**：使用Qwen2.5-VL-32B-Instruct模型识别图片中的文字
4. **整合内容**：将正文文本和图片识别的文字整合
5. **更新数据库**：更新news_detail表的content字段
6. **AI分析**：使用整合后的内容进行情绪分析和摘要生成

## 安装依赖

```bash
cd news/server/utils
pip install -r requirements.txt
```

## Python脚本使用

脚本路径：`news/server/utils/wechatArticleExtractor.py`

### 命令行使用

```bash
python3 wechatArticleExtractor.py <文章URL> [图片识别模型配置JSON]
```

### 示例

```bash
# 仅提取正文（不使用图片识别）
python3 wechatArticleExtractor.py "https://mp.weixin.qq.com/s?__biz=..."

# 提取正文并识别图片文字
python3 wechatArticleExtractor.py "https://mp.weixin.qq.com/s?__biz=..." '{"api_endpoint":"...","api_key":"...","model_name":"Qwen2.5-VL-32B-Instruct","api_type":"chat","temperature":0.7,"max_tokens":2000}'
```

### 返回格式

```json
{
  "success": true,
  "content": "整合后的正文内容（包含图片文字）",
  "text_length": 1234,
  "image_count": 5,
  "recognized_image_count": 3
}
```

## AI模型配置

在系统配置 → AI模型配置中，需要配置两个模型：

1. **内容分析模型**（usage_type = 'content_analysis'）
   - 用于新闻情绪分析和摘要生成
   - 例如：qwen-max

2. **图片识别模型**（usage_type = 'image_recognition'）
   - 用于识别微信公众号文章中的图片文字
   - 例如：Qwen2.5-VL-32B-Instruct

## 注意事项

1. **Python环境**：确保系统已安装Python 3.9+
2. **依赖库**：安装requirements.txt中的所有依赖
3. **模型配置**：必须在AI模型配置中配置图片识别模型
4. **网络访问**：确保服务器可以访问微信公众号文章URL
5. **反爬机制**：脚本已包含基本的反爬处理（User-Agent、请求头等）

## 错误处理

- 如果Python脚本执行失败，系统会使用默认处理（基于标题生成关键词和摘要）
- 如果图片识别失败，只使用正文文本，不影响整体流程
- 如果提取的内容为空，使用默认处理

## 日志

所有操作都会记录在服务器日志中，包括：
- 提取开始/完成
- 图片识别结果
- 错误信息

