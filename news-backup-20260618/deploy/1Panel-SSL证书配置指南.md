# 1Panel SSL证书配置指南

## 问题说明

使用1Panel安装SSL证书后，需要在Docker部署的Nginx容器中配置SSL证书，使HTTPS访问正常工作。

## 解决方案

### 步骤1：查找1Panel证书位置

1Panel安装的SSL证书通常存储在以下路径之一：
- `/opt/1panel/certs/`
- `/opt/1panel/volumes/ssl/`
- 通过1Panel Web界面查看证书存储路径

在服务器上运行以下命令查找证书文件：

```bash
# 查找fullchain.pem或cert.pem文件
find /opt/1panel -name "fullchain.pem" -o -name "cert.pem" 2>/dev/null
find /opt/1panel -name "privkey.pem" -o -name "key.pem" 2>/dev/null

# 或者查找包含news.gf-dsai.com的目录
find /opt/1panel -type d -name "*news.gf-dsai.com*" 2>/dev/null
find /opt/1panel -type d -name "*gf-dsai*" 2>/dev/null
```

### 步骤2：创建SSL证书目录并复制证书

假设您的证书在 `/opt/1panel/certs/news.gf-dsai.com/` 目录下：

```bash
# 进入项目目录
cd /path/to/equity_news/news

# 创建ssl目录（如果不存在）
mkdir -p deploy/ssl

# 复制证书文件（根据实际路径调整）
sudo cp /opt/1panel/certs/news.gf-dsai.com/fullchain.pem deploy/ssl/
sudo cp /opt/1panel/certs/news.gf-dsai.com/privkey.pem deploy/ssl/

# 设置正确的权限
sudo chmod 644 deploy/ssl/fullchain.pem
sudo chmod 600 deploy/ssl/privkey.pem

# 如果使用非root用户，需要确保文件可读
sudo chown $(whoami):$(whoami) deploy/ssl/*.pem
```

**注意**：如果证书文件名不同（如 `cert.pem` 和 `key.pem`），需要重命名或创建符号链接。

### 步骤3：方法二 - 直接挂载1Panel证书目录（推荐）

如果1Panel的证书路径固定，可以直接在docker-compose.yml中挂载1Panel的证书目录。

编辑 `docker-compose.yml`，修改nginx服务的volumes部分：

```yaml
nginx:
  volumes:
    - ./deploy/nginx-site.conf:/etc/nginx/conf.d/default.conf:ro
    - ./logs/nginx:/var/log/nginx
    # 直接挂载1Panel证书目录（根据实际路径调整）
    - /opt/1panel/certs/news.gf-dsai.com:/etc/nginx/ssl:ro
    - app_frontend:/usr/share/nginx/html:ro
```

如果1Panel使用的文件名不同（如 `cert.pem` 和 `key.pem`），需要：
1. 在nginx配置中使用对应的文件名，或
2. 创建符号链接指向正确的文件名

### 步骤4：验证证书文件

```bash
# 检查证书文件是否存在
ls -la deploy/ssl/

# 验证证书内容（应该显示证书信息）
openssl x509 -in deploy/ssl/fullchain.pem -text -noout

# 验证私钥（应该显示私钥信息）
openssl rsa -in deploy/ssl/privkey.pem -check -noout
```

### 步骤5：更新Nginx配置

配置文件 `deploy/nginx-site.conf` 已经更新，包含：
- HTTP服务器（80端口）自动重定向到HTTPS
- HTTPS服务器（443端口）配置SSL证书

证书路径已设置为：`/etc/nginx/ssl/fullchain.pem` 和 `/etc/nginx/ssl/privkey.pem`

### 步骤6：重启Docker容器

```bash
# 进入项目目录
cd /path/to/equity_news/news

# 重启nginx容器
docker-compose restart nginx

# 或者重新创建nginx容器（如果配置有变化）
docker-compose up -d nginx

# 查看nginx容器日志，确认是否启动成功
docker logs newsapp-nginx

# 测试nginx配置是否正确
docker exec newsapp-nginx nginx -t
```

### 步骤7：验证HTTPS访问

```bash
# 在服务器上测试
curl -I https://news.gf-dsai.com

# 或者在浏览器中访问
https://news.gf-dsai.com
```

## 常见问题

### 问题1：证书文件路径错误

**症状**：Nginx启动失败，日志显示 "SSL certificate file not found"

**解决**：
1. 检查证书文件是否存在于 `deploy/ssl/` 目录
2. 检查docker-compose.yml中的挂载路径是否正确
3. 运行 `docker exec newsapp-nginx ls -la /etc/nginx/ssl/` 查看容器内的文件

### 问题2：证书文件名不匹配

**症状**：Nginx配置中指定的文件名与实际文件名不同

**解决**：
- 如果1Panel使用 `cert.pem` 而不是 `fullchain.pem`，可以：
  1. 重命名文件：`mv deploy/ssl/cert.pem deploy/ssl/fullchain.pem`
  2. 或创建符号链接：`ln -s cert.pem deploy/ssl/fullchain.pem`
  3. 或修改nginx配置中的文件名

### 问题3：权限问题

**症状**：Nginx无法读取证书文件

**解决**：
```bash
# 确保证书文件权限正确
sudo chmod 644 deploy/ssl/fullchain.pem
sudo chmod 600 deploy/ssl/privkey.pem

# 确保nginx容器可以访问（通常nginx以nginx用户运行）
# 如果使用挂载方式，确保文件可读
sudo chmod 644 /opt/1panel/certs/news.gf-dsai.com/fullchain.pem
sudo chmod 600 /opt/1panel/certs/news.gf-dsai.com/privkey.pem
```

### 问题4：证书格式问题

**症状**：Nginx报错 "SSL_CTX_use_certificate_file" 或类似错误

**解决**：
- 确保证书文件是PEM格式
- 检查证书文件内容是否完整（应该包含BEGIN和END标记）
- 验证证书是否包含完整证书链（fullchain.pem应该包含服务器证书和中间证书）

## 自动更新证书

如果1Panel自动更新证书，您需要确保：

1. **如果使用复制方式**：设置定时任务，定期从1Panel证书目录复制到 `deploy/ssl/`
2. **如果使用挂载方式**：证书更新后重启nginx容器即可

示例定时任务（每天凌晨3点检查并复制证书）：

```bash
# 编辑crontab
crontab -e

# 添加以下行（根据实际路径调整）
0 3 * * * cp /opt/1panel/certs/news.gf-dsai.com/fullchain.pem /path/to/equity_news/news/deploy/ssl/ && cp /opt/1panel/certs/news.gf-dsai.com/privkey.pem /path/to/equity_news/news/deploy/ssl/ && docker restart newsapp-nginx
```

## 验证清单

完成配置后，请确认：

- [ ] 证书文件已复制到 `deploy/ssl/` 或挂载路径正确
- [ ] 证书文件权限正确（fullchain.pem: 644, privkey.pem: 600）
- [ ] nginx配置文件已更新（包含HTTPS server块）
- [ ] docker-compose.yml中证书目录已正确挂载
- [ ] Nginx容器已重启
- [ ] Nginx配置测试通过（`docker exec newsapp-nginx nginx -t`）
- [ ] HTTPS访问正常（浏览器显示绿色锁图标）
- [ ] HTTP自动重定向到HTTPS

