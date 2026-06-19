# 1Panel证书定位和配置步骤

## 方法一：从1Panel Web界面下载证书（推荐，最简单）

### 步骤1：在1Panel中下载证书

1. 登录1Panel Web管理界面
2. 进入 **网站** → **SSL证书** 或 **证书管理**
3. 找到 `news.gf-dsai.com` 的证书
4. 点击 **下载** 或 **查看证书**
5. 下载以下两个文件：
   - **证书文件**（可能是 `fullchain.pem`、`cert.pem` 或 `.crt` 文件）
   - **私钥文件**（可能是 `privkey.pem`、`key.pem` 或 `.key` 文件）

### 步骤2：上传证书到服务器

将下载的两个文件上传到项目的 `deploy/ssl/` 目录：

```bash
# 在服务器上创建ssl目录
cd /path/to/equity_news/news
mkdir -p deploy/ssl

# 使用scp从本地上传（在本地电脑执行）
# scp fullchain.pem user@server:/path/to/equity_news/news/deploy/ssl/
# scp privkey.pem user@server:/path/to/equity_news/news/deploy/ssl/

# 或者使用SFTP工具（如WinSCP、FileZilla）上传到 deploy/ssl/ 目录
```

**重要**：上传后需要确保文件名统一为：
- `fullchain.pem`（证书文件）
- `privkey.pem`（私钥文件）

如果下载的文件名不同，需要重命名：
```bash
cd deploy/ssl
mv 下载的证书文件名 fullchain.pem
mv 下载的私钥文件名 privkey.pem
```

---

## 方法二：在服务器上查找1Panel证书路径

### 步骤1：查找证书存储位置

在服务器上执行以下命令：

```bash
# 方法1：查找常见的1Panel证书路径
ls -la /opt/1panel/certs/ 2>/dev/null
ls -la /root/1panel/certs/ 2>/dev/null

# 方法2：查找包含域名或证书的目录
find /opt/1panel -type d -name "*gf-dsai*" 2>/dev/null
find /opt/1panel -type d -name "*news*" 2>/dev/null

# 方法3：查找证书文件（最可靠）
find /opt/1panel -name "*.pem" 2>/dev/null
find /opt/1panel -name "*.crt" 2>/dev/null
find /opt/1panel -name "*.key" 2>/dev/null

# 方法4：查找所有可能的证书相关文件
find /opt/1panel -type f \( -name "*cert*" -o -name "*key*" -o -name "*chain*" \) 2>/dev/null

# 方法5：检查1Panel的配置文件
grep -r "news.gf-dsai.com" /opt/1panel 2>/dev/null | head -20
```

### 步骤2：查看1Panel的nginx配置

1Panel通常会为网站创建nginx配置，查看配置可能找到证书路径：

```bash
# 查找1Panel的nginx配置
find /opt/1panel -name "*nginx*" -type f 2>/dev/null
find /etc/nginx -name "*gf-dsai*" 2>/dev/null
find /etc/nginx -name "*news*" 2>/dev/null

# 查看1Panel可能的配置文件
cat /opt/1panel/volumes/nginx/*/conf/*.conf 2>/dev/null | grep -A 10 "news.gf-dsai.com"
```

### 步骤3：检查1Panel的数据目录

```bash
# 1Panel的数据通常在这里
ls -la /opt/1panel/data/

# 或者
ls -la /root/1panel/data/
```

---

## 找到证书后的配置步骤

### 完整操作流程

```bash
# 1. 进入项目目录
cd /path/to/equity_news/news

# 2. 创建ssl目录（如果不存在）
mkdir -p deploy/ssl

# 3a. 如果找到了1Panel证书路径，复制证书文件
# 假设证书在 /opt/1panel/certs/news.gf-dsai.com/
sudo cp /opt/1panel/certs/news.gf-dsai.com/fullchain.pem deploy/ssl/ 2>/dev/null || \
sudo cp /opt/1panel/certs/news.gf-dsai.com/cert.pem deploy/ssl/fullchain.pem 2>/dev/null || \
sudo cp /opt/1panel/certs/news.gf-dsai.com/*.crt deploy/ssl/fullchain.pem 2>/dev/null

sudo cp /opt/1panel/certs/news.gf-dsai.com/privkey.pem deploy/ssl/ 2>/dev/null || \
sudo cp /opt/1panel/certs/news.gf-dsai.com/key.pem deploy/ssl/privkey.pem 2>/dev/null || \
sudo cp /opt/1panel/certs/news.gf-dsai.com/*.key deploy/ssl/privkey.pem 2>/dev/null

# 3b. 如果是从1Panel下载后上传的，文件应该已经在 deploy/ssl/ 目录了
# 只需要确保文件名正确即可

# 4. 检查文件是否存在
ls -la deploy/ssl/

# 5. 确保证书文件名正确（如果不是fullchain.pem和privkey.pem，需要重命名）
cd deploy/ssl
# 如果文件名不对，执行重命名（根据实际文件名调整）
# mv 证书文件名 fullchain.pem
# mv 私钥文件名 privkey.pem

# 6. 设置正确的文件权限
sudo chmod 644 deploy/ssl/fullchain.pem
sudo chmod 600 deploy/ssl/privkey.pem

# 7. 验证证书文件格式（可选，确认文件有效）
openssl x509 -in deploy/ssl/fullchain.pem -text -noout > /dev/null 2>&1 && echo "证书格式正确" || echo "证书格式错误"
openssl rsa -in deploy/ssl/privkey.pem -check -noout > /dev/null 2>&1 && echo "私钥格式正确" || echo "私钥格式错误"

# 8. 重启nginx容器
docker-compose restart nginx

# 9. 查看nginx日志，确认启动成功
docker logs newsapp-nginx --tail 50

# 10. 测试nginx配置是否正确
docker exec newsapp-nginx nginx -t

# 11. 测试HTTPS访问
curl -I https://news.gf-dsai.com
```

---

## 快速一键配置脚本

如果您已经找到了证书路径，可以使用以下命令：

```bash
# 替换 /opt/1panel/certs/news.gf-dsai.com 为实际路径
CERT_PATH="/opt/1panel/certs/news.gf-dsai.com"

cd /path/to/equity_news/news
mkdir -p deploy/ssl

# 复制证书（自动处理不同文件名）
sudo cp "$CERT_PATH"/fullchain.pem deploy/ssl/ 2>/dev/null || \
sudo cp "$CERT_PATH"/cert.pem deploy/ssl/fullchain.pem 2>/dev/null || \
sudo cp "$CERT_PATH"/*.crt deploy/ssl/fullchain.pem 2>/dev/null

sudo cp "$CERT_PATH"/privkey.pem deploy/ssl/ 2>/dev/null || \
sudo cp "$CERT_PATH"/key.pem deploy/ssl/privkey.pem 2>/dev/null || \
sudo cp "$CERT_PATH"/*.key deploy/ssl/privkey.pem 2>/dev/null

# 设置权限
sudo chmod 644 deploy/ssl/fullchain.pem
sudo chmod 600 deploy/ssl/privkey.pem

# 重启nginx
docker-compose restart nginx

# 验证
docker exec newsapp-nginx nginx -t
```

---

## 验证配置是否成功

### 1. 检查文件
```bash
cd /path/to/equity_news/news
ls -lh deploy/ssl/
# 应该看到：
# fullchain.pem  (证书文件，通常几KB)
# privkey.pem    (私钥文件，通常几KB)
```

### 2. 检查nginx配置
```bash
docker exec newsapp-nginx nginx -t
# 应该显示：nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### 3. 检查容器状态
```bash
docker ps | grep nginx
# 应该看到 newsapp-nginx 容器正在运行

docker logs newsapp-nginx --tail 20
# 查看是否有错误信息
```

### 4. 测试访问
```bash
# 在服务器上测试
curl -I https://news.gf-dsai.com

# 或在浏览器中访问
# https://news.gf-dsai.com
```

---

## 常见问题

### Q: 如果找不到证书文件怎么办？
A: 建议直接从1Panel Web界面下载证书，然后上传到 `deploy/ssl/` 目录。这是最简单可靠的方法。

### Q: 证书文件名不是fullchain.pem和privkey.pem怎么办？
A: 只需要重命名即可：
```bash
cd deploy/ssl
mv 实际证书文件名 fullchain.pem
mv 实际私钥文件名 privkey.pem
```

### Q: 如何查看1Panel使用的证书路径？
A: 在1Panel Web界面中，查看网站的nginx配置文件，通常会有 `ssl_certificate` 和 `ssl_certificate_key` 指令，那里会显示证书路径。

### Q: 证书更新后需要做什么？
A: 如果1Panel自动更新了证书，需要重新复制证书文件到 `deploy/ssl/` 目录，然后重启nginx容器：
```bash
# 重新复制证书
# ... (复制命令)
# 重启nginx
docker-compose restart nginx
```

