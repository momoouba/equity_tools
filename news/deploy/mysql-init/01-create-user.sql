-- 创建数据库
CREATE DATABASE IF NOT EXISTS `investment_tools` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建用户（允许从任何主机连接，适用于 Docker 网络）
CREATE USER IF NOT EXISTS 'newsapp'@'%' IDENTIFIED BY 'NewsApp@2024';
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY 'NewsApp@2024';

-- 授予权限
GRANT ALL PRIVILEGES ON `investment_tools`.* TO 'newsapp'@'%';
GRANT ALL PRIVILEGES ON `investment_tools`.* TO 'newsapp'@'localhost';

-- 刷新权限
FLUSH PRIVILEGES;

