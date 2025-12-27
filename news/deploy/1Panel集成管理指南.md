# 1Panel集成管理指南

本指南说明如何在1Panel中管理newsapp系统。

## 📋 目录

1. [在1Panel中管理Docker Compose应用](#1-在1panel中管理docker-compose应用)
2. [管理容器](#2-管理容器)
3. [管理网站和SSL证书](#3-管理网站和ssl证书)
4. [管理数据库](#4-管理数据库)
5. [查看日志](#5-查看日志)
6. [监控和资源管理](#6-监控和资源管理)
7. [常用操作](#7-常用操作)

---

## 1. 在1Panel中管理Docker Compose应用

### 方法一：通过1Panel的容器管理（推荐）

1. **登录1Panel**
   - 访问1Panel Web界面

2. **进入容器管理**
   - 左侧菜单：**容器** → **Compose**
   - 或直接访问：**容器** → **Compose项目**

3. **创建Compose项目**
   - 点击 **创建** 或 **新建项目**
   - 项目名称：`newsapp`
   - 项目路径：`/opt/newsapp/news`
   - 描述：`新闻管理系统`

4. **导入现有docker-compose.yml**
   - 选择 **从文件创建** 或 **导入现有配置**
   - 配置文件路径：`/opt/newsapp/news/docker-compose.yml`
   - 或者直接粘贴docker-compose.yml内容

5. **启动项目**
   - 点击 **启动** 或 **Up**
   - 1Panel会自动识别并管理所有服务

### 方法二：通过终端导入（如果方法一不可用）

如果1Panel不支持直接导入，可以：

1. **在1Panel终端中执行**
   ```bash
   cd /opt/newsapp/news
   docker compose up -d
   ```

2. **然后在1Panel容器管理中查看**
   - 进入 **容器** → **容器列表**
   - 应该能看到三个容器：
     - `newsapp-mysql`
     - `newsapp`
     - `newsapp-nginx`

---

## 2. 管理容器

### 2.1 查看容器状态

**路径**：**容器** → **容器列表**

您应该看到以下容器：

| 容器名 | 镜像 | 状态 | 端口 |
|--------|------|------|------|
| newsapp-mysql | mysql:8.0 | Running | 3307:3306 |
| newsapp | newsapp:latest | Running | 3001:3001 |
| newsapp-nginx | nginx:alpine | Running | 80:80, 443:443 |

### 2.2 容器操作

在容器列表中，可以对每个容器执行：

- **启动**：启动停止的容器
- **停止**：停止运行中的容器
- **重启**：重启容器
- **删除**：删除容器（谨慎操作）
- **日志**：查看容器日志
- **终端**：进入容器终端
- **详情**：查看容器详细信息

### 2.3 常用操作

#### 重启应用容器
```
容器列表 → newsapp → 重启
```

#### 查看应用日志
```
容器列表 → newsapp → 日志
```

#### 进入容器终端
```
容器列表 → newsapp → 终端
```

---

## 3. 管理网站和SSL证书

### 3.1 在1Panel中创建网站（可选）

如果您想通过1Panel管理网站配置：

1. **创建网站**
   - **网站** → **网站** → **创建网站**
   - 域名：`news.gf-dsai.com`
   - 类型：**反向代理**
   - 目标地址：`http://newsapp-nginx:80`（或使用容器IP）

2. **配置SSL证书**
   - 在网站详情中，选择 **SSL** 标签
   - 选择已安装的证书：`news.gf-dsai.com`
   - 启用 **强制HTTPS**

**注意**：如果已经通过Docker Nginx配置了SSL，可以跳过此步骤。

### 3.2 管理SSL证书

**路径**：**网站** → **证书**

- 查看证书状态
- 续期证书
- 下载证书文件
- 查看证书详情

---

## 4. 管理数据库

### 4.1 在1Panel中连接MySQL

1. **进入数据库管理**
   - **数据库** → **MySQL**

2. **添加数据库**
   - 点击 **创建数据库**
   - 数据库名：`investment_tools`
   - 用户：`newsapp`
   - 密码：`NewsApp@2024`（根据实际配置调整）

3. **连接信息**
   - 主机：`localhost` 或 `127.0.0.1`
   - 端口：`3307`（docker-compose.yml中映射的端口）
   - 用户：`newsapp`
   - 密码：`NewsApp@2024`
   - 数据库：`investment_tools`

### 4.2 通过容器连接（推荐）

如果1Panel的数据库管理无法直接连接，可以通过容器：

1. **进入MySQL容器终端**
   ```
   容器列表 → newsapp-mysql → 终端
   ```

2. **连接MySQL**
   ```bash
   mysql -u newsapp -pNewsApp@2024 investment_tools
   ```

3. **执行SQL**
   ```sql
   SHOW TABLES;
   SELECT * FROM users LIMIT 10;
   ```

### 4.3 使用1Panel的数据库管理工具

如果1Panel支持外部数据库连接：

1. **添加外部数据库**
   - **数据库** → **添加数据库**
   - 类型：MySQL
   - 主机：`localhost`
   - 端口：`3307`
   - 用户：`newsapp`
   - 密码：`NewsApp@2024`
   - 数据库：`investment_tools`

---

## 5. 查看日志

### 5.1 容器日志

**路径**：**容器** → **容器列表** → **选择容器** → **日志**

可以查看：
- 实时日志
- 历史日志
- 按时间筛选
- 导出日志

### 5.2 应用日志文件

应用日志存储在：`/opt/newsapp/news/logs/`

在1Panel中可以通过：
- **文件管理** → 浏览到 `/opt/newsapp/news/logs/`
- 或使用 **终端** 查看：
  ```bash
  tail -f /opt/newsapp/news/logs/app.log
  ```

### 5.3 Nginx日志

Nginx日志位置：
- 访问日志：`/opt/newsapp/news/logs/nginx/access.log`
- 错误日志：`/opt/newsapp/news/logs/nginx/error.log`

---

## 6. 监控和资源管理

### 6.1 容器资源监控

**路径**：**容器** → **容器列表** → **选择容器** → **监控**

可以查看：
- CPU使用率
- 内存使用率
- 网络流量
- 磁盘IO

### 6.2 系统监控

**路径**：**概览** 或 **系统监控**

查看：
- 服务器资源使用情况
- 磁盘空间
- 网络流量
- 进程列表

### 6.3 设置告警（如果支持）

在1Panel中配置资源告警：
- CPU使用率超过阈值
- 内存使用率超过阈值
- 磁盘空间不足

---

## 7. 常用操作

### 7.1 更新应用代码

#### 方法一：通过1Panel终端
```
终端 → 执行命令：
cd /opt/newsapp/news
git pull  # 如果使用Git
docker compose restart app
```

#### 方法二：通过容器管理
```
容器列表 → newsapp → 重启
```

### 7.2 备份数据库

#### 通过1Panel终端
```bash
# 进入项目目录
cd /opt/newsapp/news

# 备份数据库
docker compose exec mysql mysqldump -u newsapp -pNewsApp@2024 investment_tools > backup_$(date +%Y%m%d).sql

# 或使用1Panel的备份功能（如果支持）
```

### 7.3 查看容器状态

```
容器 → Compose → newsapp → 查看状态
```

### 7.4 重启所有服务

```
容器 → Compose → newsapp → 重启
```

或通过终端：
```bash
cd /opt/newsapp/news
docker compose restart
```

### 7.5 更新Docker镜像

```bash
# 在1Panel终端中执行
cd /opt/newsapp/news
docker compose pull
docker compose up -d
```

### 7.6 查看容器资源使用

```
容器列表 → 选择容器 → 监控
```

---

## 8. 1Panel配置建议

### 8.1 创建Compose项目模板

在1Panel中保存docker-compose.yml作为模板，方便后续管理。

### 8.2 设置定时任务

在1Panel中设置定时任务：

**路径**：**计划任务** → **创建任务**

示例任务：
- **数据库备份**（每天凌晨2点）
- **日志清理**（每周一次）
- **容器健康检查**（每小时）

### 8.3 配置通知

在1Panel中配置通知（如果支持）：
- 容器异常停止
- 资源使用过高
- SSL证书即将过期

---

## 9. 故障排查

### 9.1 容器无法启动

1. **查看容器日志**
   ```
   容器列表 → 选择容器 → 日志
   ```

2. **检查容器状态**
   ```
   容器列表 → 选择容器 → 详情
   ```

3. **检查资源使用**
   ```
   容器列表 → 选择容器 → 监控
   ```

### 9.2 应用无法访问

1. **检查容器状态**
   - 确保所有容器都在运行

2. **检查端口映射**
   - 确保80和443端口未被占用

3. **检查Nginx配置**
   ```
   容器列表 → newsapp-nginx → 终端
   nginx -t
   ```

4. **查看Nginx日志**
   ```
   容器列表 → newsapp-nginx → 日志
   ```

### 9.3 数据库连接失败

1. **检查MySQL容器状态**
   ```
   容器列表 → newsapp-mysql → 状态
   ```

2. **测试数据库连接**
   ```
   容器列表 → newsapp-mysql → 终端
   mysql -u newsapp -pNewsApp@2024 investment_tools
   ```

3. **检查网络连接**
   - 确保容器在同一网络中

---

## 10. 最佳实践

### 10.1 定期备份

- 数据库备份：每天
- 配置文件备份：每次修改后
- 上传文件备份：每周

### 10.2 监控资源

- 定期检查容器资源使用
- 设置资源告警阈值
- 及时清理日志文件

### 10.3 安全配置

- 定期更新Docker镜像
- 使用强密码
- 限制容器资源使用
- 定期检查SSL证书有效期

### 10.4 日志管理

- 定期清理旧日志
- 监控错误日志
- 设置日志轮转

---

## 11. 快速参考

### 常用命令（在1Panel终端中执行）

```bash
# 进入项目目录
cd /opt/newsapp/news

# 查看容器状态
docker compose ps

# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart app
docker compose restart nginx
docker compose restart mysql

# 查看日志
docker compose logs -f app
docker compose logs -f nginx
docker compose logs -f mysql

# 停止所有服务
docker compose down

# 启动所有服务
docker compose up -d

# 查看资源使用
docker stats
```

### 1Panel操作路径

| 功能 | 路径 |
|------|------|
| 查看容器 | 容器 → 容器列表 |
| 管理Compose | 容器 → Compose |
| 查看日志 | 容器 → 容器列表 → 选择容器 → 日志 |
| 管理网站 | 网站 → 网站 |
| 管理证书 | 网站 → 证书 |
| 管理数据库 | 数据库 → MySQL |
| 系统监控 | 概览 |
| 计划任务 | 计划任务 |

---

## 12. 注意事项

1. **不要删除容器数据卷**
   - 删除容器前，确保数据已备份
   - 特别是MySQL数据卷

2. **修改配置后重启容器**
   - 修改docker-compose.yml后需要重启
   - 修改nginx配置后需要重启nginx容器

3. **端口冲突**
   - 确保80、443、3001、3307端口未被其他服务占用

4. **资源限制**
   - 为容器设置合理的资源限制
   - 避免容器占用过多系统资源

5. **定期更新**
   - 定期更新Docker镜像
   - 定期更新系统补丁

---

## 总结

通过1Panel，您可以：
- ✅ 统一管理所有容器
- ✅ 可视化查看日志和监控
- ✅ 方便地管理SSL证书
- ✅ 通过Web界面执行常用操作
- ✅ 设置定时任务和告警

这样就不需要每次都SSH登录服务器执行命令了！

