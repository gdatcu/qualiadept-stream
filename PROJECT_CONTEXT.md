# Qualiadept Stream — Project Context & Handoff

> Read this file at the start of a new conversation to get full context on the project architecture, infrastructure, deployed services, and next steps. (Contains zero passwords or secrets.)

## 1. Project Overview
**Qualiadept Stream** is a private HBO Max / Netflix-style streaming platform built for **`qualiadept.eu`** at **$0/month** extra infrastructure cost, streaming videos stored on **Google Drive**.

- **GitHub Repository:** `https://github.com/gdatcu/qualiadept-stream.git` (`main` branch)
- **Live Web App & PWA:** `https://stream.qualiadept.eu` (hosted on Hostico cPanel shared hosting)
- **Live Media Backend (Jellyfin):** `https://media.qualiadept.eu` (hosted on Oracle Cloud Always Free VM)

---

## 2. Infrastructure Architecture

### A. Frontend — Hostico Shared Hosting (cPanel)
- **Domain:** `https://stream.qualiadept.eu`
- **Stack:** React 18 + Vite + TypeScript + Tailwind CSS + `hls.js` + `lucide-react` + `vite-plugin-pwa`
- **Auto-Deploy:** `.github/workflows/deploy-hostico.yml` builds `dist/` and deploys automatically to Hostico via FTPS (`port: 21`, `security: loose`) on every push to `main`.
  - Uses GitHub Actions secrets: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, optional `FTP_SERVER_DIR`.
  - Includes `public/.htaccess` for SPA routing.

### B. Media Backend — Oracle Cloud Always Free VM
- **Region:** Spain Central (Madrid 3 / `eu-madrid-3`, `AD-1`)
- **Account Plan:** Upgraded to Pay-As-You-Go (staying strictly within Always Free limits = **$0/month**; $1 monthly budget alert set at 10% / $0.10).
- **Instance:** `qualiadept-media` (`VM.Standard.A1.Flex`, Canonical Ubuntu 24.04 ARM64, 4 OCPUs, 24 GB RAM, 200 GB boot volume @ 10 VPU, 4 Gbps network, 10 TB/month free outbound traffic).
- **VCN:** `vcn-streaming` (`public subnet-vcn-streaming`), ports `22`, `80`, `443` open in both Oracle Security List and Ubuntu `iptables`.
- **Services on VM** (configs in `oracle-vm/`):
  - **Caddy (`caddy:2-alpine`):** Reverse proxy with automatic Let's Encrypt HTTPS for `media.qualiadept.eu` → `jellyfin:8096`.
  - **Jellyfin (`jellyfin/jellyfin:latest`):** Handles user auth, TMDB artwork/metadata, `.mkv` → HLS live remux/transcoding, subtitles (`.vtt`), and watch progress sync (*Continue Watching*).
  - **`rclone` (`rclone-gdrive.service`):** Mounts Google Drive (`gdrive:`) read-only at `/mnt/gdrive` (bind-mounted into Jellyfin at `/media` with `rslave` propagation) using a dedicated Google Cloud OAuth Client (`qualiadept-media`, published/production) and a **120 GB / 72h local SSD VFS cache**.

### C. Google Drive Library Layout
Inside `My Drive > qualiadept_stream`:
- `Movies/Movie Name (Year)/Movie Name (Year).mp4` (or `.mkv`)
- `Shows/Show Name (Year)/Season 01/Show Name S01E01.mkv`
- *(Note: Raw DVD `VIDEO_TS` / `AUDIO_TS` folders must be converted once to `.mp4` with HandBrake Web Optimized or `.mkv` with MakeMKV before uploading.)*

---

## 3. Implemented App Features
- **Authentication & Demo Mode** (`src/components/LoginScreen.tsx`, `src/services/jellyfin.ts`): Connects to `https://media.qualiadept.eu` via Jellyfin REST API; includes Demo Mode for offline UI preview.
- **Netflix/HBO Max Browse UI** (`src/components/HeroBanner.tsx`, `MediaRow.tsx`, `Navbar.tsx`, `DetailModal.tsx`): Hero banner, Continue Watching with progress bars, genre carousels, live search, My List favorites, and Season/Episode picker for Series.
- **Custom Video Player** (`src/components/VideoPlayer.tsx`):
  - Direct Play (`.mp4`/`.webm`) + `hls.js` adaptive/remuxed streaming (`.mkv`).
  - **Quality Selector:** Original (Direct Play / 12 Mbps), 1080p HD (8 Mbps), 720p HD (4 Mbps), 480p SD (1.5 Mbps) — preserves timestamp when switching.
  - **Auto-Play Next Episode:** Fetches next episode automatically, shows Netflix-style *"Up Next in 10s"* overlay + manual *Next Ep* button.
  - **Subtitles:** WebVTT track switcher from Jellyfin.
  - **Chromecast & AirPlay** (`src/utils/chromecast.ts`): Google Cast Web Sender SDK (`DEFAULT_MEDIA_RECEIVER_APP_ID`) for Chrome/Edge (desktop & Android PWA) + Safari AirPlay picker (`x-webkit-airplay="allow"`).
  - **Watch Progress Sync:** Reports progress to Jellyfin every 10s.

---

## 4. Mobile & Smart TV Support
- **PWA (iOS & Android):** Configured via `vite-plugin-pwa` with `public/icon-512.png` and `public/icon.svg`. Installable from `https://stream.qualiadept.eu`.
- **Android Native `.apk` (Capacitor):** Configured in `capacitor.config.ts` (`eu.qualiadept.stream`). Automatically built on every push to `main` and published under **GitHub Releases** (`Qualiadept-Stream-v1.0.<run>.apk`).
- **Samsung Smart TV (Tizen):**
  - Full spatial D-pad & Tizen remote navigation (`src/utils/tvNavigation.ts`, handles Arrow keys, Enter, Tizen Back `10009`, and media playback keys).
  - Native Tizen `.wgt` package ready via `npm run build:tizen` → outputs `tizen-dist/` (uses `tizen/config.xml` + `tizen/icon.png`) for sideloading via Tizen Studio + Samsung Developer Mode.
  - Works immediately in Samsung Internet TV browser at `https://stream.qualiadept.eu`.

---

## 5. Potential Next Enhancements
- Audio track / language switcher inside `VideoPlayer.tsx`
- Hardcode `https://media.qualiadept.eu` behind an "Advanced" toggle on LoginScreen for simpler family login
- OpenSubtitles plugin configuration in Jellyfin for automatic Romanian/English subtitles
- Native Android Chromecast plugin for the Capacitor `.apk`
- Finishing Samsung Smart TV Tizen Studio sideloading if not yet completed
