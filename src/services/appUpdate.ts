/// <reference types="vite/client" />

const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/gdatcu/qualiadept-stream/releases/latest';
const DISMISSED_UPDATE_KEY = 'qualiadept_dismissed_update_v1';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

export const APP_VERSION_NAME: string =
  (import.meta.env.VITE_APP_VERSION as string | undefined) || '1.0.0';

export const APP_VERSION_CODE: number = (() => {
  const parsed = Number(import.meta.env.VITE_APP_VERSION_CODE);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
})();

export interface AppUpdateInfo {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  apkName: string;
  releaseUrl: string;
  publishedAt?: string;
}

export function isCapacitorNativeApp(): boolean {
  try {
    const win = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    return Boolean(win.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

function parseVersionCodeFromTag(tag: string): number {
  // Matches e.g. "v1.0.25" or "1.0.25" -> 25
  const match = tag.trim().match(/(\d+)\s*$/);
  if (!match) return 0;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : 0;
}

function isDismissedRecently(versionCode: number): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_UPDATE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { versionCode: number; ts: number };
    return parsed.versionCode === versionCode && Date.now() - parsed.ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function dismissAppUpdate(versionCode: number): void {
  try {
    localStorage.setItem(
      DISMISSED_UPDATE_KEY,
      JSON.stringify({ versionCode, ts: Date.now() })
    );
  } catch {
    // Ignore storage errors
  }
}

export async function checkForAppUpdate(options?: {
  force?: boolean;
}): Promise<AppUpdateInfo | null> {
  if (navigator.onLine === false) return null;

  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };

    const tag = data.tag_name || '';
    const remoteCode = parseVersionCodeFromTag(tag);
    if (!remoteCode) return null;

    const apkAsset = (data.assets || []).find(
      (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk') && a.browser_download_url
    );
    // Only prompt once the signed APK asset is actually uploaded to the release
    if (!apkAsset?.browser_download_url) return null;

    const isNewer = APP_VERSION_CODE > 0 ? remoteCode > APP_VERSION_CODE : false;
    if (!isNewer) return null;

    if (!options?.force && isDismissedRecently(remoteCode)) {
      return null;
    }

    return {
      versionName: tag.replace(/^v/i, ''),
      versionCode: remoteCode,
      apkUrl: apkAsset.browser_download_url,
      apkName: apkAsset.name || `Qualiadept-Stream-v${tag.replace(/^v/i, '')}.apk`,
      releaseUrl: data.html_url || 'https://github.com/gdatcu/qualiadept-stream/releases/latest',
      publishedAt: data.published_at,
    };
  } catch {
    return null;
  }
}

export function openApkDownload(info: AppUpdateInfo): void {
  // Opening the direct GitHub Release .apk URL launches Android's system browser / Download Manager
  // which already has "Install unknown apps" permission from the initial install.
  const opened = window.open(info.apkUrl, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const a = document.createElement('a');
    a.href = info.apkUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
