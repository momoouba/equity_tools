# Docker 环境 Git 配置指南

## 📋 概述

本指南说明如何在 Docker 部署环境中配置 Git，以便从 Git 仓库拉取代码更新。

## 🎯 推荐方案：在宿主机配置 Git

由于 `docker-compose.yml` 中 `server` 目录是直接挂载的（`./server:/app/server`），**推荐在宿主机上配置 Git**，这样：
- ✅ 代码修改后只需重启容器即可生效
- ✅ 不需要重新构建镜像
- ✅ 更新速度快
- ✅ 配置简单

---

## 📝 步骤1：在宿主机上初始化 Git 仓库

### 1.1 检查是否已有 Git 仓库

```bash
# 进入项目目录（根据你的实际路径调整）
cd /opt/newsapp/news  # 或你的实际项目路径

# 检查是否已有 Git 仓库
ls -la .git
```

### 1.2 如果没有 Git 仓库，初始化并配置

```bash
# 进入项目目录
cd /opt/newsapp/news

# 初始化 Git 仓库（如果还没有）
git init

# 添加远程仓库（替换为你的实际 Git 仓库地址）
git remote add origin https://github.com/your-username/your-repo.git
# 或使用 SSH（如果配置了 SSH 密钥）
# git remote add origin git@github.com:your-username/your-repo.git

# 查看远程仓库配置
git remote -v
```

### 1.3 配置 Git 用户信息（如果还没有配置）

```bash
# 配置用户名和邮箱（用于提交记录）
git config user.name "Your Name"
git config user.email "your.email@example.com"

# 或者全局配置（推荐）
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### 1.4 首次拉取代码

```bash
# 拉取远程代码（如果远程仓库已有代码）
git pull origin main
# 或
git pull origin master

# 如果远程仓库是空的，或者你想保留本地文件，可以：
# 1. 先提交本地文件
git add .
git commit -m "Initial commit"

# 2. 然后推送到远程（如果远程仓库已创建）
git push -u origin main
```

---

## 🔐 步骤2：配置 Git 认证

### 方法1：使用 HTTPS + 个人访问令牌（推荐）

```bash
# 1. 在 GitHub/GitLab 等平台创建个人访问令牌（Personal Access Token）
#    - GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic)
#    - GitLab: User Settings → Access Tokens

# 2. 配置 Git 使用令牌（每次拉取时输入令牌作为密码）
git pull origin main
# 用户名：你的 GitHub/GitLab 用户名
# 密码：输入个人访问令牌（不是账户密码）

# 3. 或者将令牌保存到 Git 凭据存储（可选）
git config --global credential.helper store
# 然后执行一次 git pull，输入令牌后会自动保存
```

### 方法2：使用 SSH 密钥（更安全，推荐）

```bash
# 1. 检查是否已有 SSH 密钥
ls -la ~/.ssh/id_rsa*

# 2. 如果没有，生成新的 SSH 密钥
ssh-keygen -t rsa -b 4096 -C "your.email@example.com"
# 按 Enter 使用默认路径，可以设置密码或留空

# 3. 查看公钥内容
cat ~/.ssh/id_rsa.pub

# 4. 将公钥添加到 GitHub/GitLab
#    - GitHub: Settings → SSH and GPG keys → New SSH key
#    - GitLab: User Settings → SSH Keys

# 5. 测试 SSH 连接
ssh -T git@github.com
# 或
ssh -T git@gitlab.com

# 6. 如果使用 SSH，修改远程仓库地址
git remote set-url origin git@github.com:your-username/your-repo.git
```

### 方法3：使用 Git Credential Manager（适合 Windows）

```bash
# Windows 上可以使用 Git Credential Manager
git config --global credential.helper manager-core
```

---

## 🚀 步骤3：创建更新脚本

创建一个便捷的更新脚本，方便后续使用：

```bash
# 创建更新脚本
cat > /opt/newsapp/news/deploy/update-from-git.sh << 'EOF'
#!/bin/bash

# Docker 环境 Git 更新脚本
# 使用方法: ./deploy/update-from-git.sh

set -e

echo "=========================================="
echo "  从 Git 拉取代码并更新 Docker 容器"
echo "=========================================="
echo ""

# 进入项目目录
cd "$(dirname "$0")/.." || exit

# 1. 备份当前代码（可选）
echo "步骤 1: 备份当前代码..."
BACKUP_DIR="backups/backup-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r server "$BACKUP_DIR/" 2>/dev/null || true
echo "✓ 备份完成: $BACKUP_DIR"
echo ""

# 2. 拉取最新代码
echo "步骤 2: 从 Git 拉取最新代码..."
BRANCH=${1:-main}  # 默认使用 main 分支，可以通过参数指定
echo "拉取分支: $BRANCH"

if git pull origin "$BRANCH"; then
    echo "✓ 代码拉取成功"
else
    echo "✗ 代码拉取失败，请检查："
    echo "  1. Git 远程仓库配置是否正确"
    echo "  2. 网络连接是否正常"
    echo "  3. 认证信息是否正确"
    exit 1
fi
echo ""

# 3. 检查是否有冲突
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  警告：检测到未提交的本地修改"
    git status
    read -p "是否继续？(y/n): " continue_update
    if [ "$continue_update" != "y" ] && [ "$continue_update" != "Y" ]; then
        echo "已取消更新"
        exit 1
    fi
fi
echo ""

# 4. 检查是否需要安装新的依赖
echo "步骤 3: 检查依赖..."
if [ -f package.json ] && [ -n "$(git diff HEAD@{1} HEAD -- package.json package-lock.json 2>/dev/null)" ]; then
    echo "检测到依赖文件有变化，需要安装依赖"
    read -p "是否在宿主机安装依赖？(y/n，默认n): " install_deps
    if [ "$install_deps" = "y" ] || [ "$install_deps" = "Y" ]; then
        echo "正在安装依赖..."
        npm install --production
        echo "✓ 依赖安装完成"
    fi
fi
echo ""

# 5. 检查是否需要重新构建前端
echo "步骤 4: 检查前端代码..."
if [ -d client ] && [ -n "$(git diff HEAD@{1} HEAD -- client/ 2>/dev/null)" ]; then
    echo "检测到前端代码有变化"
    read -p "是否重新构建前端？(y/n，默认y): " rebuild_frontend
    if [ "$rebuild_frontend" != "n" ] && [ "$rebuild_frontend" != "N" ]; then
        echo "正在重新构建前端..."
        cd client
        npm install
        npm run build
        cd ..
        echo "✓ 前端构建完成"
        
        # 更新前端文件到 Docker volume
        echo "正在更新前端文件到 Docker volume..."
        if [ -f deploy/clear-cache-and-update.sh ]; then
            chmod +x deploy/clear-cache-and-update.sh
            ./deploy/clear-cache-and-update.sh
        else
            echo "⚠️  未找到前端更新脚本，请手动更新前端文件"
        fi
    fi
fi
echo ""

# 6. 重启 Docker 容器
echo "步骤 5: 重启 Docker 容器..."
if docker compose ps | grep -q "newsapp.*Up"; then
    echo "正在重启应用容器..."
    docker compose restart app
    echo "✓ 容器已重启"
else
    echo "容器未运行，正在启动..."
    docker compose up -d app
    echo "✓ 容器已启动"
fi
echo ""

# 7. 等待服务启动
echo "步骤 6: 等待服务启动..."
sleep 5

# 8. 检查服务状态
echo "步骤 7: 检查服务状态..."
docker compose ps

echo ""
echo "步骤 8: 查看应用日志（最近50行）..."
docker compose logs app --tail 50

echo ""
echo "=========================================="
echo "  更新完成！"
echo "=========================================="
echo ""
echo "后续操作:"
echo "1. 查看完整日志: docker compose logs -f app"
echo "2. 检查服务状态: docker compose ps"
echo "3. 测试健康检查: curl http://localhost:3001/api/health"
echo ""
EOF

# 添加执行权限
chmod +x /opt/newsapp/news/deploy/update-from-git.sh
```

---

## 📖 步骤4：使用更新脚本

### 基本使用

```bash
# 进入项目目录
cd /opt/newsapp/news

# 执行更新脚本（默认拉取 main 分支）
./deploy/update-from-git.sh

# 或指定分支
./deploy/update-from-git.sh master
./deploy/update-from-git.sh develop
```

### 手动更新流程

如果不想使用脚本，可以手动执行：

```bash
# 1. 进入项目目录
cd /opt/newsapp/news

# 2. 拉取最新代码
git pull origin main

# 3. 如果前端有变化，重新构建前端
cd client
npm run build
cd ..

# 4. 更新前端文件到 Docker volume（如果有脚本）
./deploy/clear-cache-and-update.sh

# 5. 重启应用容器
docker compose restart app

# 6. 查看日志
docker compose logs app --tail 50
```

---

## 🔍 步骤5：验证配置

### 检查 Git 配置

```bash
# 检查远程仓库配置
cd /opt/newsapp/news
git remote -v

# 检查当前分支
git branch

# 检查 Git 状态
git status

# 查看提交历史
git log --oneline -10
```

### 测试 Git 拉取

```bash
# 测试拉取（不会实际拉取，只是检查）
cd /opt/newsapp/news
git fetch origin

# 查看远程分支
git branch -r

# 查看本地和远程的差异
git log HEAD..origin/main --oneline
```

---

## ⚠️ 注意事项

### 1. 代码冲突处理

如果本地有未提交的修改，Git 拉取可能会失败：

```bash
# 查看未提交的修改
git status

# 方法1：提交本地修改
git add .
git commit -m "本地修改说明"
git pull origin main

# 方法2：暂存本地修改
git stash
git pull origin main
git stash pop  # 恢复本地修改

# 方法3：放弃本地修改（谨慎使用）
git reset --hard HEAD
git pull origin main
```

### 2. 分支管理

```bash
# 查看所有分支
git branch -a

# 切换到其他分支
git checkout develop

# 创建新分支
git checkout -b feature/new-feature

# 合并分支
git merge develop
```

### 3. 回滚到之前的版本

```bash
# 查看提交历史
git log --oneline -20

# 回滚到指定提交（保留文件修改）
git reset --soft <commit-hash>

# 回滚到指定提交（丢弃文件修改）
git reset --hard <commit-hash>

# 然后重启容器
docker compose restart app
```

### 4. 忽略文件

确保 `.gitignore` 文件正确配置，避免提交不必要的文件：

```bash
# 检查 .gitignore
cat .gitignore

# 常见的应该忽略的文件：
# - node_modules/
# - .env
# - logs/
# - uploads/
# - *.log
```

---

## 🛠️ 故障排查

### 问题1：Git 拉取失败 - 认证错误

```bash
# 检查远程仓库地址
git remote -v

# 重新配置认证
# HTTPS: 确保个人访问令牌正确
# SSH: 测试 SSH 连接
ssh -T git@github.com

# 清除缓存的凭据（如果需要）
git credential-cache exit
# 或
git config --global --unset credential.helper
```

### 问题2：Git 拉取失败 - 网络问题

```bash
# 检查网络连接
ping github.com

# 使用代理（如果需要）
git config --global http.proxy http://proxy.example.com:8080
git config --global https.proxy https://proxy.example.com:8080

# 取消代理
git config --global --unset http.proxy
git config --global --unset https.proxy
```

### 问题3：代码拉取后容器未更新

```bash
# 1. 确认代码已拉取
git log --oneline -5

# 2. 确认文件已更新
stat server/db.js

# 3. 重启容器
docker compose restart app

# 4. 检查容器内的文件
docker compose exec app ls -la /app/server/db.js

# 5. 查看容器日志
docker compose logs app --tail 50
```

### 问题4：前端更新后看不到变化

```bash
# 1. 确认前端已重新构建
ls -lht client/dist/ | head -5

# 2. 确认前端文件已更新到 volume
docker run --rm -v newsapp_app_frontend:/target alpine ls -la /target | head -10

# 3. 清除浏览器缓存
# 在浏览器中按 Ctrl+Shift+Delete

# 4. 重启 nginx 容器
docker compose restart nginx
```

---

## 📚 常用 Git 命令参考

```bash
# 查看状态
git status

# 查看差异
git diff

# 添加文件
git add <file>
git add .

# 提交更改
git commit -m "提交说明"

# 推送到远程
git push origin main

# 拉取更新
git pull origin main

# 查看提交历史
git log --oneline -20

# 查看文件修改历史
git log --follow -- <file>

# 撤销未提交的修改
git checkout -- <file>

# 查看远程仓库信息
git remote show origin
```

---

## ✅ 配置完成检查清单

- [ ] Git 仓库已初始化
- [ ] 远程仓库已配置（`git remote -v`）
- [ ] Git 认证已配置（HTTPS 令牌或 SSH 密钥）
- [ ] 可以成功拉取代码（`git pull origin main`）
- [ ] 更新脚本已创建（`deploy/update-from-git.sh`）
- [ ] 更新脚本有执行权限
- [ ] 测试更新脚本可以正常工作

---

## 🎉 完成！

配置完成后，你可以使用以下命令更新代码：

```bash
cd /opt/newsapp/news
./deploy/update-from-git.sh
```

或者手动执行：

```bash
cd /opt/newsapp/news
git pull origin main
docker compose restart app
```

---

**最后更新**：2025-01-XX  
**适用环境**：Docker Compose 部署  
**Git 版本**：2.x+

