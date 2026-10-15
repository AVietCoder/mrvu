#!/usr/bin/env bash
# Cài Mr.Vũ SEO Studio lên VPS Ubuntu 22.04/24.04 tại seo.ttv.vn
# Chạy trong thư mục đã giải nén:  sudo bash deploy/cai-dat.sh
set -euo pipefail
DOMAIN="seo.ttv.vn"
APP_DIR="/opt/mrvu-seo-studio"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "== 1. Cài phần mềm cần thiết"
apt-get update -y
apt-get install -y python3 nginx certbot python3-certbot-nginx rsync
timedatectl set-timezone Asia/Ho_Chi_Minh || true

echo "== 2. Tạo người dùng hệ thống và chép công cụ vào $APP_DIR"
id mrvu >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin mrvu
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  # Không ghi đè dữ liệu đang có trên máy chủ
  rsync -a --exclude 'kho-tu-khoa.db' --exclude 'config.json' --exclude 'google-service-account.json' "$SRC_DIR"/ "$APP_DIR"/ 2>/dev/null \
    || cp -rn "$SRC_DIR"/. "$APP_DIR"/
  for f in kho-tu-khoa.db config.json google-service-account.json; do
    [ -f "$SRC_DIR/$f" ] && [ ! -f "$APP_DIR/$f" ] && cp "$SRC_DIR/$f" "$APP_DIR/$f"
  done
fi
chown -R mrvu:mrvu "$APP_DIR"
chmod 600 "$APP_DIR"/config.json "$APP_DIR"/google-service-account.json 2>/dev/null || true

if ! python3 - "$APP_DIR/config.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
need = [k for k in ("google_client_id", "google_client_secret", "public_url", "allowed_emails") if not c.get(k)]
sys.exit(1 if need else 0)
PY
then
  echo ""
  echo "[!] config.json chưa có đủ google_client_id, google_client_secret, public_url, allowed_emails."
  echo "    Mở $APP_DIR/config.json, điền theo TRIEN_KHAI.md (bước 3) rồi chạy lại script này."
  exit 1
fi

echo "== 3. Chạy công cụ như một dịch vụ (tự khởi động lại khi lỗi hoặc khởi động máy)"
cp "$APP_DIR/deploy/mrvu-seo-studio.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mrvu-seo-studio
sleep 2
systemctl --no-pager status mrvu-seo-studio | head -5

echo "== 4. Cấu hình nginx cho $DOMAIN"
cp "$APP_DIR/deploy/nginx-seo.ttv.vn.conf" /etc/nginx/sites-available/$DOMAIN
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl reload nginx

echo "== 5. Cấp chứng chỉ HTTPS miễn phí (Let's Encrypt)"
certbot --nginx -d "$DOMAIN" --redirect --agree-tos --register-unsafely-without-email -n || \
  echo "[!] Chưa cấp được HTTPS. Kiểm tra bản ghi DNS của $DOMAIN đã trỏ về IP máy chủ, rồi chạy: sudo certbot --nginx -d $DOMAIN"

if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 'Nginx Full' || true; fi

echo "== 6. Sao lưu dữ liệu tự động mỗi đêm (giữ 14 bản)"
cat >/etc/cron.daily/mrvu-seo-studio-backup <<EOF
#!/bin/sh
mkdir -p /var/backups/mrvu-seo-studio
cd $APP_DIR && tar czf /var/backups/mrvu-seo-studio/\$(date +%F).tgz kho-tu-khoa.db config.json google-service-account.json anh-thu-vien 2>/dev/null
ls -1t /var/backups/mrvu-seo-studio/*.tgz | tail -n +15 | xargs -r rm -f
EOF
chmod +x /etc/cron.daily/mrvu-seo-studio-backup

echo ""
echo "Xong. Mở https://$DOMAIN và đăng nhập bằng tài khoản Google đã cho phép."
