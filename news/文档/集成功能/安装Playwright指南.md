# 安装Playwright指南

## 问题

执行 `pip install playwright --break-system-packages` 时出现错误：
```
no such option: --break-system-packages
```

**原因**：pip 版本较旧（< 23.0），不支持 `--break-system-packages` 选项。

## 解决方案

### 方案1：升级pip（推荐）

```bash
# 进入容器
sudo docker compose exec app sh

# 升级pip
python3 -m pip install --upgrade pip

# 然后安装Playwright（不再需要--break-system-packages）
pip install playwright

# 安装Chromium浏览器
playwright install chromium

# 退出容器
exit
```

### 方案2：不使用--break-system-packages选项

如果pip版本较旧且无法升级，可以尝试：

```bash
# 进入容器
sudo docker compose exec app sh

# 直接安装（不推荐，可能失败）
pip install playwright

# 如果失败，尝试使用--user选项
pip install --user playwright

# 安装Chromium浏览器
playwright install chromium

# 退出容器
exit
```

### 方案3：在Dockerfile中安装（永久方案）

修改 `Dockerfile`，在安装Python依赖后添加：

```dockerfile
# 在安装Python依赖的部分之后添加
RUN pip install --upgrade pip \
    && pip install playwright \
    && playwright install chromium
```

然后重新构建镜像：
```bash
cd /opt/newsapp/news
sudo docker compose build app
sudo docker compose up -d
```

## 检查pip版本

```bash
# 进入容器
sudo docker compose exec app sh

# 检查pip版本
pip --version

# 如果版本 < 23.0，需要升级
python3 -m pip install --upgrade pip
```

## 验证安装

安装完成后，验证Playwright是否正常工作：

```bash
# 进入容器
sudo docker compose exec app sh

# 测试Playwright
python3 -c "from playwright.sync_api import sync_playwright; print('Playwright安装成功')"
```

## 注意事项

1. **Alpine Linux限制**：Alpine Linux可能缺少Playwright所需的系统依赖
2. **浏览器安装**：`playwright install chromium` 需要下载约300MB的浏览器文件
3. **权限问题**：确保有足够的权限安装到系统目录

## 如果Alpine Linux安装失败

如果Alpine Linux上安装失败，可能需要安装额外的系统依赖：

```bash
# 在Dockerfile中添加系统依赖
RUN apk add --no-cache \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont
```

或者考虑使用基于Debian的镜像（如 `node:18` 而不是 `node:18-alpine`）。

