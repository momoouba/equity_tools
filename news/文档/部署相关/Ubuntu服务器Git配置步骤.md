# Ubuntu 服务器 Git 配置和更新步骤

## 📋 前提条件

- ✅ Ubuntu 服务器已安装 Docker 和 Docker Compose
- ✅ 项目已通过 Docker 部署运行
- ✅ `update-from-git.sh` 脚本已上传到服务器

---

## 🔧 步骤1：检查 Git 是否已安装

```bash
# 检查 Git 版本
git --version

# 如果未安装，执行以下命令安装
sudo apt update
sudo apt install git -y
```

---

## 📁 步骤2：进入项目目录

```bash
# 进入项目目录（根据你的实际路径调整）
cd /opt/newsapp/news
# 或
cd /home/your-user/news
# 或你的实际项目路径

# 确认 update-from-git.sh 文件存在
ls -la deploy/update-from-git.sh
```

---

## 🔐 步骤3：初始化 Git 仓库（如果还没有）

### 3.1 检查是否已有 Git 仓库

```bash
# 检查是否已有 .git 目录
ls -la .git
```

### 3.2 如果没有，初始化 Git 仓库

```bash
# 初始化 Git 仓库
git init

# 配置 Git 用户信息（用于提交记录）
git config user.name "Server User"
git config user.email "server@example.com"

# 或者全局配置（推荐）
git config --global user.name "Server User"
git config --global user.email "server@example.com"
```

---

## 🌐 步骤4：配置远程仓库

### 4.1 添加远程仓库

```bash
# 添加远程仓库（替换为你的实际 Git 仓库地址）
git remote add origin https://github.com/your-username/your-repo.git

# 或使用 SSH（如果配置了 SSH 密钥）
# git remote add origin git@github.com:your-username/your-repo.git

# 查看远程仓库配置
git remote -v
```

### 4.2 如果远程仓库已存在，更新地址

```bash
# 查看当前远程仓库
git remote -v

# 如果需要修改远程仓库地址
git remote set-url origin https://github.com/your-username/your-repo.git
```

---

## 🔑 步骤5：配置 Git 认证

### 方法1：使用 HTTPS + 个人访问令牌（推荐，简单）

```bash
# 1. 在 GitHub/GitLab 创建个人访问令牌
#    - GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic)
#    - GitLab: User Settings → Access Tokens
#    权限需要：repo（读取仓库）

# 2. 配置 Git 凭据存储（可选，避免每次输入）
git config --global credential.helper store

# 3. 首次拉取时会提示输入用户名和令牌
#    用户名：你的 GitHub/GitLab 用户名
#    密码：输入个人访问令牌（不是账户密码）
git pull origin main
```

### 方法2：使用 SSH 密钥（更安全，推荐）

```bash
# 1. 检查是否已有 SSH 密钥
ls -la ~/.ssh/id_rsa*

# 2. 如果没有，生成新的 SSH 密钥
ssh-keygen -t rsa -b 4096 -C "server@example.com"
# 按 Enter 使用默认路径，可以设置密码或留空

# 3. 查看公钥内容
cat ~/.ssh/id_rsa.pub

# 4. 将公钥添加到 GitHub/GitLab
#    - GitHub: Settings → SSH and GPG keys → New SSH key
#    - GitLab: User Settings → SSH Keys
#    复制上面显示的公钥内容，粘贴到平台

# 5. 测试 SSH 连接
ssh -T git@github.com
# 应该看到：Hi username! You've successfully authenticated...

# 6. 如果使用 SSH，修改远程仓库地址
git remote set-url origin git@github.com:your-username/your-repo.git
```

---

## 📝 步骤6：首次拉取代码（如果远程仓库已有代码）

```bash
# 拉取远程代码（根据你的分支名称调整）
git pull origin main
# 或
git pull origin master
# 或
git pull origin develop

# 如果提示需要设置上游分支
git branch --set-upstream-to=origin/main main
```

---

## ✅ 步骤7：给更新脚本添加执行权限

```bash
# 添加执行权限
chmod +x deploy/update-from-git.sh

# 确认权限已设置
ls -la deploy/update-from-git.sh
# 应该看到：-rwxr-xr-x（有 x 权限）
```

---

## 🚀 步骤8：执行更新脚本

### 8.1 基本使用（默认拉取 main 分支）

```bash
# 执行更新脚本
./deploy/update-from-git.sh
```

### 8.2 指定分支

```bash
# 拉取 master 分支
./deploy/update-from-git.sh master

# 拉取 develop 分支
./deploy/update-from-git.sh develop
```

### 8.3 脚本执行流程

脚本会自动执行以下操作：
1. ✅ 备份当前代码
2. ✅ 检查本地修改
3. ✅ 从 Git 拉取最新代码
4. ✅ 检查依赖变化
5. ✅ 检查前端代码变化并重新构建（如果需要）
6. ✅ 重启 Docker 容器
7. ✅ 显示服务状态和日志

---

## 🔍 步骤9：验证更新

### 9.1 检查容器状态

```bash
# 查看容器状态
docker compose ps

# 应该看到所有容器都是 Up 状态
```

### 9.2 查看应用日志

```bash
# 查看应用日志（最近50行）
docker compose logs app --tail 50

# 持续查看日志
docker compose logs -f app
```

### 9.3 测试健康检查

```bash
# 测试 API 健康检查
curl http://localhost:3001/api/health

# 应该返回：{"status":"ok","message":"服务器运行正常","database":"connected"}
```

---

## 📋 完整操作示例

```bash
# ============================================
# 完整配置流程（首次配置）
# ============================================

# 1. 进入项目目录
cd /opt/newsapp/news

# 2. 检查 Git 是否安装
git --version || sudo apt install git -y

# 3. 初始化 Git 仓库（如果还没有）
if [ ! -d .git ]; then
    git init
    git config user.name "Server User"
    git config user.email "server@example.com"
fi

# 4. 配置远程仓库（替换为你的实际地址）
git remote add origin https://github.com/your-username/your-repo.git
# 或
# git remote add origin git@github.com:your-username/your-repo.git

# 5. 配置 Git 凭据存储（HTTPS 方式）
git config --global credential.helper store

# 6. 首次拉取代码（会提示输入用户名和令牌）
git pull origin main

# 7. 给脚本添加执行权限
chmod +x deploy/update-from-git.sh

# 8. 执行更新脚本
./deploy/update-from-git.sh

# ============================================
# 后续更新（只需执行这一步）
# ============================================
cd /opt/newsapp/news
./deploy/update-from-git.sh
```

---

## ⚠️ 常见问题处理

### 问题1：Git 拉取时提示认证失败

```bash
# 检查远程仓库配置
git remote -v

# 清除缓存的凭据（重新输入）
git credential-cache exit
# 或
git config --global --unset credential.helper

# 重新拉取，会提示输入用户名和令牌
git pull origin main
```

### 问题2：SSH 连接失败

```bash
# 测试 SSH 连接
ssh -T git@github.com

# 如果失败，检查 SSH 密钥
ls -la ~/.ssh/

# 重新生成 SSH 密钥（如果需要）
ssh-keygen -t rsa -b 4096 -C "server@example.com"

# 查看公钥并添加到 GitHub/GitLab
cat ~/.ssh/id_rsa.pub
```

### 问题3：脚本执行权限被拒绝

```bash
# 添加执行权限
chmod +x deploy/update-from-git.sh

# 确认权限
ls -la deploy/update-from-git.sh
```

### 问题4：代码拉取后容器未更新

```bash
# 1. 确认代码已拉取
git log --oneline -5

# 2. 确认文件已更新
stat server/db.js

# 3. 手动重启容器
docker compose restart app

# 4. 查看容器日志
docker compose logs app --tail 50
```

### 问题5：本地有未提交的修改

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

---

## 📝 快速参考命令

```bash
# 查看 Git 状态
git status

# 查看远程仓库
git remote -v

# 查看提交历史
git log --oneline -10

# 拉取代码
git pull origin main

# 查看分支
git branch -a

# 切换到其他分支
git checkout develop

# 执行更新脚本
./deploy/update-from-git.sh

# 查看容器状态
docker compose ps

# 查看应用日志
docker compose logs app --tail 50
```

---

## ✅ 配置完成检查清单

- [ ] Git 已安装（`git --version`）
- [ ] Git 仓库已初始化（`ls -la .git`）
- [ ] 远程仓库已配置（`git remote -v`）
- [ ] Git 认证已配置（HTTPS 令牌或 SSH 密钥）
- [ ] 可以成功拉取代码（`git pull origin main`）
- [ ] 更新脚本有执行权限（`chmod +x deploy/update-from-git.sh`）
- [ ] 测试更新脚本可以正常工作（`./deploy/update-from-git.sh`）

---

## 🎉 完成！

配置完成后，后续更新代码只需执行：

```bash
cd /opt/newsapp/news
./deploy/update-from-git.sh
```

脚本会自动处理所有更新流程！

---

**最后更新**：2025-01-XX  
**适用环境**：Ubuntu + Docker Compose  
**Git 版本**：2.x+

