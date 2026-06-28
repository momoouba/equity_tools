# 添加usage_type字段操作步骤

## 问题

检查usage_type字段时没有输出，说明字段不存在，需要手动添加。

## 解决方案

### 方法1：使用SQL文件（推荐）

```bash
# 进入MySQL容器
sudo docker exec -it newsapp-mysql mysql -u newsapp -p investment_tools

# 在MySQL中执行
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;

# 验证字段已添加
DESCRIBE ai_model_config;

# 退出MySQL
exit
```

### 方法2：使用SQL文件

```bash
# 执行SQL文件
sudo docker exec -i newsapp-mysql mysql -u newsapp -p investment_tools < 手动添加usage_type字段.sql
```

### 方法3：一行命令

```bash
sudo docker exec -it newsapp-mysql mysql -u newsapp -p -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
DESCRIBE ai_model_config;
"
```

## 验证

```bash
# 检查字段是否存在
sudo docker exec -it newsapp-mysql mysql -u newsapp -p -e "DESCRIBE investment_tools.ai_model_config;" | grep usage_type

# 应该看到：
# usage_type | enum('content_analysis','image_recognition') | YES | | content_analysis | 用途类型：content_analysis-内容分析，image_recognition-图片识别
```

