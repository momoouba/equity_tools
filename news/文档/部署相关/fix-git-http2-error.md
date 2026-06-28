# 修复 Git HTTP2 错误

## 错误信息
```
error: RPC failed; curl 16 Error in the HTTP2 framing layer
fatal: expected flush after ref listing
```

## 解决方案

### 方案1：禁用 HTTP2（推荐，最简单）

```bash
# 禁用 HTTP2，使用 HTTP/1.1
git config --global http.version HTTP/1.1

# 然后重试
git fetch origin
git pull origin main
```

### 方案2：增加缓冲区大小

```bash
# 增加 HTTP 缓冲区大小
git config --global http.postBuffer 524288000

# 然后重试
git fetch origin
```

### 方案3：同时使用方案1和方案2（推荐）

```bash
# 禁用 HTTP2
git config --global http.version HTTP/1.1

# 增加缓冲区大小
git config --global http.postBuffer 524288000

# 然后重试
git fetch origin
git pull origin main
```

### 方案4：使用 SSH 代替 HTTPS（最稳定）

如果上述方案都不行，可以改用 SSH：

```bash
# 1. 生成 SSH 密钥（如果还没有）
ssh-keygen -t rsa -b 4096 -C "server@example.com"

# 2. 查看公钥
cat ~/.ssh/id_rsa.pub

# 3. 将公钥添加到 GitHub
#    Settings → SSH and GPG keys → New SSH key

# 4. 修改远程仓库地址为 SSH
git remote set-url origin git@github.com:momoouba/equity_news.git

# 5. 测试连接
ssh -T git@github.com

# 6. 拉取代码
git fetch origin
git pull origin main
```

## 一键修复脚本

执行以下命令：

```bash
cd /opt/newsapp/news

# 禁用 HTTP2
git config --global http.version HTTP/1.1

# 增加缓冲区
git config --global http.postBuffer 524288000

# 验证配置
git config --global --get http.version
git config --global --get http.postBuffer

# 重试拉取
git fetch origin
```

## 验证修复

```bash
# 测试连接
git fetch origin

# 如果成功，应该看到类似输出：
# From https://github.com/momoouba/equity_news
#  * [new branch]      main       -> origin/main

# 然后拉取代码
git pull origin main
```

## 如果仍然失败

1. **检查网络连接**：
   ```bash
   ping github.com
   curl -I https://github.com
   ```

2. **检查代理设置**：
   ```bash
   git config --global --get http.proxy
   git config --global --get https.proxy
   
   # 如果有代理且不正确，清除它
   git config --global --unset http.proxy
   git config --global --unset https.proxy
   ```

3. **使用 SSH 方式**（最可靠）

