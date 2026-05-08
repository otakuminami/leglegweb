#!/bin/bash
set -e

# ============================================
# LegLeg 国内部署脚本 (Ubuntu 22.04)
# ============================================
# 使用方法：
#   1. 在本机打包:  tar czf leglegweb.tar.gz --exclude=node_modules .
#   2. 上传到服务器: scp leglegweb.tar.gz root@<服务器IP>:/tmp/
#   3. SSH 登录服务器，运行: bash /tmp/setup.sh
#   或者直接用本脚本（已上传到服务器）
# ============================================

APP_DIR="/var/www/leglegweb"
TARBALL="/tmp/leglegweb.tar.gz"

echo "=== 1. 更新系统 ==="
apt update && apt upgrade -y

echo "=== 2. 安装 Node.js 22 ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi
echo "Node.js $(node -v)"

echo "=== 3. 安装 Nginx ==="
apt install -y nginx
systemctl enable nginx

echo "=== 4. 安装 PM2 ==="
npm i -g pm2

echo "=== 5. 解压代码 ==="
mkdir -p "$APP_DIR"
if [ -f "$TARBALL" ]; then
  tar xzf "$TARBALL" -C "$APP_DIR" --strip-components=1
  echo "已从 $TARBALL 解压"
else
  echo "未找到 $TARBALL，请先上传代码包: scp leglegweb.tar.gz root@<IP>:/tmp/"
  exit 1
fi

echo "=== 6. 安装依赖 ==="
cd "$APP_DIR"
npm install
cd "$APP_DIR/server"
npm install

echo "=== 7. 构建前端 ==="
cd "$APP_DIR"
npm run build

echo "=== 8. 配置环境变量 ==="
if [ ! -f "$APP_DIR/server/.env" ]; then
  read -p "输入百炼 API Key: " API_KEY
  echo "BAILIAN_API_KEY=$API_KEY" > "$APP_DIR/server/.env"
fi

echo "=== 9. 配置 Nginx ==="
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/leglegweb
ln -sf /etc/nginx/sites-available/leglegweb /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== 10. 启动服务 ==="
cd "$APP_DIR"
pm2 delete leglegweb 2>/dev/null || true
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "========================================"
echo "  部署完成！"
echo "  访问: http://$(curl -s ifconfig.me)"
echo "  查看日志: pm2 logs leglegweb"
echo "  更新部署: 重新上传 tar.gz 后运行此脚本"
echo "========================================"
