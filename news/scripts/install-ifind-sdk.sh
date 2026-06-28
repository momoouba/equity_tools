#!/bin/bash
# 同花顺 iFinD SDK 自动下载安装脚本 (Linux)
# 使用方式: ./install-ifind-sdk.sh

set -e

INSTALL_PATH="${1:-/opt/ths_sdk}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "同花顺 iFinD SDK 安装脚本 (Linux)"
echo "========================================"
echo ""

# 检查是否已安装
if [ -d "$INSTALL_PATH" ] && [ "$(ls -A $INSTALL_PATH)" ]; then
    echo "检测到 SDK 已存在于: $INSTALL_PATH"
    read -p "是否重新安装? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "跳过安装"
        exit 0
    fi
    rm -rf "$INSTALL_PATH"
fi

echo "由于同花顺 iFinD SDK 需要官网授权下载，请按以下步骤操作："
echo ""
echo "1. 访问同花顺官网下载 iFinD 数据接口 SDK:"
echo "   https://www.51ifind.com/"
echo ""
echo "2. 登录您的 iFinD 账号"
echo ""
echo "3. 下载 Linux 版 iFinD 数据接口 SDK (THSDataInterface_Linux_*.tar)"
echo ""
echo "4. 将下载的压缩包上传到服务器，然后解压到以下路径："
echo "   $INSTALL_PATH"
echo ""
echo "   解压命令:"
echo "   sudo mkdir -p $INSTALL_PATH"
echo "   sudo tar -xvf THSDataInterface_Linux_*.tar -C $INSTALL_PATH"
echo ""
echo "5. 运行安装脚本："
echo "   sudo python3 $INSTALL_PATH/bin64/installiFinDPy.py $INSTALL_PATH"
echo ""
echo "========================================"
echo ""

# 检查目录是否已存在（用户手动放置）
if [ -d "$INSTALL_PATH" ] && [ "$(ls -A $INSTALL_PATH)" ]; then
    echo "检测到 SDK 目录已存在，验证安装..."

    # 验证 Python 模块
    if python3 -c "import sys; sys.path.insert(0, '$INSTALL_PATH/bin64'); import iFinDPy; print('iFinDPy 模块加载成功')" 2>/dev/null; then
        echo "SDK 验证成功!"
    else
        echo "SDK 验证失败，请运行安装脚本:"
        echo "  sudo python3 $INSTALL_PATH/bin64/installiFinDPy.py $INSTALL_PATH"
    fi
else
    # 创建目录
    sudo mkdir -p "$INSTALL_PATH"
    echo "已创建目录: $INSTALL_PATH"
    echo "请将下载的 SDK 压缩包上传并解压到此目录"
    echo ""
    echo "示例命令："
    echo "  sudo tar -xvf THSDataInterface_Linux_20260227.tar -C $INSTALL_PATH"
fi

echo ""
echo "获取 refresh_token 步骤："
echo "1. 在 Windows 环境打开同花顺 iFinD 金融数据终端"
echo "2. 登录您的账号"
echo "3. 进入「超级命令」→「工具」→「refresh_token 查询」"
echo "4. 复制 refresh_token"
echo "5. 在管理后台「系统设置 → 上市数据配置」中填入 Token"
echo ""
echo "注意：Linux 环境使用 HTTP API 方式，不需要本地 SDK 登录"
echo "      只需要配置 refresh_token 即可"
echo ""
