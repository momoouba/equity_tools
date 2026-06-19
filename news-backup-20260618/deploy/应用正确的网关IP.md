# 应用正确的网关 IP

## ✅ 已确认

- 实际网关 IP：`172.18.0.1`（不是 `172.17.0.1`）
- 容器内测试 `172.17.0.1:3001` 成功，但应使用实际网关
- 配置文件已更新为 `172.18.0.1:3001`

## ✅ 重启容器

```bash
# 重启容器以应用新配置
sudo docker restart newsapp-nginx

# 等待几秒
sleep 5

# 检查容器状态
sudo docker ps | grep nginx

# 测试容器内的配置
sudo docker exec newsapp-nginx cat /etc/nginx/conf.d/default.conf | grep -A 5 "upstream"

# 测试 Nginx 配置
sudo docker exec newsapp-nginx nginx -t

# 重新加载配置
sudo docker exec newsapp-nginx nginx -s reload
```

## ✅ 验证修复

```bash
# 测试 API
curl http://news.gf-dsai.com/api/system/basic-config

# 测试登录 API
curl -X POST http://news.gf-dsai.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"admin","password":"wenchao"}'
```

## 🚀 一键重启和验证

```bash
# 重启容器并验证
sudo docker restart newsapp-nginx && \
sleep 5 && \
echo "=== 容器状态 ===" && \
sudo docker ps | grep nginx && \
echo -e "\n=== 检查配置 ===" && \
sudo docker exec newsapp-nginx cat /etc/nginx/conf.d/default.conf | grep -A 5 "upstream" && \
echo -e "\n=== 测试 Nginx 配置 ===" && \
sudo docker exec newsapp-nginx nginx -t && \
echo -e "\n=== 重新加载配置 ===" && \
sudo docker exec newsapp-nginx nginx -s reload && \
echo -e "\n=== 测试 API ===" && \
curl -s http://news.gf-dsai.com/api/system/basic-config | head -3
```

