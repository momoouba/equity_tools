# 验证Python依赖安装

## 当前状态

已安装的Python包：
- ✅ beautifulsoup4 4.14.3
- ✅ lxml 6.0.2
- ✅ requests 2.32.5
- ❓ Pillow（需要检查）

## 检查Pillow安装

Pillow可能显示为不同的名称，请执行以下命令检查：

```bash
# 方法1：检查Pillow（大写P）
sudo docker exec newsapp pip list | grep -i pillow

# 方法2：检查PIL（Pillow的旧名称）
sudo docker exec newsapp pip list | grep -i pil

# 方法3：查看所有已安装的包
sudo docker exec newsapp pip list

# 方法4：尝试导入Pillow（最可靠的方法）
sudo docker exec newsapp python -c "from PIL import Image; print('Pillow已安装，版本:', Image.__version__)"
```

## 如果Pillow未安装

如果Pillow确实未安装，可以手动安装：

```bash
# 进入容器
sudo docker exec -it newsapp sh

# 在容器内安装Pillow
pip install --break-system-packages --no-cache-dir Pillow>=10.0.0

# 或者使用国内镜像源
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
pip install --break-system-packages --no-cache-dir Pillow>=10.0.0

# 退出容器
exit
```

## 验证所有依赖

```bash
# 检查所有依赖
sudo docker exec newsapp pip list | grep -E "requests|beautifulsoup4|lxml|Pillow|PIL"

# 测试导入
sudo docker exec newsapp python -c "import requests; import bs4; import lxml; from PIL import Image; print('所有依赖已安装')"
```

## 注意事项

1. **Pillow是可选的**：如果微信公众号文章中没有图片需要识别，Pillow不是必需的
2. **图片识别功能**：只有在配置了图片识别模型且需要识别图片文字时才需要Pillow
3. **如果Pillow安装失败**：可以暂时跳过，不影响基本的文章提取功能

