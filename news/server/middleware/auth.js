// 简单的认证中间件，从请求头或session中获取用户信息
// 这里假设前端在请求头中传递用户ID，或者从session中获取
function getCurrentUser(req, res, next) {
  // 从请求头获取用户ID（前端需要在请求头中传递）
  const userId = req.headers['x-user-id'];
  
  // 或者从session中获取（如果使用session）
  // const userId = req.session?.userId;
  
  // 临时方案：从请求体或查询参数中获取（开发阶段）
  // const userId = req.body.userId || req.query.userId;
  
  req.currentUserId = userId ? parseInt(userId, 10) : null;
  next();
}

module.exports = { getCurrentUser };

