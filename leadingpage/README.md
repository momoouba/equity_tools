# aileading.gf-dsai.com 配置文件

本目录包含 `aileading.gf-dsai.com` 域名相关的配置文件。

## 文件说明

- `AI工具推荐网站.html` - 主页面HTML文件
- `aileading-nginx.conf` - Nginx HTTPS配置模板
- `aileading-nginx-http-only.conf` - Nginx HTTP配置模板（备用）
- `ssl/` - SSL证书目录

## 当前配置

当前配置已集成到 `/opt/newsapp/news/deploy/nginx-site.conf` 中，通过Docker nginx容器提供服务。

## 配置位置

- **Nginx配置**: `/opt/newsapp/news/deploy/nginx-site.conf`
- **Docker配置**: `/opt/newsapp/news/docker-compose.yml`
- **SSL证书**: `/opt/newsapp/news/deploy/ssl/aileading-fullchain.pem`
- **SSL私钥**: `/opt/newsapp/news/deploy/ssl/aileading-privkey.pem`

## 访问地址

- HTTPS: https://aileading.gf-dsai.com
- HTTP: http://aileading.gf-dsai.com (自动重定向到HTTPS)

