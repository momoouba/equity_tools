# AI配置测试故障排除指南

## 问题现象
AI模型配置页面显示"测试失败：Request failed with status code 404"错误。

## 可能的原因和解决方案

### 1. 用户权限问题

**原因**: 用户未正确登录或权限不足
**检查方法**:
1. 打开浏览器开发者工具 (F12)
2. 进入Console标签页
3. 点击测试按钮，查看控制台输出的用户信息

**解决方案**:
- 确保以管理员身份登录
- 检查localStorage中的用户信息是否完整
- 重新登录系统

### 2. API路由问题

**检查方法**:
```bash
# 测试服务器是否运行
curl http://localhost:3001/api/health

# 测试AI配置API（需要管理员权限）
curl -X GET http://localhost:3001/api/ai-config \
  -H "x-user-role: admin" \
  -H "x-user-id: admin123"
```

**解决方案**:
- 确保服务器正常运行
- 检查路由注册是否正确
- 重启服务器

### 3. 网络连接问题

**检查方法**:
1. 打开浏览器开发者工具
2. 进入Network标签页
3. 点击测试按钮，查看网络请求

**解决方案**:
- 检查前端和后端是否在正确的端口运行
- 确认防火墙没有阻止连接
- 检查代理设置

### 4. 数据库连接问题

**检查方法**:
查看服务器控制台是否有数据库连接错误

**解决方案**:
- 确保MySQL服务正在运行
- 检查数据库配置
- 验证数据库表是否正确创建

## 详细调试步骤

### 步骤1: 检查用户登录状态

1. 打开浏览器开发者工具 (F12)
2. 进入Console标签页
3. 输入以下命令检查用户信息:
```javascript
console.log(localStorage.getItem('user'));
```

**期望结果**: 应该显示包含用户ID和角色的JSON字符串
```json
{"id":"用户ID","role":"admin","account":"用户账号",...}
```

### 步骤2: 检查网络请求

1. 打开开发者工具的Network标签页
2. 点击测试按钮
3. 查看发送的请求详情

**检查要点**:
- 请求URL是否正确: `/api/ai-config/配置ID/test`
- 请求方法是否为POST
- 请求头是否包含`x-user-id`和`x-user-role`
- 响应状态码和错误信息

### 步骤3: 检查服务器日志

查看服务器控制台输出，寻找以下信息:
- 路由注册成功的消息
- 数据库连接状态
- 任何错误或警告信息

### 步骤4: 手动测试API

使用以下命令手动测试API（替换配置ID）:

**Windows PowerShell**:
```powershell
Invoke-WebRequest -Uri "http://localhost:3001/api/ai-config/配置ID/test" -Method POST -Headers @{"x-user-role"="admin"; "x-user-id"="admin123"}
```

**Linux/Mac**:
```bash
curl -X POST http://localhost:3001/api/ai-config/配置ID/test \
  -H "x-user-role: admin" \
  -H "x-user-id: admin123"
```

## 常见解决方案

### 解决方案1: 重新登录
1. 退出登录
2. 清除浏览器缓存
3. 重新以管理员身份登录

### 解决方案2: 重启服务
1. 停止前端和后端服务
2. 重新启动后端: `cd server && npm run dev`
3. 重新启动前端: `cd client && npm start`

### 解决方案3: 检查配置
1. 确认`.env`文件配置正确
2. 检查数据库连接参数
3. 验证端口没有被占用

### 解决方案4: 清除缓存
1. 清除浏览器缓存和Cookie
2. 清除localStorage数据
3. 刷新页面重新登录

## 预防措施

1. **定期检查**: 定期测试API功能确保正常工作
2. **日志监控**: 关注服务器日志中的错误信息
3. **权限管理**: 确保用户权限设置正确
4. **网络稳定**: 保持网络连接稳定

## 联系支持

如果以上方法都无法解决问题，请提供以下信息:
1. 浏览器控制台的完整错误信息
2. 服务器控制台的日志输出
3. 网络请求的详细信息（Headers、Response等）
4. 用户登录状态和权限信息

这些信息将有助于快速定位和解决问题。
