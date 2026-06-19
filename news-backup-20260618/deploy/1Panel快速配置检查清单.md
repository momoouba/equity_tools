# 1Panel快速配置检查清单

## ✅ 第一步：验证容器是否在1Panel中可见

### 检查项

- [ ] 登录1Panel Web界面
- [ ] 进入 **容器** → **容器列表**
- [ ] 确认能看到以下三个容器：
  - [ ] `newsapp-mysql` (状态：运行中)
  - [ ] `newsapp` (状态：运行中)
  - [ ] `newsapp-nginx` (状态：运行中)

### 如果看不到容器

在1Panel终端中执行：
```bash
cd /opt/newsapp/news
docker compose ps
```

如果容器存在但1Panel看不到，可能需要：
1. 刷新1Panel页面
2. 检查1Panel是否有权限访问Docker
3. 在1Panel中手动导入Compose项目

---

## ✅ 第二步：在1Panel中导入Compose项目（可选但推荐）

### ⚠️ 重要说明

**不需要重新创建容器！** 您的容器已经存在并运行中。这一步只是让1Panel识别并管理现有的docker-compose项目。

### 操作步骤

1. [ ] 进入 **容器** → **Compose**（或 **Compose项目**）
2. [ ] 点击 **创建** 或 **新建项目** 或 **导入项目**
3. [ ] 填写信息：
   - 项目名称：`newsapp`
   - 项目路径：`/opt/newsapp/news`
   - 描述：`新闻管理系统`
4. [ ] 选择配置文件：`/opt/newsapp/news/docker-compose.yml`
   - 或者直接粘贴docker-compose.yml的内容
5. [ ] 点击 **创建** 或 **导入**
   - **注意**：如果提示容器已存在，选择"使用现有容器"或"不重新创建"
6. [ ] **不要点击启动**（容器已经在运行）

### 验证

- [ ] 在Compose项目列表中看到 `newsapp` 项目
- [ ] 项目状态显示为 **运行中**（因为容器已经在运行）
- [ ] 所有服务（mysql、app、nginx）都显示为运行状态

### 如果1Panel没有Compose管理功能

如果1Panel版本较旧，没有Compose管理功能，可以：
- 直接在 **容器列表** 中管理各个容器
- 不需要导入Compose项目，容器已经可以被1Panel识别和管理

---

## ✅ 第三步：配置SSL证书（如果还未配置）

### 检查项

- [ ] 进入 **网站** → **证书**
- [ ] 确认 `news.gf-dsai.com` 证书状态为 **正常**
- [ ] 证书文件已复制到 `/opt/newsapp/news/deploy/ssl/`
  - [ ] `fullchain.pem` 存在
  - [ ] `privkey.pem` 存在

### 如果证书未配置

参考：`deploy/1Panel-SSL证书配置指南.md`

---

## ✅ 第四步：验证网站访问

### 检查项

- [ ] HTTP访问正常：`http://news.gf-dsai.com`
- [ ] HTTPS访问正常：`https://news.gf-dsai.com`
- [ ] HTTP自动重定向到HTTPS
- [ ] 浏览器显示绿色锁图标（SSL证书有效）

### 如果无法访问

1. 检查容器状态
2. 查看Nginx日志
3. 检查端口是否被占用

---

## ✅ 第五步：配置数据库管理（可选）

### 方法一：通过容器终端

- [ ] 进入 **容器** → **容器列表** → **newsapp-mysql** → **终端**
- [ ] 测试连接：
  ```bash
  mysql -u newsapp -pNewsApp@2024 investment_tools
  ```

### 方法二：在1Panel中添加外部数据库（如果支持）

- [ ] 进入 **数据库** → **添加数据库**
- [ ] 填写连接信息：
  - 类型：MySQL
  - 主机：`localhost`
  - 端口：`3307`
  - 用户：`newsapp`
  - 密码：`NewsApp@2024`
  - 数据库：`investment_tools`
- [ ] 测试连接
- [ ] 保存

---

## ✅ 第六步：设置监控和告警（可选）

### 检查项

- [ ] 在 **概览** 中查看系统资源使用情况
- [ ] 在容器详情中查看资源监控
- [ ] 设置资源告警阈值（如果支持）：
  - [ ] CPU使用率 > 80%
  - [ ] 内存使用率 > 80%
  - [ ] 磁盘使用率 > 85%

---

## ✅ 第七步：配置定时任务（可选）

### 建议的定时任务

1. **数据库备份**（每天凌晨2点）
   ```bash
   cd /opt/newsapp/news
   docker compose exec mysql mysqldump -u newsapp -pNewsApp@2024 investment_tools > /opt/backups/db_$(date +%Y%m%d).sql
   ```

2. **日志清理**（每周一次）
   ```bash
   find /opt/newsapp/news/logs -name "*.log" -mtime +7 -delete
   ```

3. **容器健康检查**（每小时）
   ```bash
   cd /opt/newsapp/news
   docker compose ps | grep -q "Up" || docker compose restart
   ```

### 操作步骤

- [ ] 进入 **计划任务** → **创建任务**
- [ ] 添加上述任务
- [ ] 设置执行时间和频率
- [ ] 测试任务执行

---

## ✅ 第八步：配置文件管理

### 检查项

- [ ] 在1Panel中可以通过 **文件管理** 访问：
  - [ ] `/opt/newsapp/news/` - 项目目录
  - [ ] `/opt/newsapp/news/logs/` - 日志目录
  - [ ] `/opt/newsapp/news/uploads/` - 上传文件目录
  - [ ] `/opt/newsapp/news/deploy/` - 部署配置目录

### 权限设置

- [ ] 确保1Panel有权限访问这些目录
- [ ] 如果需要，设置适当的文件权限

---

## ✅ 第九步：测试常用操作

### 在1Panel中测试

- [ ] **重启应用容器**：
  - 容器列表 → newsapp → 重启
  - 验证应用正常访问

- [ ] **查看应用日志**：
  - 容器列表 → newsapp → 日志
  - 确认能看到应用日志

- [ ] **查看Nginx日志**：
  - 容器列表 → newsapp-nginx → 日志
  - 确认能看到访问日志

- [ ] **进入容器终端**：
  - 容器列表 → newsapp → 终端
  - 执行命令测试

---

## ✅ 第十步：文档和备份

### 检查项

- [ ] 记录1Panel访问地址和账号密码（安全保存）
- [ ] 记录Docker Compose项目配置
- [ ] 备份docker-compose.yml文件
- [ ] 备份SSL证书文件
- [ ] 记录数据库连接信息

---

## 🎯 完成检查

完成以上所有检查项后，您的newsapp系统就已经完全集成到1Panel中了！

### 后续维护

- 定期在1Panel中检查容器状态
- 定期查看日志和监控
- 定期备份数据库
- 定期更新Docker镜像

---

## 📞 遇到问题？

参考详细文档：`deploy/1Panel集成管理指南.md`

