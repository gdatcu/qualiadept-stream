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

### Step 2 — Sign & Install the `.wgt` From Your Windows PC (VS Code + Tizen Extension)
1. Install **Visual Studio Code** and install Samsung's official **`Tizen Extension`** (`publisher: Tizen`).
2. Open the **Tizen** sidebar → **Use default path** → open **Package Manager → Advanced SDK Installation** → install **`10.0 TV`**.
3. Open **Device Manager** → **Connect a Remote Device → `+ Add Devices`** → enter your `43Q60D` IP (`port 26101`) → click **Connect**.
4. Open **Certificate Manager** → **`+ Create a new Certificate`** → Profile name `QualiadeptTV` → **SAMSUNG** → sign in with your free Samsung account → **Add individual DUIDs** (auto-detects your TV) → **Create**.
5. Run this 1-paste PowerShell command in VS Code to download, sign, install, and launch the latest release on your TV:

```powershell
$tizen = "$env:USERPROFILE\.tizen-extension-platform\server\sdktools\data\tools\ide\bin\tizen.bat"
$sdb   = "$env:USERPROFILE\.tizen-extension-platform\server\sdktools\data\tools\sdb.exe"
$rel   = Invoke-RestMethod "https://api.github.com/repos/gdatcu/qualiadept-stream/releases/latest"
$asset = $rel.assets | Where-Object { $_.name -like "*Samsung-TV-Tizen*.zip" } | Select-Object -First 1
Invoke-WebRequest $asset.browser_download_url -OutFile "$env:TEMP\QualiadeptTV.zip"
Remove-Item C:\QualiadeptTV\* -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive "$env:TEMP\QualiadeptTV.zip" -DestinationPath C:\QualiadeptTV -Force
Remove-Item C:\QualiadeptTV-out\* -Force -ErrorAction SilentlyContinue
& $tizen package -t wgt -s QualiadeptTV -o C:\QualiadeptTV-out -- C:\QualiadeptTV
$wgt = Get-ChildItem C:\QualiadeptTV-out\*.wgt | Select-Object -First 1
if ($wgt.Name -ne "QualiadeptStream.wgt") { Rename-Item $wgt.FullName "QualiadeptStream.wgt" -Force }
& $tizen install -n QualiadeptStream.wgt -t QE43Q60DAUXXH -- C:\QualiadeptTV-out
& $tizen run -p QStreamApp.QualiadeptStream -t QE43Q60DAUXXH
```

**Qualiadept Stream** (with the Q-Play icon) will now appear directly in **Apps** on your Samsung `43Q60D` and can be pinned to your TV Home Bar!
