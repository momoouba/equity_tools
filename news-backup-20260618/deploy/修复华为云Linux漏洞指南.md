# 修复华为云Linux漏洞指南

## 一、通过华为云控制台修复（推荐）

### 步骤1：进入漏洞管理页面
1. 登录华为云控制台
2. 进入"云服务器" → "漏洞管理" → "Linux漏洞"
3. 查看漏洞列表，找到高危漏洞（红色标记）

### 步骤2：查看漏洞详情
1. 点击漏洞名称（如"USN-7726-1: Linux kernel vulnerabilities"）
2. 在右侧详情面板查看：
   - 漏洞描述
   - 修复建议
   - CVE编号
   - 受影响服务器

### 步骤3：执行修复
**方法A：单个修复**
1. 选择要修复的漏洞（勾选复选框）
2. 点击"修复"按钮
3. 确认修复操作
4. 等待修复完成

**方法B：批量修复**
1. 勾选多个漏洞（或全选）
2. 点击"批量修复"按钮
3. 确认修复操作
4. 等待修复完成

### 步骤4：验证修复
1. 修复完成后，点击"验证"按钮
2. 确认漏洞已修复
3. 如果修复失败，查看错误信息并手动修复

## 二、手动修复（如果控制台修复失败）

### 步骤1：查看漏洞详情
在华为云控制台的漏洞详情中，找到"正式修复方案"部分，通常会提供：
- Git补丁链接（如：`https://git.kernel.org/stable/c/1c0a95d99b1b2b5d842e5abc7ef7eed1193b60d7`）
- 修复说明

### 步骤2：SSH登录服务器
```bash
ssh guofang@your-server-ip
```

### 步骤3：更新系统包
```bash
# 更新包列表
sudo apt update

# 升级所有包（包括安全更新）
sudo apt upgrade -y

# 或者只升级安全更新
sudo apt upgrade -y -o APT::Get::Upgrade-Allow-New=true
```

### 步骤4：更新内核（如果需要）
```bash
# 查看当前内核版本
uname -r

# 更新内核
sudo apt install --install-recommends linux-generic-hwe-22.04

# 重启服务器
sudo reboot
```

### 步骤5：验证修复
```bash
# 检查已安装的安全更新
apt list --upgradable | grep security

# 查看系统日志
sudo journalctl -u unattended-upgrades
```

## 三、常见漏洞修复说明

### USN-7726-1: Linux kernel vulnerabilities
- **影响**：Linux内核多个子系统漏洞
- **修复**：更新内核到最新版本
- **命令**：
  ```bash
  sudo apt update
  sudo apt upgrade linux-image-generic linux-headers-generic -y
  sudo reboot
  ```

### USN-7654-1: Linux kernel vulnerabilities
- **影响**：Linux内核多个架构漏洞
- **修复**：更新内核到最新版本
- **命令**：
  ```bash
  sudo apt update
  sudo apt upgrade linux-image-generic linux-headers-generic -y
  sudo reboot
  ```

## 四、注意事项

### 1. 备份数据
修复前务必备份重要数据：
```bash
# 备份重要配置文件
sudo tar -czf /backup/config-backup-$(date +%Y%m%d).tar.gz /etc

# 备份应用数据（根据实际情况调整路径）
sudo tar -czf /backup/app-data-backup-$(date +%Y%m%d).tar.gz /var/www
```

### 2. 选择维护窗口
- 内核更新通常需要重启服务器
- 建议在业务低峰期进行
- 提前通知相关人员

### 3. 测试环境先行
- 如果有测试环境，先在测试环境验证
- 确认修复不会影响业务

### 4. 监控修复过程
```bash
# 实时查看系统日志
sudo tail -f /var/log/syslog

# 查看更新日志
sudo tail -f /var/log/apt/history.log
```

## 五、修复后验证

### 1. 检查漏洞状态
- 返回华为云控制台
- 点击"手动扫描"重新扫描
- 确认漏洞已修复

### 2. 检查系统状态
```bash
# 检查系统负载
uptime

# 检查磁盘空间
df -h

# 检查内存使用
free -h

# 检查服务状态
sudo systemctl status
```

### 3. 检查应用运行状态
根据你的应用类型，检查关键服务是否正常运行。

## 六、故障排查

### 如果修复失败
1. **查看错误日志**
   ```bash
   sudo tail -100 /var/log/apt/history.log
   sudo journalctl -xe
   ```

2. **检查磁盘空间**
   ```bash
   df -h
   # 如果空间不足，清理旧内核
   sudo apt autoremove -y
   sudo apt autoclean
   ```

3. **检查网络连接**
   ```bash
   ping -c 4 archive.ubuntu.com
   ```

4. **手动下载补丁**
   如果自动更新失败，可以按照华为云控制台提供的Git链接手动下载并应用补丁。

## 七、预防措施

### 1. 启用自动安全更新
```bash
# 安装unattended-upgrades
sudo apt install unattended-upgrades -y

# 配置自动更新
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 2. 定期扫描漏洞
- 在华为云控制台设置定期扫描
- 或使用cron定时执行安全更新检查

### 3. 监控安全公告
- 订阅Ubuntu安全公告
- 关注华为云安全通知

---

**最后更新**：2025-12-11  
**适用系统**：Ubuntu 22.04 LTS  
**维护人员**：系统管理员

