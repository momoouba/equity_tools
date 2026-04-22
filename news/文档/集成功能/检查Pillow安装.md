# 检查Pillow安装

## 当前状态

已确认安装：
- ✅ beautifulsoup4 4.14.3
- ✅ lxml 6.0.2  
- ✅ requests 2.32.5
- ❓ Pillow（需要检查）

## 检查Pillow是否已安装

请执行以下命令检查：

```bash
# 方法1：检查Pillow（可能显示为PIL）
sudo docker exec newsapp pip list | grep -i pil

# 方法2：查看所有包（查找Pillow）
sudo docker exec newsapp pip list | grep -i pillow

# 方法3：尝试导入Pillow（最可靠）
sudo docker exec newsapp python -c "from PIL import Image; print('Pillow已安装，版本:', Image.__version__)"
```

## 如果Pillow未安装

如果Pillow确实未安装，可以手动安装：

```bash
# 方法1：在容器内安装（推荐）
sudo docker exec newsapp pip install --break-system-packages --no-cache-dir Pillow>=10.0.0

# 方法2：如果方法1失败，进入容器安装
sudo docker exec -it newsapp sh
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
pip install --break-system-packages --no-cache-dir Pillow>=10.0.0
exit
```

## 重要说明

**Pillow是可选的**：
- 如果微信公众号文章中没有图片需要识别，Pillow不是必需的
- 只有在配置了图片识别模型且需要识别图片文字时才需要Pillow
- 基本的文章提取功能（提取正文文本）不需要Pillow

## 验证所有功能

即使Pillow未安装，也可以先测试基本功能：

```bash
# 测试Python脚本（不涉及图片处理）
sudo docker exec newsapp python /app/server/utils/wechatArticleExtractor.py "https://mp.weixin.qq.com/s?__biz=..." '{}'
```

如果只是提取正文文本，不需要Pillow。

