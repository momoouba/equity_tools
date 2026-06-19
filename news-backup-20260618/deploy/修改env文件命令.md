# 修改 .env 文件命令

## 🚀 快速更新数据库密码

### 方法1：使用 sed 命令（推荐，最快）

```bash
# 进入应用目录
cd /opt/newsapp/news

# 更新数据库密码
sed -i 's|^DB_PASSWORD=.*|DB_PASSWORD=Mqdqxygyqy!!!klklsys24678|' .env

# 验证更新
cat .env | grep DB_PASSWORD
```

### 方法2：使用 nano 编辑器（可视化编辑）

```bash
# 进入应用目录
cd /opt/newsapp/news

# 打开编辑器
nano .env

# 在编辑器中：
# 1. 找到 DB_PASSWORD= 这一行
# 2. 修改为：DB_PASSWORD=Mqdqxygyqy!!!klklsys24678
# 3. 保存：Ctrl + O，然后按 Enter
# 4. 退出：Ctrl + X
```

### 方法3：使用 vi/vim 编辑器

```bash
# 进入应用目录
cd /opt/newsapp/news

# 打开编辑器
vi .env
# 或
vim .env

# 在编辑器中：
# 1. 按 i 进入编辑模式
# 2. 找到 DB_PASSWORD= 这一行并修改
# 3. 按 Esc 退出编辑模式
# 4. 输入 :wq 保存并退出
```

### 方法4：如果 .env 文件不存在，创建它

```bash
# 进入应用目录
cd /opt/newsapp/news

# 创建 .env 文件
cat > .env <<EOF
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=Mqdqxygyqy!!!klklsys24678
DB_NAME=investment_tools
EOF

# 验证
cat .env
```

## 📋 完整的更新和重启流程

```bash
# 1. 进入应用目录
cd /opt/newsapp/news

# 2. 更新密码
sed -i 's|^DB_PASSWORD=.*|DB_PASSWORD=Mqdqxygyqy!!!klklsys24678|' .env

# 3. 查看更新后的配置
echo "=== 更新后的配置 ==="
cat .env | grep DB_

# 4. 重启应用
pm2 restart newsapp

# 5. 查看日志
pm2 logs newsapp --lines 10
```

## 🔍 查看当前配置

```bash
# 查看所有数据库相关配置
cd /opt/newsapp/news
cat .env | grep DB_

# 或者查看整个文件
cat .env
```

## ⚠️ 注意事项

1. **备份原文件**（可选）：
```bash
cp .env .env.backup
```

2. **确保文件权限正确**：
```bash
chmod 644 .env
```

3. **验证密码格式**：确保密码中没有特殊字符导致 sed 命令失败

## ✅ 一键执行

```bash
cd /opt/newsapp/news && \
sed -i 's|^DB_PASSWORD=.*|DB_PASSWORD=Mqdqxygyqy!!!klklsys24678|' .env && \
echo "✓ 密码已更新" && \
cat .env | grep DB_PASSWORD && \
pm2 restart newsapp
```

