#!/bin/bash

# 诊断工具：测试特定URL的正文提取
# 使用方法: ./诊断正文提取.sh <URL> [用户ID]

URL="${1:-https://www.gelonghui.com/news/5136685}"
USER_ID="${2:-2025112019135100001}"

echo "=========================================="
echo "正文提取诊断工具"
echo "=========================================="
echo ""
echo "测试URL: $URL"
echo "用户ID: $USER_ID"
echo ""

# 检查容器是否运行
if ! sudo docker ps | grep -q newsapp; then
    echo "错误: newsapp 容器未运行"
    exit 1
fi

# 在容器内使用 Node.js 执行诊断
echo "正在执行诊断..."
echo ""

# 创建临时 Node.js 脚本
TEMP_SCRIPT="/tmp/diagnose_$$.js"
cat > "$TEMP_SCRIPT" << 'EOF'
const http = require('http');

const url = process.argv[2];
const userId = process.argv[3];

const data = JSON.stringify({ url });

const options = {
  hostname: '127.0.0.1',  // 使用 IPv4 地址，避免 IPv6 问题
  port: 3001,
  path: '/api/news-analysis/diagnose-extraction',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': userId,
    'x-user-role': 'admin',
    'Content-Length': data.length
  },
  timeout: 60000  // 60秒超时
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    try {
      const result = JSON.parse(body);
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.log(body);
    }
  });
});

req.on('error', (e) => {
  console.error('请求失败:', e.message);
  console.error('错误代码:', e.code);
  if (e.code === 'ECONNREFUSED') {
    console.error('提示: 应用可能未运行或端口不正确');
    console.error('请检查: sudo docker ps | grep newsapp');
    console.error('请检查: sudo docker compose logs app --tail 20');
  }
  process.exit(1);
});

req.setTimeout(60000, () => {
  console.error('请求超时');
  req.destroy();
  process.exit(1);
});

req.write(data);
req.end();
EOF

# 复制脚本到容器并执行
sudo docker cp "$TEMP_SCRIPT" newsapp:/tmp/diagnose.js
sudo docker exec newsapp node /tmp/diagnose.js "$URL" "$USER_ID"

# 清理临时文件
rm -f "$TEMP_SCRIPT"
sudo docker exec newsapp rm -f /tmp/diagnose.js 2>/dev/null || true

echo ""
echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="
echo ""
echo "提示: 如果输出格式不美观，可以将输出保存到文件："
echo "  ./诊断正文提取.sh '$URL' > /tmp/diagnose_result.json"
echo ""

