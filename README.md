# Qualiadept Stream

Custom HBO Max / Netflix-style private streaming web app designed for **qualiadept.eu** (cPanel static hosting) backed by **Jellyfin + `rclone` + Caddy** on an **Oracle Cloud Always Free VM** streaming from **Google Drive**.

## Quick Start (Local Preview)

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and click **Launch Demo Preview** to explore the full UI and HLS/MP4 video player immediately (no server required).

## Deploy to cPanel (`qualiadept.eu`)

1. Build the static production bundle:
   ```bash
   npm run build
   ```
2. Open **cPanel → File Manager** and upload everything inside `dist/` (including the hidden `.htaccess` file) to `public_html` (or your subdomain folder, e.g. `public_html/watch`).
3. Visit your domain and sign in with `https://media.qualiadept.eu` + your Jellyfin username and password.

## Oracle VM Configs

Ready-to-use backend config files are included in `oracle-vm/`:
- `oracle-vm/docker-compose.yml` — Jellyfin + Caddy (auto HTTPS)
- `oracle-vm/Caddyfile` — Reverse proxy for `media.qualiadept.eu`
- `oracle-vm/rclone-gdrive.service` — Systemd service mounting Google Drive with a 120 GB local SSD cache
