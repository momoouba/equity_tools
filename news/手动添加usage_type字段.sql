-- 手动添加usage_type字段到ai_model_config表

USE investment_tools;

-- 检查字段是否已存在
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
AND TABLE_NAME = 'ai_model_config' 
AND COLUMN_NAME = 'usage_type';

-- 如果字段不存在，添加字段
ALTER TABLE ai_model_config 
ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' 
COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别' 
AFTER application_type;

-- 验证字段已添加
DESCRIBE ai_model_config;

