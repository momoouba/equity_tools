# 强制更新 initPrompts.js 修复

## 🔍 问题

虽然代码已修复，但容器中可能仍在使用旧的缓存模块。需要强制重新加载。

## ✅ 解决方案

### 方法一：完全重启容器（推荐）

```bash
# 1. 进入项目目录
cd /opt/newsapp/news

# 2. 停止并重新启动容器（清除 Node.js 模块缓存）
sudo docker compose down
sudo docker compose up -d

# 3. 等待容器完全启动（约 30-60 秒）
sleep 30

# 4. 查看日志，确认错误已消失
sudo docker compose logs app --tail 100 | grep -i "初始化提示词\|Unexpected token"
```

### 方法二：验证容器中的文件是否已更新

```bash
# 检查容器中的文件内容（第 346-390 行）
sudo docker compose exec app sed -n '346,390p' /app/server/utils/initPrompts.js

# 应该看到正确的结构：
# } else {
#   // 如果不存在，创建新的提示词配置
#   ...
# }
# } catch (promptError) {
```

### 方法三：如果文件未更新，手动复制

```bash
# 1. 确认本地文件已修复
cat server/utils/initPrompts.js | sed -n '346,390p'

# 2. 如果容器中的文件仍然是旧的，需要重新构建镜像
cd /opt/newsapp/news
sudo docker compose build app
sudo docker compose up -d app

# 3. 查看日志
sudo docker compose logs app --tail 100
```

### 方法四：清除 Node.js 模块缓存（如果容器支持）

```bash
# 进入容器并清除 require 缓存
sudo docker compose exec app node -e "
delete require.cache[require.resolve('./server/utils/initPrompts')];
console.log('Cache cleared');
"

# 然后重启容器
sudo docker compose restart app
```

## 🎯 验证修复成功

修复成功后，日志应该显示：

```
开始初始化提示词配置...
✓ 提示词初始化完成：创建 X 个，更新 X 个
✓ 服务器核心功能已就绪，可以接收请求
```

**不应该再看到：**
```
初始化提示词配置时出现警告: Unexpected token 'catch'
```

## 📝 如果问题仍然存在

如果完全重启后仍然有错误：

1. **检查文件编码问题**
   ```bash
   sudo docker compose exec app file /app/server/utils/initPrompts.js
   ```

2. **检查文件权限**
   ```bash
   sudo docker compose exec app ls -la /app/server/utils/initPrompts.js
   ```

3. **手动验证语法**
   ```bash
   sudo docker compose exec app node -c /app/server/utils/initPrompts.js
   ```

4. **查看完整错误堆栈**
   ```bash
   sudo docker compose logs app 2>&1 | grep -A 20 "Unexpected token"
   ```

