# 修复pip网络超时问题

## 问题描述

Docker构建时，`pip install`步骤出现网络超时错误：
```
pip._vendor.urllib3.exceptions.ReadTimeoutError: HTTPSConnectionPool(host='files.pythonhosted.org', port=443): Read timed out.
```

这是因为pip默认使用PyPI官方源，在国内访问速度慢。

## 解决方案

已在Dockerfile中为pip配置了：
1. **国内镜像源**：使用清华大学PyPI镜像（pypi.tuna.tsinghua.edu.cn）
2. **超时设置**：300秒（5分钟）
3. **重试次数**：5次

## 已更新的Dockerfile配置

```dockerfile
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    && pip config set global.timeout 300 \
    && pip config set global.retries 5 \
    && pip install --break-system-packages --no-cache-dir -r ./server/utils/requirements.txt
```

## 其他pip镜像源选项

如果清华大学镜像仍然慢，可以尝试：

### 阿里云镜像
```dockerfile
pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/
```

### 腾讯云镜像
```dockerfile
pip config set global.index-url https://mirrors.cloud.tencent.com/pypi/simple
```

### 华为云镜像
```dockerfile
pip config set global.index-url https://repo.huaweicloud.com/repository/pypi/simple
```

### 中科大镜像
```dockerfile
pip config set global.index-url https://pypi.mirrors.ustc.edu.cn/simple
```

## 重新构建步骤

```bash
# 确保Dockerfile已更新（包含pip镜像源配置）
grep "pypi.tuna.tsinghua.edu.cn" Dockerfile

# 重新构建
sudo docker compose build --no-cache app
```

## 预期时间

使用国内镜像源后：
- `apk add`：1-3分钟（已优化）
- `npm ci`（前端）：2-5分钟（已优化）
- `npm ci --only=production`（后端）：1-3分钟（已优化）
- `pip install`：2-5分钟（已优化）
- **总构建时间：15-25分钟**

## 如果仍然超时

1. **检查网络连接**：
   ```bash
   curl -I https://pypi.tuna.tsinghua.edu.cn/simple
   ```

2. **尝试其他镜像源**（修改Dockerfile中的index-url）

3. **增加超时时间**（修改timeout为更大的值，单位秒）

4. **分步安装Python包**（便于定位哪个包慢）：
   ```dockerfile
   RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple \
       && pip install --break-system-packages --no-cache-dir requests>=2.31.0 \
       && pip install --break-system-packages --no-cache-dir beautifulsoup4>=4.12.0 \
       && pip install --break-system-packages --no-cache-dir lxml>=4.9.0 \
       && pip install --break-system-packages --no-cache-dir Pillow>=10.0.0
   ```

