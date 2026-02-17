# 同步弹窗「W.format is not a function」排查步骤

## 现象

在「系统配置 → 新闻接口配置」点击某条数据的「同步」，在弹窗里选时间后点「确定」，Console 报错：`Uncaught TypeError: W.format is not a function`，且无法正常修改时间。

---

## 第一步：确认当前跑的是不是「新前端」

当前同步弹窗已改为**纯原生实现**（无 Arco Modal/DatePicker），界面应是：

- **新前端**：弹窗里是**两个日期时间输入框**（浏览器自带的 `datetime-local`），下方是「取消」「确定」两个普通按钮，**没有**「2026年2月」日历和「选择时间」。
- **旧前端**：弹窗里是**一个日历** + 「此刻」「选择时间」「取消」「确定」——说明仍在跑旧包。

### 1.1 看界面

打开同步弹窗后看：

- 若看到**日历 + 选择时间** → 一定是旧前端，按下面「第二步」处理部署/缓存。
- 若看到**两个日期时间输入框** → 是新前端；若仍报错，再按 1.2、1.3 排查。

### 1.2 看 Console 日志

打开同步弹窗时，Console 里应出现：

```text
[NewsConfig] 同步弹窗已打开 (v2-native，若看到此日志说明当前运行的是新前端)
```

- **有这条日志** → 当前页面用的是新前端。
- **没有这条日志** → 当前页面用的是旧前端，需要确保新前端真正被部署并命中（见第二步）。

### 1.3 看 DOM（开发者工具 Elements）

打开同步弹窗后，在 Elements 里找遮罩节点：

- **新前端**：有一个 `id="news-config-sync-modal-overlay"` 的 div，且带有 `data-sync-modal-version="v2-native"`。
- **旧前端**：是 Arco 的 Modal/Dialog 结构，没有 `news-config-sync-modal-overlay` 和 `data-sync-modal-version`。

---

## 第二步：若确认是「旧前端」——部署与缓存

若 1.1～1.3 都说明是旧前端，问题在**部署或缓存**，按下面逐项做。

### 2.1 本地重新构建

```bash
cd /opt/newsapp/news/client
npm run build
```

构建完成后看 `dist/assets/` 下 JS 文件名（如 `index-XXXXXXXX.js`），记下**新 hash**。

### 2.2 把新构建拷进 Nginx 用的 volume

```bash
cd /opt/newsapp/news
sudo bash deploy/update-frontend-volume.sh
```

若脚本报错，可手动查 volume 并复制：

```bash
VOLUME_NAME=$(sudo docker volume ls -q | grep app_frontend | head -1)
echo "Volume: $VOLUME_NAME"
VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" | grep Mountpoint | awk '{print $2}' | tr -d '",')
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r client/dist/* "$VOLUME_PATH/"
```

### 2.3 确认 Nginx 用的是新文件

```bash
# 看 volume 里 index.html 引用的 JS 名
sudo grep -o 'index-[^"]*\.js' "$VOLUME_PATH/index.html"
```

这里应看到**和 2.1 里一致的新 hash**。若不是，说明复制未生效或复制错了目录。

### 2.4 禁止 index.html 被缓存（Nginx）

**当前已配置**：`deploy/nginx-site.conf` 里新闻站点的 `location = /index.html` 和 `location /` 已添加：

```nginx
add_header Cache-Control "no-cache, no-store, must-revalidate";
```

若你修改过配置或不确定是否生效，可检查该 server 块内是否有上述两处，然后重载 Nginx：

```bash
sudo docker compose exec nginx nginx -t && sudo docker compose exec nginx nginx -s reload
```

### 2.5 浏览器侧

- 无痕窗口重新打开页面，或  
- 强刷：`Ctrl+Shift+R`（Windows/Linux）或 `Cmd+Shift+R`（Mac）

再重复第一步，确认是否变为「新前端」。

---

## 第三步：若确认已是「新前端」仍报错

若 1.1～1.3 都确认是新前端，但点「确定」仍报 `W.format is not a function`，则可能是：

- 页面上**其它地方**仍有 Arco DatePicker/TimePicker 的 `onChange` 里调用了 `.format()`（例如其它 Tab、其它弹窗）。
- 报错栈里的 `onChange` 可能来自**其它组件**，不是同步弹窗本身。

此时可：

1. **开发环境带 sourcemap 复现**  
   在 `vite.config.js` 里临时设 `sourcemap: true`，重新 `npm run build`，在浏览器里看报错栈对应到**哪个源文件、哪一行**，确认是哪个组件的 `onChange`。
2. **看报错栈**  
   在 Console 里展开该 TypeError，看栈里第一个「非 node_modules、非 index-xxx.js」的文件名和行号，把该组件里的日期/时间选择器改为不用 `.format()`（或先用 `dayjs(x)` 再 `x.format()`，并做空值判断）。

---

## 快速对照表

| 你看到的弹窗 | Console 有 v2-native 日志 | DOM 有 data-sync-modal-version | 结论 |
|-------------|---------------------------|---------------------------------|------|
| 日历 + 选择时间 | 否 | 否 | 旧前端，按第二步做部署与缓存 |
| 两个日期时间框 | 是 | 是 | 新前端，若仍报错按第三步查其它组件 |
| 两个日期时间框 | 否 | 否 | 可能是混合/缓存，清缓存并重做第二步 |
