# Docker环境Python支持部署指南

## 概述

本次更新添加了微信公众号文章内容提取功能，需要Python 3.9+环境支持。本文档说明如何在Docker环境中安装Python并完成部署。

## 更新的文件

本次更新涉及以下文件：

### 后端文件
- `server/db.js` - 添加usage_type字段的数据库迁移
- `server/routes/aiConfig.js` - 支持usage_type字段的API
- `server/routes/news.js` - 新榜接口立即AI分析
- `server/utils/newsAnalysis.js` - 微信公众号文章提取和AI分析逻辑

### 新增文件
- `server/utils/wechatArticleExtractor.py` - Python脚本（微信公众号文章提取）
- `server/utils/requirements.txt` - Python依赖列表
- `server/utils/README_微信公众号文章提取.md` - 功能说明文档

## 部署步骤

### 步骤1：修改Dockerfile添加Python支持

需要修改 `Dockerfile`，在Node.js镜像基础上添加Python 3和相关依赖：

```dockerfile
# 阶段2: 构建后端并运行
FROM node:18-alpine

WORKDIR /app

# 安装系统依赖（MySQL客户端、Python3、pip等）
RUN apk add --no-cache \
    mysql-client \
    python3 \
    py3-pip \
    py3-setuptools \
    tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

# 创建python3和pip3的符号链接（确保python和pip命令可用）
RUN ln -sf /usr/bin/python3 /usr/bin/python && \
    ln -sf /usr/bin/pip3 /usr/bin/pip

# 复制后端依赖文件
COPY package*.json ./

# 安装后端依赖
RUN npm ci --only=production

# 复制Python依赖文件
COPY server/utils/requirements.txt ./server/utils/

# 安装Python依赖
RUN pip install --no-cache-dir -r ./server/utils/requirements.txt

# 复制后端源代码
COPY server/ ./server/

# 复制构建好的前端文件到 Nginx 可访问的位置
COPY --from=frontend-builder /app/client/dist ./client/dist

# 创建必要的目录
RUN mkdir -p uploads logs

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "server/index.js"]
```

### 步骤2：上传更新的文件到服务器

```bash
# 上传所有更新的文件
scp server/db.js user@server:/opt/newsapp/news/server/
scp server/routes/aiConfig.js user@server:/opt/newsapp/news/server/routes/
scp server/routes/news.js user@server:/opt/newsapp/news/server/routes/
scp server/utils/newsAnalysis.js user@server:/opt/newsapp/news/server/utils/
scp server/utils/wechatArticleExtractor.py user@server:/opt/newsapp/news/server/utils/
scp server/utils/requirements.txt user@server:/opt/newsapp/news/server/utils/
scp Dockerfile user@server:/opt/newsapp/news/
```

### 步骤3：进入项目目录

```bash
cd /opt/newsapp/news
```

### 步骤4：备份当前Docker镜像（可选但推荐）

```bash
# 备份当前运行的容器
docker commit newsapp newsapp-backup:$(date +%Y%m%d_%H%M%S)
```

### 步骤5：重新构建Docker镜像

```bash
# 停止当前容器
sudo docker compose stop app

# 重新构建镜像（包含Python支持）
sudo docker compose build --no-cache app

# 或者使用docker build命令
sudo docker build -t newsapp:latest .
```

### 步骤6：启动应用

```bash
# 启动应用容器
sudo docker compose up -d app

# 查看启动日志
sudo docker compose logs app --tail 50 -f
```

### 步骤7：验证Python环境

```bash
# 进入容器检查Python环境
sudo docker exec -it newsapp sh

# 在容器内执行以下命令
python --version  # 应该显示 Python 3.x.x
pip list  # 应该显示已安装的Python包（requests, beautifulsoup4等）

# 测试Python脚本
python server/utils/wechatArticleExtractor.py --help

# 退出容器
exit
```

### 步骤8：验证数据库迁移

```bash
# 连接到MySQL容器
sudo docker exec -it newsapp-mysql mysql -u newsapp -p

# 检查usage_type字段是否存在
USE investment_tools;
DESCRIBE ai_model_config;

# 应该看到usage_type字段
# Field: usage_type
# Type: enum('content_analysis','image_recognition')
# Null: YES
# Key: 
# Default: content_analysis
# Extra: 

# 退出MySQL
exit
```

### 步骤9：配置AI模型

1. **登录管理后台**
2. **进入"系统配置" → "AI模型配置"**
3. **配置两个模型**：
   - **内容分析模型**：
     - 配置名称：例如"qwen-max-内容分析"
     - 用途类型：选择"内容分析"
     - 模型名称：qwen-max（或其他内容分析模型）
   - **图片识别模型**：
     - 配置名称：例如"Qwen2.5-VL-32B-Instruct-图片识别"
     - 用途类型：选择"图片识别"
     - 模型名称：Qwen2.5-VL-32B-Instruct
     - API端点、API密钥等配置

### 步骤10：测试功能

#### 测试1：验证Python脚本可执行

```bash
# 在容器内测试Python脚本
sudo docker exec -it newsapp python server/utils/wechatArticleExtractor.py "https://mp.weixin.qq.com/s?__biz=..."
```

#### 测试2：测试新榜接口同步

1. 登录管理后台
2. 进入"新闻接口配置"
3. 手动触发新榜接口同步
4. 观察日志，确认：
   - 如果content是乱码，会自动从微信公众号URL提取内容
   - 提取成功后更新数据库并继续AI分析

#### 测试3：查看应用日志

```bash
# 查看应用日志
sudo docker compose logs app --tail 200 | grep -i "微信公众号\|wechat\|python\|提取"

# 查看错误日志
sudo docker compose logs app --tail 200 | grep -i "error\|fail"
```

## 快速部署脚本

可以创建一个部署脚本 `deploy/update-with-python.sh`：

```bash
#!/bin/bash
set -e

echo "=== 开始部署Python支持更新 ==="

# 进入项目目录
cd /opt/newsapp/news

# 备份当前容器
echo "备份当前容器..."
docker commit newsapp newsapp-backup:$(date +%Y%m%d_%H%M%S) || true

# 停止应用
echo "停止应用容器..."
sudo docker compose stop app

# 重新构建镜像
echo "重新构建Docker镜像（包含Python支持）..."
sudo docker compose build --no-cache app

# 启动应用
echo "启动应用容器..."
sudo docker compose up -d app

# 等待应用启动
echo "等待应用启动（30秒）..."
sleep 30

# 验证Python环境
echo "验证Python环境..."
sudo docker exec newsapp python --version
sudo docker exec newsapp pip list | grep -E "requests|beautifulsoup4|lxml|Pillow"

# 检查应用健康状态
echo "检查应用健康状态..."
for i in {1..10}; do
    if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
        echo "✓ 应用健康检查通过"
        break
    else
        echo "等待应用启动... ($i/10)"
        sleep 5
    fi
done

# 查看应用日志
echo "查看应用启动日志..."
sudo docker compose logs app --tail 50

echo "=== 部署完成 ==="
```

使用脚本：

```bash
chmod +x deploy/update-with-python.sh
./deploy/update-with-python.sh
```

## 常见问题排查

### 1. Python未安装或版本不对

```bash
# 检查Python版本
sudo docker exec newsapp python --version

# 如果未安装，检查Dockerfile是否正确修改
cat Dockerfile | grep -A 5 "python3"
```

### 2. Python依赖包未安装

```bash
# 检查已安装的包
sudo docker exec newsapp pip list

# 手动安装依赖（如果需要）
sudo docker exec newsapp pip install -r /app/server/utils/requirements.txt
```

### 3. Python脚本执行失败

```bash
# 检查脚本权限
sudo docker exec newsapp ls -la /app/server/utils/wechatArticleExtractor.py

# 测试脚本执行
sudo docker exec newsapp python /app/server/utils/wechatArticleExtractor.py "https://mp.weixin.qq.com/s?__biz=..."

# 查看详细错误
sudo docker compose logs app | grep -i "python\|wechat\|extract"
```

### 4. 数据库字段未添加

```bash
# 检查字段是否存在
sudo docker exec -it newsapp-mysql mysql -u newsapp -p -e "DESCRIBE investment_tools.ai_model_config;" | grep usage_type

# 如果不存在，手动添加（进入容器执行）
sudo docker exec -it newsapp-mysql mysql -u newsapp -p
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
```

### 5. 图片识别模型未配置

```bash
# 检查AI模型配置
sudo docker exec -it newsapp-mysql mysql -u newsapp -p -e "SELECT id, config_name, usage_type, model_name FROM investment_tools.ai_model_config WHERE delete_mark = 0;"
```

## 回滚方案

如果部署出现问题，可以回滚到之前的版本：

```bash
# 停止当前容器
sudo docker compose stop app

# 使用备份的镜像
docker tag newsapp-backup:YYYYMMDD_HHMMSS newsapp:latest

# 或者重新构建旧版本的镜像（如果有Git历史）
git checkout <previous-commit>
sudo docker compose build app
sudo docker compose up -d app
```

## 注意事项

1. **Python版本**：确保Python 3.9+（Alpine Linux默认Python版本通常满足要求）
2. **依赖安装**：Python依赖会在Docker构建时安装，无需手动安装
3. **脚本权限**：Python脚本不需要执行权限，通过`python script.py`调用
4. **网络访问**：确保容器可以访问微信公众号URL（可能需要配置代理）
5. **资源占用**：Python和依赖会增加镜像大小，但影响不大
6. **模型配置**：必须配置图片识别模型，否则图片识别功能不可用

## 验证清单

部署完成后，请确认：

- [ ] Python 3已安装并可执行
- [ ] Python依赖包已安装（requests, beautifulsoup4, lxml, Pillow）
- [ ] Python脚本可以正常执行
- [ ] 数据库usage_type字段已添加
- [ ] AI模型配置界面可以正常使用
- [ ] 内容分析模型已配置
- [ ] 图片识别模型已配置
- [ ] 新榜接口同步功能正常
- [ ] 微信公众号文章提取功能正常
- [ ] 应用日志无错误

## 相关命令速查

```bash
# 查看容器状态
sudo docker compose ps

# 查看应用日志
sudo docker compose logs app --tail 100 -f

# 进入容器
sudo docker exec -it newsapp sh

# 测试Python环境
sudo docker exec newsapp python --version
sudo docker exec newsapp pip list

# 测试Python脚本
sudo docker exec newsapp python /app/server/utils/wechatArticleExtractor.py "URL"

# 重启应用
sudo docker compose restart app

# 重新构建镜像
sudo docker compose build --no-cache app
```

## 联系支持

如果遇到问题，请：
1. 查看应用日志：`sudo docker compose logs app --tail 200`
2. 查看Python相关错误：`sudo docker compose logs app | grep -i python`
3. 检查容器状态：`sudo docker compose ps`
4. 联系技术支持并提供错误日志

