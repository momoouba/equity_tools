# Docker构建完成后续步骤

## 构建成功！

构建已完成，总耗时约14.5分钟。现在需要启动应用并验证功能。

## 后续操作步骤

### 1. 启动应用

```bash
# 启动应用容器
sudo docker compose up -d app

# 查看启动日志
sudo docker compose logs app --tail 50 -f
```

### 2. 验证Python环境

```bash
# 检查Python版本
sudo docker exec newsapp python --version
# 应该显示: Python 3.x.x

# 检查Python依赖
sudo docker exec newsapp pip list | grep -E "requests|beautifulsoup4|lxml|Pillow"
# 应该显示4个包

# 测试Python脚本可执行性
sudo docker exec newsapp python /app/server/utils/wechatArticleExtractor.py --help
```

### 3. 验证数据库迁移

```bash
# 检查usage_type字段是否存在
sudo docker exec -it newsapp-mysql mysql -u newsapp -p -e "DESCRIBE investment_tools.ai_model_config;" | grep usage_type
# 应该显示usage_type字段
```

### 4. 验证应用健康状态

```bash
# 等待应用启动（约30-60秒）
sleep 30

# 检查健康检查
curl http://localhost:3001/api/health
# 应该返回: {"status":"ok"}

# 查看应用日志
sudo docker compose logs app --tail 100 | grep -i "error\|fail\|python\|wechat"
```

### 5. 配置AI模型

1. **登录管理后台**
2. **进入"系统配置" → "AI模型配置"**
3. **配置两个模型**：
   - **内容分析模型**：
     - 配置名称：例如"qwen-max-内容分析"
     - 用途类型：选择"内容分析"（或"content_analysis"）
     - 模型名称：qwen-max（或其他内容分析模型）
   - **图片识别模型**：
     - 配置名称：例如"Qwen2.5-VL-32B-Instruct-图片识别"
     - 用途类型：选择"图片识别"（或"image_recognition"）
     - 模型名称：Qwen2.5-VL-32B-Instruct
     - API端点、API密钥等配置

### 6. 测试功能

#### 测试新榜接口同步
1. 登录管理后台
2. 进入"新闻接口配置"
3. 手动触发新榜接口同步
4. 观察日志，确认：
   - 如果content是乱码，会自动从微信公众号URL提取内容
   - 提取成功后更新数据库并继续AI分析
   - 日志中应该看到"立即分析新榜新闻"和"从微信公众号提取内容"

#### 查看应用日志
```bash
# 查看新榜同步相关日志
sudo docker compose logs app --tail 200 | grep -i "新榜\|微信公众号\|wechat\|extract\|python"

# 查看错误日志
sudo docker compose logs app --tail 200 | grep -i "error\|fail"
```

## 验证清单

- [ ] Python 3已安装并可执行
- [ ] Python依赖包已安装（requests, beautifulsoup4, lxml, Pillow）
- [ ] 应用健康检查通过
- [ ] 数据库usage_type字段已添加
- [ ] AI模型配置界面可以正常使用
- [ ] 内容分析模型已配置
- [ ] 图片识别模型已配置（可选，如果暂时没有可以不配置）

## 注意事项

1. **图片识别模型是可选的**：如果没有配置图片识别模型，微信公众号文章提取功能仍然可以工作，只是不会识别图片中的文字
2. **Python脚本权限**：Python脚本不需要执行权限，通过`python script.py`调用
3. **网络访问**：确保容器可以访问微信公众号URL（可能需要配置代理）

## 如果遇到问题

### Python脚本执行失败
```bash
# 检查Python环境
sudo docker exec newsapp python --version
sudo docker exec newsapp pip list

# 测试脚本
sudo docker exec newsapp python /app/server/utils/wechatArticleExtractor.py "https://mp.weixin.qq.com/s?__biz=..."
```

### 数据库字段未添加
```bash
# 手动添加字段
sudo docker exec -it newsapp-mysql mysql -u newsapp -p
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
```

### 应用启动失败
```bash
# 查看详细错误
sudo docker compose logs app --tail 200

# 检查容器状态
sudo docker compose ps app
```

## 成功标志

当看到以下日志时，说明功能正常：
- `[立即分析新榜新闻] 开始分析新闻ID: ...`
- `[立即分析新榜新闻] content为空或包含乱码，尝试从微信公众号URL提取内容`
- `[提取微信公众号文章] Python脚本执行成功`
- `[立即分析新榜新闻] ✓ 成功从微信公众号提取内容`

