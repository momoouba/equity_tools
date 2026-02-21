# 新闻详情接口测试说明

按下面步骤可快速验证接口是否可用（本地默认端口 **3001**，生产域名为 **news.gf-dsai.com**）。

---

## 一、先确认服务已启动

```bash
# 在项目 news 目录下启动服务（若未启动）
cd news
npm run dev
# 或
node server/index.js
```

健康检查（无需鉴权）：

```bash
curl http://localhost:3001/api/health
```

返回 `{"success":true,...}` 表示服务正常。

---

## 二、获取 API Token

接口鉴权需要 **用户 API Token**，需先登录拿到用户 ID，再请求 Token。

### 步骤 1：登录获取用户 ID

将 `账号`、`密码` 换成你系统中已有的用户（如默认 admin）：

```bash
curl -X POST http://localhost:3001/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"account\":\"admin\",\"password\":\"wenchao\"}"
```

（Linux / macOS 下把 `^` 换成 `\` 续行。）

在返回的 JSON 里找到 **user.id**，例如：`"id":"2025010112000100001"`。

### 步骤 2：用用户 ID 获取 API Token

把下面命令里的 `{用户ID}` 换成上一步的 **user.id**：

```bash
curl http://localhost:3001/api/auth/api-token -H "x-user-id: {用户ID}"
```

示例（用户 ID 为 2025010112000100001）：

```bash
curl http://localhost:3001/api/auth/api-token -H "x-user-id: 2025010112000100001"
```

返回示例：

```json
{
  "success": true,
  "message": "API Token 获取成功...",
  "token": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
}
```

记下 **token** 的值，后面请求都要带上。

---

## 三、测试新闻详情接口

下面所有请求都要带鉴权，二选一即可：

- `Authorization: Bearer <你的token>`
- 或 `X-Api-Token: <你的token>`

把 `{你的token}` 换成第二步拿到的 **token**。

### 1. 列表接口（分页）

```bash
curl "http://localhost:3001/api/news-detail?page=1&pageSize=5" ^
  -H "Authorization: Bearer {你的token}"
```

或使用 X-Api-Token：

```bash
curl "http://localhost:3001/api/news-detail?page=1&pageSize=5" ^
  -H "X-Api-Token: {你的token}"
```

**预期**：HTTP 200，JSON 中 `success: true`，且有 `data`、`total`、`page`、`pageSize`。

可选参数示例（关键词 + 时间范围）：

```bash
curl "http://localhost:3001/api/news-detail?page=1&pageSize=10&keyword=科技&startTime=2025-01-01&endTime=2025-12-31" ^
  -H "Authorization: Bearer {你的token}"
```

### 2. 单条详情接口（按 ID）

从列表接口的 `data[0].id` 取一条 ID，或使用你已知的新闻 ID：

```bash
curl "http://localhost:3001/api/news-detail/2025022112000100001" ^
  -H "Authorization: Bearer {你的token}"
```

把 `2025022112000100001` 换成真实的 **id**。

**预期**：  
- 有数据：HTTP 200，`success: true`，`data` 为单条对象（含 content 等）。  
- 无数据或已删除：HTTP 404，`success: false`，`message` 为「未找到该 ID 或已删除」。

### 3. 鉴权失败（应返回 401）

不带 Token 或带错误 Token：

```bash
curl "http://localhost:3001/api/news-detail?page=1&pageSize=5"
```

**预期**：HTTP 401，body 中 `success: false`，提示缺少鉴权或 Token 无效。

---

## 四、生产环境测试

### 在哪里执行？

- **推荐：在你自己的电脑上测**（本机终端 / PowerShell / CMD），**不用登录到服务器**。  
  本机执行 `curl https://news.gf-dsai.com/api/...` 或使用 Postman，就是模拟第三方从公网访问生产接口，这样测最接近真实调用。
- **可选：在服务器上执行**。若你 SSH 到生产服务器，在服务器终端里执行 `curl https://news.gf-dsai.com/api/...` 也可以，等价于从服务器本机访问生产；一般用来确认服务是否在跑、端口是否通。
- **浏览器 Console**。在浏览器打开生产站点并登录后，在 F12 的 Console 里用 `fetch` 调用接口即可，见下文「五、浏览器 Console 测试」。

总结：**生产环境测试 = 在本机或浏览器里访问 `https://news.gf-dsai.com` 的接口**，不是在服务器里“输入代码”，除非你特意在服务器终端里跑 curl。

### 本机终端示例（把 {用户ID}、{你的token}、{某条id} 换成实际值）

```bash
# 获取 Token（需先有对应用户 ID，一般由登录接口返回）
curl https://news.gf-dsai.com/api/auth/api-token -H "x-user-id: {用户ID}"

# 列表
curl "https://news.gf-dsai.com/api/news-detail?page=1&pageSize=5" -H "Authorization: Bearer {你的token}"

# 单条
curl "https://news.gf-dsai.com/api/news-detail/{某条id}" -H "Authorization: Bearer {你的token}"
```

---

## 五、浏览器 Console 测试（生产/本地都适用）

在**浏览器**里测、且不想用 Postman 时，可以用 Console：

1. 打开生产站点（如 `https://news.gf-dsai.com`），先**登录**。
2. 按 **F12** 打开开发者工具，切到 **Console** 面板。
3. 在 Console 里**一段一段**粘贴下面代码并回车执行（先执行「步骤 A」拿到 token，再执行「步骤 B」调接口）。

**步骤 A：先拿到 API Token（依赖当前已登录的会话）**

前端若在登录后把用户 ID 存到了 localStorage 或全局变量，可用下面方式之一拿到 `userId`，再请求 token：

```javascript
// 若你们前端把 userId 存在 localStorage（键名按实际改，例如 user_id / userId）
var userId = localStorage.getItem('user_id') || localStorage.getItem('userId');
if (!userId) {
  console.log('请先登录；若登录后仍没有 user_id，请从登录接口响应里抄下 user.id 填到下面');
  userId = '你的用户ID';  // 手动填一次
}
fetch('https://news.gf-dsai.com/api/auth/api-token', { headers: { 'x-user-id': userId } })
  .then(r => r.json())
  .then(d => { window._apiToken = d.token; console.log('Token 已存到 window._apiToken', d); });
```

**步骤 B：用 Token 调新闻详情接口**

```javascript
var token = window._apiToken || '这里粘贴你的token';
fetch('https://news.gf-dsai.com/api/news-detail?page=1&pageSize=5', {
  headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json()).then(d => console.log(d));
```

- 若返回对象里 `success: true` 且有 `data`，说明接口是通的。
- 测单条时把 URL 改成：`'https://news.gf-dsai.com/api/news-detail/' + 某条id` 即可。

**注意**：Console 里请求的是**当前浏览器所在环境**（本机或任意能打开该页面的电脑），所以这是在「浏览器所在机器」上测生产环境，**不需要在服务器里输入任何代码**。

---

## 六、用 PowerShell 测试（Windows）

PowerShell 示例（列表，Token 需替换）：

```powershell
$token = "你的token"
Invoke-RestMethod -Uri "http://localhost:3001/api/news-detail?page=1&pageSize=5" `
  -Headers @{ "Authorization" = "Bearer $token" } -Method Get
```

---

## 七、用 Postman / Apifox 等

1. **登录**：POST `http://localhost:3001/api/auth/login`，Body 选 raw JSON：  
   `{"account":"admin","password":"wenchao"}`  
   从响应里复制 **user.id**。
2. **获取 Token**：GET `http://localhost:3001/api/auth/api-token`，Header 增加：  
   `x-user-id: <刚复制的 user.id>`  
   从响应里复制 **token**。
3. **列表**：GET `http://localhost:3001/api/news-detail?page=1&pageSize=5`，Header 增加：  
   `Authorization: Bearer <token>` 或 `X-Api-Token: <token>`。
4. **单条**：GET `http://localhost:3001/api/news-detail/{id}`，同样加上上述鉴权 Header。

按上述步骤，能拿到 200 且 `success: true` 即说明接口是通的。
