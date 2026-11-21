import {
  getDownloadStreamInfo,
  reportPlaybackProgress,
  type DownloadPresetId,
} from './jellyfin';
import type { AuthSession, MediaItem, PlaybackInfo, SubtitleTrack } from '../types/media';

export interface DownloadPresetOption {
  id: DownloadPresetId;
  label: string;
  badge: string;
  description: string;
  approxMbps?: number;
  recommended?: boolean;
}

export const DOWNLOAD_PRESETS: DownloadPresetOption[] = [
  {
    id: 'standard',
    label: 'Mobile HD (720p)',
    badge: '720p',
    description: 'Sharp on phones · ~85% smaller than Original',
    approxMbps: 2.36,
    recommended: true,
  },
  {
    id: 'high',
    label: 'High HD (1080p)',
    badge: '1080p',
    description: 'Crisp Full HD for tablets & large screens',
    approxMbps: 5.16,
  },
  {
    id: 'saver',
    label: 'Compact (480p)',
    badge: '480p',
    description: 'Smallest footprint for flights & tight storage',
    approxMbps: 1.26,
  },
  {
    id: 'original',
    label: 'Original Quality',
    badge: 'Original',
    description: 'Full master quality · fast 0% server CPU',
  },
];

export interface OfflineSubtitleRecord {
  index: number;
  label: string;
  language: string;
  vttText: string;
}

export interface OfflineRecord {
  id: string;
  fileName: string;
  item: MediaItem;
  presetId: DownloadPresetId;
  qualityLabel: string;
  sizeBytes: number;
  downloadedAt: number;
  posterDataUrl?: string;
  subtitles: OfflineSubtitleRecord[];
}

export interface ActiveDownloadState {
  itemId: string;
  item: MediaItem;
  presetId: DownloadPresetId;
  qualityLabel: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  percent: number;
  speedMbps: number;
  status: 'preparing' | 'downloading' | 'saving';
  error?: string;
}

export interface OfflinePlaybackResult {
  playback: PlaybackInfo;
  qualityLabel: string;
  revoke: () => void;
}

const CATALOG_KEY = 'qualiadept_offline_catalog_v1';
const OPFS_DIR_NAME = 'qualiadept-offline';

type Listener = () => void;
const listeners = new Set<Listener>();
const activeDownloads = new Map<string, ActiveDownloadState>();
const activeControllers = new Map<string, AbortController>();
const activeSessions = new Map<
  string,
  { session: AuthSession; mediaSourceId: string; playSessionId: string }
>();

function emitChange(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore listener errors
    }
  });
}

export function subscribeOfflineDownloads(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.max(1, Math.round(mb))} MB`;
}

export function estimateDownloadSizeLabel(
  item: MediaItem,
  presetId: DownloadPresetId
): string {
  if (presetId === 'original') return 'Full file size';
  const preset = DOWNLOAD_PRESETS.find((p) => p.id === presetId);
  if (!preset?.approxMbps) return 'Full size';
  const minutes = item.runtimeMinutes || (item.type === 'Episode' ? 42 : 105);
  const bytes = (minutes * 60 * preset.approxMbps * 1_000_000) / 8;
  return `~${formatBytes(bytes)}`;
}

export function supportsInAppOfflineStorage(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
  } catch {
    return false;
  }
}

export function listOfflineRecords(): OfflineRecord[] {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineRecord[];
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => b.downloadedAt - a.downloadedAt)
      : [];
  } catch {
    return [];
  }
}

function saveOfflineRecords(records: OfflineRecord[]): void {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
  emitChange();
}

export function getOfflineRecord(itemId: string): OfflineRecord | null {
  return listOfflineRecords().find((r) => r.id === itemId) ?? null;
}

export function isItemDownloaded(itemId: string): boolean {
  return getOfflineRecord(itemId) !== null;
}

export function getActiveDownload(itemId: string): ActiveDownloadState | null {
  return activeDownloads.get(itemId) ?? null;
}

export function listActiveDownloads(): ActiveDownloadState[] {
  return [...activeDownloads.values()];
}

async function getOfflineDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
}

async function createPosterThumbnailDataUrl(url: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const maxW = 360;
    const scale = Math.min(1, maxW / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch {
    return undefined;
  }
}

async function downloadSubtitles(
  subtitles: SubtitleTrack[],
  signal: AbortSignal
): Promise<OfflineSubtitleRecord[]> {
  const textSubs = subtitles.filter((s) => s.isText && s.url).slice(0, 6);
  const results: OfflineSubtitleRecord[] = [];
  for (const sub of textSubs) {
    if (signal.aborted) break;
    try {
      const res = await fetch(sub.url!, { signal });
      if (!res.ok) continue;
      const vttText = await res.text();
      if (vttText.trim()) {
        results.push({
          index: sub.index,
          label: sub.label,
          language: sub.language,
          vttText,
        });
      }
    } catch {
      // Skip individual failed subtitle track
    }
  }
  return results;
}

export async function startOfflineDownload(
  session: AuthSession,
  item: MediaItem,
  presetId: DownloadPresetId = 'standard'
): Promise<void> {
  if (!supportsInAppOfflineStorage()) {
    throw new Error('In-app offline storage is not supported by this browser. Use "Save .mp4 to Device" instead.');
  }
  if (activeDownloads.has(item.id)) return;

  const preset = DOWNLOAD_PRESETS.find((p) => p.id === presetId) || DOWNLOAD_PRESETS[0];
  const controller = new AbortController();
  activeControllers.set(item.id, controller);

  activeDownloads.set(item.id, {
    itemId: item.id,
    item,
    presetId,
    qualityLabel: preset.badge,
    bytesDownloaded: 0,
    totalBytes: null,
    percent: 0,
    speedMbps: 0,
    status: 'preparing',
  });
  emitChange();

  const fileName = `${item.id}.mp4`;
  let dir: FileSystemDirectoryHandle | null = null;
  let writable: FileSystemWritableFileStream | null = null;

  try {
    // Ask browser to keep offline videos persistent (prevents automatic cache eviction on Android)
    navigator.storage?.persist?.().catch(() => {});

    const info = await getDownloadStreamInfo(session, item, presetId, true);
    activeSessions.set(item.id, {
      session,
      mediaSourceId: info.mediaSourceId,
      playSessionId: info.playSessionId,
    });

    // Fetch poster thumbnail & subtitles in parallel while stream starts
    const posterPromise = createPosterThumbnailDataUrl(item.backdropUrl || item.posterUrl);
    const subsPromise = downloadSubtitles(info.subtitles, controller.signal);

    const res = await fetch(info.downloadUrl, { signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed (HTTP ${res.status})`);
    }

    const headerLen = Number(res.headers.get('Content-Length') || 0);
    const totalBytes =
      headerLen > 0 ? headerLen : info.fileSizeBytes || info.estimatedBytes || null;

    dir = await getOfflineDir();
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    writable = await fileHandle.createWritable();

    const reader = res.body.getReader();
    let bytesDownloaded = 0;
    const startedAt = Date.now();
    let lastEmitAt = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        await writable.write(value);
        bytesDownloaded += value.byteLength;

        const now = Date.now();
        if (now - lastEmitAt >= 250) {
          lastEmitAt = now;
          const elapsedSec = Math.max(0.2, (now - startedAt) / 1000);
          const speedMbps = (bytesDownloaded * 8) / elapsedSec / 1_000_000;
          const pct = totalBytes
            ? Math.min(99, Math.round((bytesDownloaded / totalBytes) * 100))
            : 0;
          activeDownloads.set(item.id, {
            itemId: item.id,
            item,
            presetId,
            qualityLabel: preset.badge,
            bytesDownloaded,
            totalBytes,
            percent: pct,
            speedMbps: Math.round(speedMbps * 10) / 10,
            status: 'downloading',
          });
          emitChange();
        }
      }
    }

    activeDownloads.set(item.id, {
      itemId: item.id,
      item,
      presetId,
      qualityLabel: preset.badge,
      bytesDownloaded,
      totalBytes: bytesDownloaded,
      percent: 99,
      speedMbps: 0,
      status: 'saving',
    });
    emitChange();

    await writable.close();
    writable = null;

    const [posterDataUrl, subtitles] = await Promise.all([posterPromise, subsPromise]);

    const record: OfflineRecord = {
      id: item.id,
      fileName,
      item: {
        ...item,
        posterUrl: posterDataUrl || item.posterUrl,
        backdropUrl: posterDataUrl || item.backdropUrl,
      },
      presetId,
      qualityLabel: preset.badge,
      sizeBytes: bytesDownloaded,
      downloadedAt: Date.now(),
      posterDataUrl,
      subtitles,
    };

    const nextCatalog = [record, ...listOfflineRecords().filter((r) => r.id !== item.id)];
    activeDownloads.delete(item.id);
    activeControllers.delete(item.id);
    activeSessions.delete(item.id);
    saveOfflineRecords(nextCatalog);
  } catch (err) {
    if (writable) {
      try {
        await writable.abort();
      } catch {
        // Ignore abort error
      }
    }
    if (dir) {
      try {
        await dir.removeEntry(fileName);
      } catch {
        // Ignore cleanup error
      }
    }

    const activeSess = activeSessions.get(item.id);
    if (activeSess) {
      reportPlaybackProgress(
        activeSess.session,
        item.id,
        activeSess.mediaSourceId,
        activeSess.playSessionId,
        0,
        true,
        'stop'
      );
    }

    activeDownloads.delete(item.id);
    activeControllers.delete(item.id);
    activeSessions.delete(item.id);
    emitChange();

    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      throw err;
    }
  }
}

export function cancelOfflineDownload(itemId: string): void {
  const controller = activeControllers.get(itemId);
  if (controller) {
    controller.abort();
  }
  const activeSess = activeSessions.get(itemId);
  if (activeSess) {
    reportPlaybackProgress(
      activeSess.session,
      itemId,
      activeSess.mediaSourceId,
      activeSess.playSessionId,
      0,
      true,
      'stop'
    );
  }
  activeDownloads.delete(itemId);
  activeControllers.delete(itemId);
  activeSessions.delete(itemId);
  emitChange();
}

export async function deleteOfflineDownload(itemId: string): Promise<void> {
  const rec = getOfflineRecord(itemId);
  if (rec && supportsInAppOfflineStorage()) {
    try {
      const dir = await getOfflineDir();
      await dir.removeEntry(rec.fileName);
    } catch {
      // File may already be removed
    }
  }
  const remaining = listOfflineRecords().filter((r) => r.id !== itemId);
  saveOfflineRecords(remaining);
}

export async function clearAllOfflineDownloads(): Promise<void> {
  const records = listOfflineRecords();
  if (supportsInAppOfflineStorage()) {
    try {
      const dir = await getOfflineDir();
      for (const rec of records) {
        try {
          await dir.removeEntry(rec.fileName);
        } catch {
          // Ignore individual missing files
        }
      }
    } catch {
      // Ignore OPFS error
    }
  }
  saveOfflineRecords([]);
}

/**
 * Triggers native browser / Android Download Manager save to the device's Downloads folder
 * (runs in background even if the user switches apps or locks the phone).
 */
export async function saveToDeviceFile(
  session: AuthSession,
  item: MediaItem,
  presetId: DownloadPresetId = 'standard'
): Promise<void> {
  const info = await getDownloadStreamInfo(session, item, presetId, false);
  const safeName = `${item.seriesName ? `${item.seriesName} - ` : ''}${item.name}`
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .slice(0, 80);
  const a = document.createElement('a');
  a.href = info.downloadUrl;
  a.download = `${safeName || item.id}.${info.container || 'mp4'}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Opens a locally downloaded movie/episode directly from OPFS disk (0 RAM copy, instant seek,
 * works 100% in Airplane Mode with saved WebVTT subtitles).
 */
export async function getOfflinePlaybackInfo(
  itemId: string
): Promise<OfflinePlaybackResult | null> {
  const rec = getOfflineRecord(itemId);
  if (!rec || !supportsInAppOfflineStorage()) return null;

  try {
    const dir = await getOfflineDir();
    const fileHandle = await dir.getFileHandle(rec.fileName);
    const file = await fileHandle.getFile();
    if (!file || file.size === 0) return null;

    const blobUrls: string[] = [];
    const videoUrl = URL.createObjectURL(file);
    blobUrls.push(videoUrl);

    const subtitles: SubtitleTrack[] = rec.subtitles.map((s) => {
      const subUrl = URL.createObjectURL(new Blob([s.vttText], { type: 'text/vtt' }));
      blobUrls.push(subUrl);
      return {
        index: s.index,
        label: s.label,
        language: s.language,
        isText: true,
        url: subUrl,
      };
    });

    return {
      qualityLabel: rec.qualityLabel,
      playback: {
        streamUrl: videoUrl,
        isHls: false,
        mediaSourceId: `offline-${rec.id}`,
        playSessionId: `offline-${Date.now()}`,
        audioTracks: [],
        defaultAudioIndex: null,
        subtitles,
      },
      revoke: () => {
        blobUrls.forEach((u) => URL.revokeObjectURL(u));
      },
    };
  } catch {
    return null;
  }
}

export async function getOfflineStorageSummary(): Promise<{
  downloadedBytes: number;
  deviceAvailableBytes: number | null;
}> {
  const downloadedBytes = listOfflineRecords().reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && typeof est.quota === 'number' && typeof est.usage === 'number') {
      return {
        downloadedBytes,
        deviceAvailableBytes: Math.max(0, est.quota - est.usage),
      };
    }
  } catch {
    // Ignore estimate failure
  }
  return { downloadedBytes, deviceAvailableBytes: null };
}
