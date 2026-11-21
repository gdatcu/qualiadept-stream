# Installing Qualiadept Stream on Samsung QLED 43Q60D (2024 · Tizen 8.0)

Your **Samsung QLED 43Q60D** runs **Tizen OS 8.0** and supports native **4K H.264 / HEVC / AV1** hardware decoding. You have two ways to run **Qualiadept Stream** on it:

---

## Method 1: Instant Setup (30 Seconds · No PC Needed)
1. Open the built-in **Internet** (Samsung Browser) app on your `43Q60D`.
2. Navigate to **`https://stream.qualiadept.eu`** and sign in with your family account.
3. Press the menu button (`⋮` / Star) → **Add to Home Screen** (or Bookmark) for 1-click access from the TV Home Bar.
4. Full D-pad remote navigation, 4K playback, subtitles, and auto-updates work automatically.

---

## Method 2: Native Samsung TV App Tile (`.wgt` via Developer Mode)
Samsung locks native `.wgt` app installation so each `.wgt` must be signed once with your TV's unique **DUID** using a free Samsung Developer Certificate (takes ~5–10 minutes on a Windows/Mac PC on the **same Wi-Fi** as the TV).

### Step 1 — Enable Developer Mode on Your Samsung `43Q60D`
1. Press **Home** on your Samsung SolarCell remote → open **Apps**.
2. Press the **`123`** button on the remote, select **`1` `2` `3` `4` `5`**, and confirm.
3. In the **Developer mode** popup:
   - Toggle **Developer mode** → **ON**
   - Enter your **PC's local IP address** (e.g. `192.168.1.50` — find it via `ipconfig` on Windows or `ipconfig getifaddr en0` on Mac)
   - Click **OK**.
4. **Full reboot the TV:** Hold the **Power** button on the remote for ~3 seconds until the Samsung logo appears (a normal quick standby does not activate Developer Mode).
5. Re-open **Apps** — you should see red **DEVELOPER MODE** text at the top. Find your TV's IP under **Settings → Connection → Network → Network Status → IP Settings**.

### Step 2 — Sign & Install the `.wgt` From Your PC
1. Download **`Qualiadept-Stream-Samsung-TV-Tizen-v1.0.XX.zip`** from **GitHub Releases** and unzip it to a folder (e.g. `C:\QualiadeptTV`).
2. Install **Tizen Studio** (with **TV Extensions** + **Samsung Certificate Extension** via Package Manager).
3. Open **Tools → Device Manager** → click **`+` (Remote Device Manager)** → enter your `43Q60D` TV IP → toggle **ON** to connect. *(Copy the TV's **DUID** automatically detected here.)*
4. Open **Tools → Certificate Manager** → **`+`** → choose **Samsung** → **TV** → sign in with your free Samsung account → create an **Author** + **Distributor** certificate (it auto-adds your TV's DUID).
5. Open **File → Import → Tizen → Tizen Project** → select your unzipped `C:\QualiadeptTV` folder → Profile: **TV-Samsung**.
6. Right-click the project → **Run As → Tizen Web Application**!

**Qualiadept Stream** (with the Q-Play icon) will now appear directly in **Apps** on your Samsung `43Q60D` and can be pinned to your TV Home Bar!
