# Qualiadept Stream

Custom HBO Max / Netflix-style private streaming web & mobile app for **`stream.qualiadept.eu`** (Hostico cPanel) backed by **Jellyfin + `rclone` + Caddy** on an **Oracle Cloud Always Free VM** (`https://media.qualiadept.eu`) streaming from **Google Drive**.

## Quick Start (Local Preview)

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and sign in with `https://media.qualiadept.eu` (or click **Launch Demo Preview**).

---

## Automatic Deployment to Hostico (`stream.qualiadept.eu`)

Every push to `main` automatically builds `dist/` and deploys to Hostico via `.github/workflows/deploy-hostico.yml`.

### One-Time Setup:
1. In **Hostico cPanel → Domains**, create subdomain **`stream.qualiadept.eu`** (Document Root e.g. `stream.qualiadept.eu` or `public_html/stream`).
2. In **Hostico cPanel → FTP Accounts**, create an FTP user (e.g. `deploy@qualiadept.eu`) with **Directory** set directly to that subdomain's folder.
3. In **GitHub → Settings → Secrets and variables → Actions**, add:
   - `FTP_SERVER` — your Hostico FTP host (e.g. `ftp.qualiadept.eu` or your Hostico server hostname)
   - `FTP_USERNAME` — full FTP username (e.g. `deploy@qualiadept.eu`)
   - `FTP_PASSWORD` — FTP password
   - *(Optional)* `FTP_SERVER_DIR` — leave unset if the FTP account is already scoped to the subdomain folder (defaults to `./`).

---

## Mobile App (Android APK & iOS/Android PWA)

### 1. Native Android APK (Built Automatically in GitHub Actions)
Every push to `main` triggers `.github/workflows/build-android.yml` using **Capacitor**:
1. Open the **Actions** tab in GitHub → click the latest **Build Android APK (Capacitor)** run.
2. Under **Artifacts**, download **`qualiadept-stream-android-apk`**, unzip `qualiadept-stream.apk`, and install it directly on any Android phone or tablet!

### 2. Installable PWA (Android & iOS)
Open **`https://stream.qualiadept.eu`** on your phone:
- **Android (Chrome):** Menu `⋮` → **Install app** / **Add to Home screen**.
- **iOS (Safari):** Share button → **Add to Home Screen**.

---

## Oracle VM Configs

Ready-to-use backend config files are in `oracle-vm/`:
- `oracle-vm/docker-compose.yml` — Jellyfin + Caddy (auto HTTPS)
- `oracle-vm/Caddyfile` — Reverse proxy for `media.qualiadept.eu`
- `oracle-vm/rclone-gdrive.service` — Systemd service mounting Google Drive with a 120 GB local SSD cache
