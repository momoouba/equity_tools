#!/bin/bash

echo "=========================================="
echo "检查应用状态"
echo "=========================================="
echo ""

echo "1. 检查容器状态:"
sudo docker ps | grep newsapp || echo "  ⚠️ newsapp 容器未运行"
echo ""

echo "2. 检查应用健康状态:"
sudo docker exec newsapp node -e "
const http = require('http');
const req = http.get('http://127.0.0.1:3001/api/health', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('  状态码:', res.statusCode);
    console.log('  响应:', data);
    process.exit(res.statusCode === 200 ? 0 : 1);
  });
});
req.on('error', (e) => {
  console.error('  ❌ 连接失败:', e.message);
  console.error('  错误代码:', e.code);
  process.exit(1);
});
req.setTimeout(5000, () => {
  console.error('  ❌ 请求超时');
  req.destroy();
  process.exit(1);
});
" 2>&1 || echo "  ⚠️ 应用健康检查失败"
echo ""

echo "3. 检查应用日志（最近20行）:"
sudo docker compose logs app --tail 20 | tail -10
echo ""

echo "4. 检查端口监听:"
sudo docker exec newsapp netstat -tlnp 2>/dev/null | grep 3001 || \
sudo docker exec newsapp ss -tlnp 2>/dev/null | grep 3001 || \
echo "  ⚠️ 无法检查端口（netstat/ss 不可用）"
echo ""

echo "=========================================="
echo "检查完成"
echo "=========================================="

