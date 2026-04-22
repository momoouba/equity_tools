# 正确添加usage_type字段步骤

## 问题分析

您刚才在bash shell中直接输入了SQL命令，但这些命令需要在MySQL客户端内执行。

## 正确操作步骤

### 方法1：一行命令执行（推荐）

```bash
# 在bash shell中执行（注意：-u和newsapp之间没有空格，-p和密码之间也没有空格）
mysql -u newsapp -pNewsApp@2024 -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
DESCRIBE ai_model_config;
"
```

### 方法2：进入MySQL客户端后执行（更清晰）

```bash
# 1. 进入MySQL客户端（注意：-u和newsapp之间没有空格）
mysql -u newsapp -pNewsApp@2024

# 2. 现在您会看到MySQL提示符：mysql>
# 3. 在MySQL提示符下执行以下命令：

USE investment_tools;

ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;

# 4. 验证字段已添加
DESCRIBE ai_model_config;

# 5. 退出MySQL客户端
exit;
```

### 方法3：使用root用户（如果newsapp用户权限不足）

```bash
# 使用root用户
mysql -u root -pRootPassword123! -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
DESCRIBE ai_model_config;
"
```

## 常见错误

### 错误1：命令语法错误
```bash
# ❌ 错误：- u 之间有空格
mysql - u newsapp -pNewsApp@2024

# ✅ 正确：-u 之间没有空格
mysql -u newsapp -pNewsApp@2024
```

### 错误2：在bash中直接执行SQL
```bash
# ❌ 错误：在bash shell中直接输入SQL命令
bash-5.1# USE investment_tools;
bash: USE: command not found

# ✅ 正确：先进入MySQL客户端
bash-5.1# mysql -u newsapp -pNewsApp@2024
mysql> USE investment_tools;
```

### 错误3：密码参数格式错误
```bash
# ❌ 错误：-p和密码之间有空格
mysql -u newsapp -p NewsApp@2024

# ✅ 正确：-p和密码之间没有空格
mysql -u newsapp -pNewsApp@2024
```

## 验证步骤

执行完ALTER TABLE后，验证字段是否添加成功：

```bash
# 方法1：使用一行命令
mysql -u newsapp -pNewsApp@2024 -e "DESCRIBE investment_tools.ai_model_config;" | grep usage_type

# 方法2：进入MySQL客户端
mysql -u newsapp -pNewsApp@2024
mysql> DESCRIBE investment_tools.ai_model_config;
# 查看输出中是否有usage_type字段
```

## 完整操作示例

```bash
# 1. 进入MySQL容器（如果还没进入）
sudo docker exec -it newsapp-mysql bash

# 2. 执行SQL命令添加字段
mysql -u newsapp -pNewsApp@2024 -e "
USE investment_tools;
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;
"

# 3. 验证
mysql -u newsapp -pNewsApp@2024 -e "DESCRIBE investment_tools.ai_model_config;" | grep usage_type

# 应该看到类似输出：
# usage_type  enum('content_analysis','image_recognition')  YES      NULL    content_analysis  用途类型：content_analysis-内容分析，image_recognition-图片识别
```

