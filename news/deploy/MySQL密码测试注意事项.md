# MySQL 密码测试注意事项

## ❌ 问题

密码中包含特殊字符（如 `!`）时，bash 会进行历史扩展，导致错误：
```
-bash: !klklsys24678: event not found
```

## ✅ 解决方法

### 方法1：使用单引号（推荐）

```bash
# 单引号会禁用历史扩展
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' -e "SELECT 1;"
```

### 方法2：使用 -p 参数（交互式输入）

```bash
# 使用 -p 后不跟密码，MySQL 会提示输入
sudo mysql -u root -p -e "SELECT 1;"
# 然后输入密码：Mqdqxygyqy!!!klklsys24678
```

### 方法3：禁用历史扩展

```bash
# 临时禁用历史扩展
set +H
sudo mysql -u root -pMqdqxygyqy!!!klklsys24678 -e "SELECT 1;"
set -H  # 重新启用
```

### 方法4：使用环境变量

```bash
# 设置环境变量
export MYSQL_PWD='Mqdqxygyqy!!!klklsys24678'
sudo mysql -u root -e "SELECT 1;"
unset MYSQL_PWD
```

## 📋 推荐命令

### 测试 root 密码

```bash
# 使用单引号
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' -e "SELECT 1;"
```

### 测试 newsapp 用户

```bash
# 使用单引号
mysql -h localhost -u newsapp -p'98K6^7s8!9Z8*76p8' -e "SELECT 1;"
```

### 登录 MySQL 交互式

```bash
# 方法1：使用单引号
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678'

# 方法2：使用 -p 参数（更安全）
sudo mysql -u root -p
# 然后输入密码
```

## 🔒 安全建议

1. **避免在命令行直接输入密码**：使用 `-p` 参数让 MySQL 提示输入更安全
2. **使用配置文件**：将密码放在 `~/.my.cnf` 中（设置权限 600）
3. **使用环境变量**：在脚本中使用环境变量

### 创建 .my.cnf 配置文件

```bash
# 创建配置文件
cat > ~/.my.cnf <<EOF
[client]
user=root
password='Mqdqxygyqy!!!klklsys24678'
EOF

# 设置权限（只有所有者可读）
chmod 600 ~/.my.cnf

# 现在可以直接登录
sudo mysql -e "SELECT 1;"
```

## ✅ 验证步骤

```bash
# 1. 测试 root 密码（使用单引号）
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' -e "SELECT 1;"

# 2. 检查 MySQL 状态
sudo systemctl status mysql

# 3. 检查监听地址
sudo netstat -tulpn | grep 3306

# 4. 测试 newsapp 用户
mysql -h localhost -u newsapp -p'98K6^7s8!9Z8*76p8' -e "SELECT 1;"
```

