# Docker环境Python安装操作步骤（简明版）

## 快速操作步骤

### 1. 上传更新的文件到服务器

需要上传以下文件：
```
Dockerfile
server/db.js
server/routes/aiConfig.js
server/routes/news.js
server/utils/newsAnalysis.js
server/utils/wechatArticleExtractor.py
server/utils/requirements.txt
deploy/update-with-python.sh
```

### 2. 进入项目目录

```bash
cd /opt/newsapp/news
```

### 3. 给脚本添加执行权限

```bash
chmod +x deploy/update-with-python.sh
```

### 4. 运行部署脚本（推荐）

```bash
./deploy/update-with-python.sh
```

脚本会自动完成：
- 备份当前容器
- 停止应用
- 重新构建Docker镜像（包含Python）
- 启动应用
- 验证Python环境
- 检查应用健康状态

### 5. 或者手动执行（如果脚本不可用）

```bash
# 1. 备份容器
docker commit newsapp newsapp-backup:$(date +%Y%m%d_%H%M%S)

# 2. 停止应用
sudo docker compose stop app

# 3. 重新构建镜像（重要！必须重新构建）
sudo docker compose build --no-cache app

# 4. 启动应用
sudo docker compose up -d app

# 5. 等待30秒后验证
sleep 30

# 6. 检查Python环境
sudo docker exec newsapp python --version
sudo docker exec newsapp pip list | grep requests

# 7. 检查应用健康
curl http://localhost:3001/api/health
```

## 验证步骤

### 1. 验证Python已安装

```bash
sudo docker exec newsapp python --version
# 应该显示: Python 3.x.x
```

### 2. 验证Python依赖已安装

```bash
sudo docker exec newsapp pip list | grep -E "requests|beautifulsoup4|lxml|Pillow"
# 应该显示4个包
```

### 3. 验证数据库字段已添加

```bash
sudo docker exec -it newsapp-mysql mysql -u newsapp -p -e "DESCRIBE investment_tools.ai_model_config;" | grep usage_type
# 应该显示usage_type字段
```

### 4. 验证应用正常运行

```bash
curl http://localhost:3001/api/health
# 应该返回: {"status":"ok"}
```

## 配置AI模型

部署完成后，需要在管理后台配置两个AI模型：

1. **内容分析模型**（usage_type = '内容分析'）
   - 用于新闻情绪分析和摘要生成
   - 例如：qwen-max

2. **图片识别模型**（usage_type = '图片识别'）
   - 用于识别微信公众号文章中的图片文字
   - 例如：Qwen2.5-VL-32B-Instruct

## 常见问题

### Q: 为什么必须重新构建镜像？
A: 因为Dockerfile中添加了Python安装步骤，需要重新构建才能包含Python环境。

### Q: 如果构建失败怎么办？
A: 检查Dockerfile语法，确保Python安装命令正确。可以查看构建日志：
```bash
sudo docker compose build app 2>&1 | tee build.log
```

### Q: Python脚本执行失败？
A: 检查：
1. Python是否已安装：`sudo docker exec newsapp python --version`
2. 依赖是否已安装：`sudo docker exec newsapp pip list`
3. 脚本权限：`sudo docker exec newsapp ls -la /app/server/utils/wechatArticleExtractor.py`

### Q: 数据库字段未添加？
A: 应用启动时会自动执行数据库迁移。如果未添加，可以手动执行：
```bash
sudo docker exec -it newsapp-mysql mysql -u newsapp -p
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
```

## 回滚方案

如果部署出现问题：

```bash
# 停止当前容器
sudo docker compose stop app

# 使用备份的镜像
docker tag newsapp-backup:YYYYMMDD_HHMMSS newsapp:latest

# 或者重新构建旧版本（如果有Git）
git checkout <previous-commit>
sudo docker compose build app
sudo docker compose up -d app
```

## 详细文档

更多详细信息请参考：
- `Docker部署Python支持指南.md` - 完整部署指南
- `server/utils/README_微信公众号文章提取.md` - 功能说明

