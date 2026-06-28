# 添加usage_type字段 - 多种方法

## 问题

MySQL密码认证失败，需要找到正确的密码或使用其他方法。

## 解决方案

### 方法1：使用root用户（推荐）

```bash
# 使用root用户登录（密码通常是MYSQL_ROOT_PASSWORD环境变量的值）
sudo docker exec -it newsapp-mysql mysql -u root -p -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
DESCRIBE ai_model_config;
"
```

### 方法2：查看docker-compose.yml中的密码

```bash
# 查看docker-compose.yml中的MySQL密码配置
grep MYSQL_PASSWORD docker-compose.yml
grep MYSQL_ROOT_PASSWORD docker-compose.yml

# 或者查看环境变量
cat .env | grep MYSQL
```

### 方法3：使用环境变量中的密码

```bash
# 如果密码在环境变量中
sudo docker exec -it newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
"
```

### 方法4：进入容器后执行（最可靠）

```bash
# 进入MySQL容器
sudo docker exec -it newsapp-mysql bash

# 在容器内执行（可以使用root用户，密码通常是环境变量中的值）
mysql -u root -p
# 输入密码（通常是RootPassword123!或环境变量中的值）

# 在MySQL中执行
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;

# 验证
DESCRIBE ai_model_config;

# 退出MySQL
exit

# 退出容器
exit
```

### 方法5：通过应用代码自动添加（如果应用有数据库迁移功能）

应用启动时会自动执行数据库迁移，但可能需要重启应用：

```bash
# 重启应用，让数据库迁移逻辑执行
sudo docker compose restart app

# 等待应用启动后检查
sudo docker exec -it newsapp-mysql mysql -u root -p -e "DESCRIBE investment_tools.ai_model_config;" | grep usage_type
```

## 查找密码的方法

```bash
# 方法1：查看docker-compose.yml
cat docker-compose.yml | grep -A 5 mysql

# 方法2：查看环境变量文件
cat .env 2>/dev/null | grep MYSQL

# 方法3：查看容器环境变量
sudo docker exec newsapp-mysql env | grep MYSQL
```

## 默认密码

根据docker-compose.yml，默认密码可能是：
- Root密码：`RootPassword123!`
- newsapp用户密码：`NewsApp@2024`

## 推荐操作

```bash
# 尝试使用root用户和默认密码
sudo docker exec -it newsapp-mysql mysql -u root -pRootPassword123! -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
DESCRIBE ai_model_config;
"
```

如果默认密码不对，请使用**方法4**（进入容器后执行），这样可以交互式输入密码。

