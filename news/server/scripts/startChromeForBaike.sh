#!/usr/bin/env bash
# 在 Linux 宿主机启动带 CDP 的 Chrome/Chromium，供 Docker 内百科抓取 connect_over_cdp。
# 用法（宿主机）：
#   chmod +x server/scripts/startChromeForBaike.sh
#   ./server/scripts/startChromeForBaike.sh
# 无桌面时：
#   xvfb-run -a ./server/scripts/startChromeForBaike.sh
# 然后（容器）：
#   BAIKE_BROWSER_MODE=cdp
#   BAIKE_CDP_URL=http://host.docker.internal:9222
#   docker compose up -d app --force-recreate
#
# 安装浏览器（任选其一）：
#   sudo apt-get update && sudo apt-get install -y chromium-browser
#   # 或 Ubuntu 新版本：sudo apt-get install -y chromium
#   # 或官方 Chrome deb：
#   wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
#   sudo apt-get install -y ./google-chrome-stable_current_amd64.deb

set -euo pipefail

PORT="${BAIKE_CDP_PORT:-9222}"
# snap Chromium 只能写 ~/snap/chromium/...；自定义家目录 profile 会 Permission denied
if [[ -z "${BAIKE_CHROME_PROFILE:-}" ]]; then
  if [[ -d "${HOME}/snap/chromium" ]] || [[ "$(readlink -f /usr/bin/chromium-browser 2>/dev/null || true)" == *snap* ]]; then
    PROFILE="${HOME}/snap/chromium/common/baike-poc"
  else
    PROFILE="${HOME}/.chrome-baike-poc"
  fi
else
  PROFILE="${BAIKE_CHROME_PROFILE}"
fi
mkdir -p "$PROFILE"

CHROME="${BAIKE_CHROME_PATH:-}"
if [[ -z "$CHROME" ]]; then
  for c in \
    /usr/bin/google-chrome-stable \
    /usr/bin/google-chrome \
    /usr/bin/chromium-browser \
    /usr/bin/chromium \
    /snap/bin/chromium
  do
    if [[ -x "$c" ]]; then
      CHROME="$c"
      break
    fi
  done
fi

if [[ -z "$CHROME" ]]; then
  echo "未找到 Chrome/Chromium。" >&2
  echo "请先安装其一：" >&2
  echo "  sudo apt-get update && sudo apt-get install -y chromium-browser" >&2
  echo "  # 或: sudo apt-get install -y chromium" >&2
  echo "  # 或官方 deb:" >&2
  echo "  wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb" >&2
  echo "  sudo apt-get install -y ./google-chrome-stable_current_amd64.deb" >&2
  echo "也可设置 BAIKE_CHROME_PATH=/path/to/chrome" >&2
  exit 1
fi

echo "[startChromeForBaike] Chrome: $CHROME"
echo "[startChromeForBaike] Profile: $PROFILE"
echo "[startChromeForBaike] CDP port: $PORT"
echo "[startChromeForBaike] 启动后请打开 https://baike.baidu.com 并完成一次安全验证（如出现）"
echo "[startChromeForBaike] 容器侧请设: BAIKE_BROWSER_MODE=cdp BAIKE_CDP_URL=http://host.docker.internal:${PORT}"

ARGS=(
  "--remote-debugging-port=${PORT}"
  "--remote-debugging-address=0.0.0.0"
  "--remote-allow-origins=*"
  "--user-data-dir=${PROFILE}"
  "--no-first-run"
  "--no-default-browser-check"
  "--disable-dev-shm-usage"
)

exec "$CHROME" "${ARGS[@]}" "https://baike.baidu.com/"
