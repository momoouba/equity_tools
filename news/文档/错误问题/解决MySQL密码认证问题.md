# 解决MySQL密码认证问题

## 问题
密码认证失败，可能的原因：
1. 密码不是默认值 `NewsApp@2024`
2. 密码包含特殊字符需要转义
3. 需要使用root用户

## 解决方案

### 方法1：使用root用户（推荐）

```bash
# 尝试使用root用户和默认密码
mysql -u root -pRootPassword123! -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
DESCRIBE ai_model_config;
"
```

### 方法2：查看实际密码

```bash
# 查看容器环境变量中的实际密码
sudo docker exec newsapp-mysql env | grep MYSQL

# 查看.env文件（如果存在）
cat .env 2>/dev/null | grep MYSQL

# 查看docker-compose.yml中的密码配置
grep -A 5 MYSQL docker-compose.yml
```

### 方法3：交互式输入密码（最可靠）

```bash
# 使用root用户，交互式输入密码
mysql -u root -p
# 输入密码时不会显示，直接输入后按回车

# 或者使用newsapp用户
mysql -u newsapp -p
# 输入密码时不会显示，直接输入后按回车

# 在MySQL提示符下执行：
USE investment_tools;

ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;

DESCRIBE ai_model_config;

exit;
```

### 方法4：使用单引号包裹密码（处理特殊字符）

```bash
# 如果密码包含特殊字符，使用单引号
mysql -u newsapp -p'NewsApp@2024' -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
"
```

### 方法5：通过应用代码自动添加（如果迁移逻辑已实现）

应用启动时会自动执行数据库迁移。检查 `news/server/db.js` 中的迁移逻辑是否已实现，如果已实现，只需重启应用：

```bash
# 重启应用，让数据库迁移逻辑执行
sudo docker compose restart app

# 等待应用启动后检查
sudo docker exec -it newsapp-mysql mysql -u root -pRootPassword123! -e "DESCRIBE investment_tools.ai_model_config;" | grep usage_type
```

## 推荐操作流程

### 步骤1：查看实际密码

```bash
# 查看环境变量
sudo docker exec newsapp-mysql env | grep MYSQL
```

### 步骤2：尝试root用户

```bash
# 使用root用户和默认密码
mysql -u root -pRootPassword123! -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
DESCRIBE ai_model_config;
"
```

### 步骤3：如果root也失败，使用交互式输入

```bash
# 进入MySQL客户端，交互式输入密码
mysql -u root -p
# 输入密码（不会显示），然后执行SQL命令
```

## 验证字段是否已存在

在执行ALTER TABLE之前，可以先检查字段是否已经存在：

```bash
# 检查字段是否已存在
mysql -u root -pRootPassword123! -e "DESCRIBE investment_tools.ai_model_config;" | grep usage_type

# 如果字段已存在，会看到输出
# 如果字段不存在，不会有输出
```

## 如果字段已存在但想重新添加

如果字段已存在，ALTER TABLE会报错。可以先删除再添加：

```bash
mysql -u root -pRootPassword123! -e "
USE investment_tools;
ALTER TABLE ai_model_config DROP COLUMN usage_type;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
"
```

