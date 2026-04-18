# 排查Python脚本提取失败问题

## 问题现象

从日志中看到：
```
[ensureNewsContent] 检测到微信公众号URL，使用Python脚本提取内容: https://mp.weixin.qq.com/...
[ensureNewsContent] 尝试使用常规方法作为备用方案
[ensureNewsContent] Python脚本提取失败或内容为空，错误: 无法获取网页内容
```

Python脚本被调用了，但返回了"无法获取网页内容"的错误，没有详细的错误信息。

## 需要提供的信息

### 1. Python脚本的详细错误输出

查看Python脚本的stderr输出（错误信息）：

```bash
# 查看完整的Python脚本错误日志
sudo docker compose logs app | grep -A 20 "提取微信公众号文章"

# 或者查看所有包含Python相关的日志
sudo docker compose logs app | grep -i python

# 查看最近的错误日志
sudo docker compose logs app --tail 200 | grep -i "python\|提取微信公众号\|wechat"
```

### 2. Python环境检查

检查Docker容器中的Python环境：

```bash
# 进入容器
sudo docker compose exec app sh

# 检查Python是否可用
python3 --version
which python3

# 检查Python脚本是否存在
ls -la /app/server/utils/wechatArticleExtractor.py

# 检查Python依赖是否安装
python3 -c "import requests; import bs4; print('OK')"

# 检查图片识别相关依赖
python3 -c "from PIL import Image; print('PIL OK')"
```

### 3. 手动测试Python脚本

手动执行Python脚本，查看详细错误：

```bash
# 进入容器
sudo docker compose exec app sh

# 切换到脚本目录
cd /app/server/utils

# 手动执行Python脚本（不带图片识别配置）
python3 wechatArticleExtractor.py "https://mp.weixin.qq.com/s?__biz=MzE5MTA3NzcxMQ==&mid=2247487280&idx=2&sn=bdde3464d11c5e715bfeb98a1c84f7b9#rd"

# 如果失败，查看详细错误
python3 wechatArticleExtractor.py "https://mp.weixin.qq.com/s?__biz=MzE5MTA3NzcxMQ==&mid=2247487280&idx=2&sn=bdde3464d11c5e715bfeb98a1c84f7b9#rd" 2>&1
```

### 4. 检查图片识别模型配置

确认图片识别模型配置是否正确传递：

```bash
# 查看AI配置
sudo docker compose exec app node -e "
const db = require('./server/db');
(async () => {
  const configs = await db.query(\"SELECT * FROM ai_model_config WHERE usage_type = 'image_recognition' AND is_active = 1 AND delete_mark = 0\");
  console.log(JSON.stringify(configs, null, 2));
})();
"
```

### 5. 检查网络连接

检查容器是否能访问微信公众号：

```bash
# 进入容器
sudo docker compose exec app sh

# 测试网络连接
wget -O- "https://mp.weixin.qq.com/s?__biz=MzE5MTA3NzcxMQ==&mid=2247487280&idx=2&sn=bdde3464d11c5e715bfeb98a1c84f7b9" 2>&1 | head -20
```

### 6. 查看完整的错误堆栈

修改代码以输出更详细的错误信息（如果需要）：

```bash
# 查看extractWeChatArticleContent方法的错误处理
sudo docker compose exec app grep -A 30 "extractWeChatArticleContent" /app/server/utils/newsAnalysis.js
```

## 可能的问题原因

### 1. Python环境问题
- Python3未安装或路径不正确
- Python依赖包未安装（requests, beautifulsoup4, Pillow等）

### 2. 脚本执行权限问题
- Python脚本没有执行权限
- 脚本路径不正确

### 3. 网络问题
- 容器无法访问外网
- 微信公众号反爬机制阻止访问

### 4. 图片识别配置问题
- 图片识别模型配置错误
- API endpoint或API key不正确

### 5. 错误信息未正确捕获
- Python脚本的stderr输出没有被正确捕获
- 错误信息被截断或丢失

## 临时解决方案

如果需要快速定位问题，可以临时增强错误日志输出。请告诉我您希望：

1. **直接提供上述检查命令的输出结果**（推荐）
2. **我帮您增强错误日志输出**，以便看到更详细的错误信息
3. **我帮您创建一个诊断脚本**，自动检查所有可能的问题

请先执行上述检查命令，并提供输出结果，这样我可以更准确地定位问题。

