// 测试正文提取的Node.js脚本
// 在容器内运行: sudo docker exec newsapp node /app/deploy/test-extraction.js

const http = require('http');

const url = process.argv[2] || 'https://www.gelonghui.com/news/5136685';
const userId = process.argv[3] || '2025112019135100001';

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

console.log('正在测试URL:', url);
console.log('用户ID:', userId);
console.log('');

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

