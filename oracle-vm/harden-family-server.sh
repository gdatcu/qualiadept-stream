#!/usr/bin/env bash
# Hardens the Oracle Cloud Always Free ARM64 VM (qualiadept-media) for 10-15 family members.
# Prevents disk-full HTTP 500s, zombie FFmpeg pileups, unbounded Docker logs, and silent stalls.
#
# Run once via SSH on qualiadept-media:
#   curl -fsSL https://raw.githubusercontent.com/gdatcu/qualiadept-stream/main/oracle-vm/harden-family-server.sh | bash

set -euo pipefail

echo "==> 1. Current disk & memory usage"
df -h /
free -h

echo "==> 2. Installing hardened rclone-gdrive.service (--vfs-cache-min-free-space 25G, 80G max)"
curl -fsSL https://raw.githubusercontent.com/gdatcu/qualiadept-stream/main/oracle-vm/rclone-gdrive.service \
  | sudo tee /etc/systemd/system/rclone-gdrive.service >/dev/null

echo "==> 3. Installing hardened docker-compose.yml (6 GB RAM tmpfs transcodes + log rotation + healthcheck)"
sudo mkdir -p /opt/streaming
curl -fsSL https://raw.githubusercontent.com/gdatcu/qualiadept-stream/main/oracle-vm/docker-compose.yml \
  | sudo tee /opt/streaming/docker-compose.yml >/dev/null

echo "==> 4. Clearing any leftover SSD transcode segments"
sudo rm -rf /opt/streaming/jellyfin/cache/transcodes/* || true

echo "==> 5. Reloading rclone mount & restarting Jellyfin/Caddy"
sudo systemctl daemon-reload
sudo systemctl restart rclone-gdrive
sleep 3
cd /opt/streaming
sudo docker compose up -d --force-recreate

echo "==> 6. Installing lightweight 2-minute watchdog (auto-restarts Jellyfin if unhealthy or disk critical)"
sudo tee /usr/local/bin/jellyfin-watchdog.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

# 1. If Jellyfin health endpoint fails twice, restart container automatically
if ! curl -fsS -m 5 http://127.0.0.1:8096/health >/dev/null 2>&1; then
  sleep 5
  if ! curl -fsS -m 5 http://127.0.0.1:8096/health >/dev/null 2>&1; then
    logger -t jellyfin-watchdog "Jellyfin unhealthy — restarting container"
    cd /opt/streaming && docker compose restart jellyfin || true
  fi
fi

# 2. If root disk ever exceeds 92%, evict rclone VFS cache & prune stopped containers
USE_PCT=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "${USE_PCT:-0}" -ge 92 ]; then
  logger -t jellyfin-watchdog "Root disk at ${USE_PCT}% — clearing rclone cache"
  systemctl stop rclone-gdrive || true
  rm -rf /home/ubuntu/.cache/rclone/vfs/* /home/ubuntu/.cache/rclone/vfsMeta/* || true
  systemctl start rclone-gdrive || true
  docker image prune -f >/dev/null 2>&1 || true
fi
EOF
sudo chmod +x /usr/local/bin/jellyfin-watchdog.sh

sudo tee /etc/cron.d/jellyfin-watchdog >/dev/null <<'EOF'
*/2 * * * * root /usr/local/bin/jellyfin-watchdog.sh
EOF
sudo chmod 644 /etc/cron.d/jellyfin-watchdog

echo "==> Done! Verifying status:"
df -h /
sudo docker ps --format "table {{.Names}}\t{{.Status}}"
