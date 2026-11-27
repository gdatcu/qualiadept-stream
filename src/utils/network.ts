import { QUALITY_OPTIONS, type QualityPreset } from '../types/media';
import { isTizenTv } from './tvNavigation';

interface NetworkConnectionLike {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

interface TizenWebApisNetworkLike {
  getActiveConnectionType?: () => number;
}

interface StoredThroughput {
  mbps: number;
  ts: number;
  connKey: string;
}

interface StoredCeiling {
  quality: QualityPreset;
  ts: number;
  connKey: string;
}

const THROUGHPUT_KEY = 'qualiadept_measured_mbps_v3';
const THROUGHPUT_TTL_MS = 5 * 60 * 1000;
const CEILING_KEY = 'qualiadept_stable_ceiling_v2';
const CEILING_TTL_MS = 15 * 60 * 1000;

function getConnection(): NetworkConnectionLike | null {
  try {
    const nav = navigator as Navigator & { connection?: NetworkConnectionLike };
    return nav.connection ?? null;
  } catch {
    return null;
  }
}

/**
 * Queries Samsung Tizen's native Product Network API when running on a Samsung Smart TV:
 * 1 = WIFI, 2 = CELLULAR, 3 = ETHERNET, 0 = DISCONNECTED.
 */
function getTizenConnectionType(): 'ethernet' | 'wifi' | 'cellular' | null {
  if (!isTizenTv()) return null;
  try {
    const win = window as unknown as {
      webapis?: { network?: TizenWebApisNetworkLike };
    };
    const code = win.webapis?.network?.getActiveConnectionType?.();
    if (code === 3) return 'ethernet';
    if (code === 1) return 'wifi';
    if (code === 2) return 'cellular';
    return null;
  } catch {
    return null;
  }
}

function getConnectionKey(conn: NetworkConnectionLike | null): string {
  const tizenType = getTizenConnectionType();
  if (tizenType) return `tizen:${tizenType}`;
  if (isTizenTv()) return 'tizen:lan';
  if (!conn) return 'unknown';
  return `${conn.type || 'broadband'}:${conn.effectiveType || 'unknown'}`;
}

export function isCellularConnection(): boolean {
  if (isTizenTv()) {
    return getTizenConnectionType() === 'cellular';
  }
  const conn = getConnection();
  return conn?.type === 'cellular';
}

export function getNetworkLabel(): string {
  if (isTizenTv()) {
    const tizenType = getTizenConnectionType();
    if (tizenType === 'ethernet') return 'Ethernet';
    if (tizenType === 'wifi') return 'Wi-Fi';
    const conn = getConnection();
    if (conn?.type === 'ethernet') return 'Ethernet';
    if (conn?.type === 'wifi') return 'Wi-Fi';
    return 'Ethernet / Wi-Fi';
  }

  const conn = getConnection();
  if (!conn) return 'Online';
  if (conn.saveData) return 'Data Saver';
  if (conn.type === 'ethernet') return 'Ethernet';
  if (conn.type === 'wifi') return 'Wi-Fi';
  if (conn.type === 'cellular') {
    if (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g') return '2G Mobile';
    if (conn.effectiveType === '3g') return '3G Mobile';
    return '5G / 4G Mobile';
  }
  // Note: Desktop Chromium always reports effectiveType === '4g' as its max W3C enum even on 1 Gbps Fiber!
  if (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g') {
    return 'Slow Connection';
  }
  return 'Wi-Fi / Broadband';
}

/**
 * Records pure network transfer throughput.
 * Importantly, if a segment arrived much faster than real-time playback (`isRealtimeHealthy: true`),
 * a low apparent Mbps only means the video scene itself had a small segment size (e.g. cartoons) —
 * NEVER let small healthy segments drag down the stored bandwidth estimate!
 */
export function recordMeasuredThroughput(
  mbps: number,
  options?: { isRealtimeHealthy?: boolean }
): void {
  if (!Number.isFinite(mbps) || mbps <= 0.1 || mbps > 1000) return;
  try {
    const conn = getConnection();
    const connKey = getConnectionKey(conn);
    const prev = getStoredThroughputMbps();
    if (options?.isRealtimeHealthy && prev !== null && mbps < prev) {
      return;
    }
    if (options?.isRealtimeHealthy && prev === null && mbps < 8) {
      return;
    }
    const nextMbps = prev !== null ? prev * 0.65 + mbps * 0.35 : mbps;
    const payload: StoredThroughput = {
      mbps: Math.round(nextMbps * 100) / 100,
      ts: Date.now(),
      connKey,
    };
    sessionStorage.setItem(THROUGHPUT_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors
  }
}

export function getStoredThroughputMbps(): number | null {
  try {
    const raw = sessionStorage.getItem(THROUGHPUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredThroughput;
    if (Date.now() - parsed.ts > THROUGHPUT_TTL_MS) return null;
    if (parsed.connKey !== getConnectionKey(getConnection())) return null;
    return Number.isFinite(parsed.mbps) ? parsed.mbps : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the highest quality tier that proved stable (stall-free) on the current network
 * for 15 minutes when Auto Stability is active.
 */
export function recordStableCeiling(quality: QualityPreset): void {
  try {
    const payload: StoredCeiling = {
      quality,
      ts: Date.now(),
      connKey: getConnectionKey(getConnection()),
    };
    sessionStorage.setItem(CEILING_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors
  }
}

export function getStableCeilingQuality(): QualityPreset | null {
  try {
    const raw = sessionStorage.getItem(CEILING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCeiling;
    if (Date.now() - parsed.ts > CEILING_TTL_MS) return null;
    if (parsed.connKey !== getConnectionKey(getConnection())) return null;
    return parsed.quality;
  } catch {
    return null;
  }
}

export function clearStableCeiling(): void {
  try {
    sessionStorage.removeItem(CEILING_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function qualityRank(q: QualityPreset): number {
  switch (q) {
    case 'auto':
      return 4;
    case '1080p':
      return 3;
    case '720p':
      return 2;
    case '480p':
      return 1;
    case '360p':
      return 0;
  }
}

/**
 * Formats an exact human-readable resolution badge (correctly handling 2.39:1 cinemascope
 * movies like 1920×800 as 1080p and 3840×1600 as 4K UHD).
 */
export function formatResolutionBadge(width?: number, height?: number): string | null {
  const w = width || 0;
  const h = height || 0;
  if (w <= 0 && h <= 0) return null;
  if (w >= 3200 || h >= 1800) return '4K UHD';
  if (w >= 2200 || h >= 1300) return '1440p QHD';
  if (w >= 1700 || h >= 960) return '1080p';
  if (w >= 1150 || h >= 660) return '720p';
  if (w >= 760 || h >= 440) return '480p';
  return '360p';
}

/**
 * Picks the next lower quality tier cleanly one resolution/bitrate step at a time,
 * never jumping from 1080p Original straight to 360p on low-bitrate animated shows.
 */
export function getNextLowerQuality(
  current: QualityPreset,
  sourceBitrate?: number,
  sourceWidth?: number
): QualityPreset | null {
  const ladder: QualityPreset[] = isCellularConnection()
    ? ['auto', '720p', '480p', '360p']
    : ['auto', '1080p', '720p', '480p', '360p'];

  const currentRank = qualityRank(current);
  const candidates = ladder.filter((q) => qualityRank(q) < currentRank);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const opt = QUALITY_OPTIONS.find((o) => o.id === candidate);
    if (!opt) continue;
    const reducesWidth = Boolean(sourceWidth && opt.maxWidth && opt.maxWidth < sourceWidth * 0.92);
    const reducesBitrate = Boolean(
      sourceBitrate && opt.videoBitrate && opt.videoBitrate < sourceBitrate * 0.88
    );
    // Step to this tier if it meaningfully reduces EITHER resolution OR bitrate (or if source stats are unknown)
    if (reducesWidth || reducesBitrate || (!sourceWidth && !sourceBitrate)) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Chooses the optimal starting stream quality:
 * - On Smart TV (Ethernet / Wi-Fi): ALWAYS starts on 'auto' (Original untouched quality).
 * - On Desktop / Home Wi-Fi: ALWAYS starts on 'auto' (Original) unless Data Saver or an active stall ceiling exists.
 * - On Cellular (4G/5G/3G): adapts intelligently to mobile bandwidth & latency.
 */
export function getRecommendedQuality(): QualityPreset {
  if (isTizenTv()) {
    return 'auto';
  }

  const conn = getConnection();
  const ceiling = getStableCeilingQuality();

  if (conn?.saveData) {
    return '360p';
  }

  // On Wi-Fi / Ethernet / Broadband, never trust Chromium's uncalibrated downlink/rtt stub values at startup
  if (!isCellularConnection()) {
    const measured = getStoredThroughputMbps();
    let wifiPick: QualityPreset = 'auto';
    if (measured !== null && measured < 1.2) {
      wifiPick = '360p';
    } else if (measured !== null && measured < 2.5) {
      wifiPick = '480p';
    }
    if (ceiling && qualityRank(ceiling) < qualityRank(wifiPick)) {
      return ceiling;
    }
    return wifiPick;
  }

  // Cellular connection (5G / 4G / 3G / 2G)
  const measured = getStoredThroughputMbps();
  const downlink =
    conn && typeof conn.downlink === 'number' && conn.downlink > 0 ? conn.downlink : null;
  const rtt = conn && typeof conn.rtt === 'number' && conn.rtt > 0 ? conn.rtt : null;

  const effectiveMbps =
    measured !== null && downlink !== null
      ? Math.min(measured, downlink)
      : measured ?? downlink;

  let cellularPick: QualityPreset = 'auto';
  if (
    conn?.effectiveType === 'slow-2g' ||
    conn?.effectiveType === '2g' ||
    (effectiveMbps !== null && effectiveMbps < 1.3) ||
    (rtt !== null && rtt > 450)
  ) {
    cellularPick = '360p';
  } else if (
    conn?.effectiveType === '3g' ||
    (effectiveMbps !== null && effectiveMbps < 3.0) ||
    (rtt !== null && rtt > 260)
  ) {
    cellularPick = '480p';
  } else if (effectiveMbps !== null && effectiveMbps < 5.5) {
    cellularPick = '720p';
  }

  if (ceiling && qualityRank(ceiling) < qualityRank(cellularPick)) {
    return ceiling;
  }

  return cellularPick;
}

export function subscribeNetworkChange(listener: () => void): () => void {
  const conn = getConnection();
  if (!conn?.addEventListener || !conn?.removeEventListener) {
    return () => {};
  }
  conn.addEventListener('change', listener);
  return () => {
    conn.removeEventListener?.('change', listener);
  };
}

export function isAndroidWebViewPlatform(): boolean {
  try {
    const win = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    if (win.Capacitor?.isNativePlatform?.()) return true;
    return /\bwv\b/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

let cachedDirectPlayVideoCodecs: string | null = null;
let cachedMseHevcSupport: boolean | null = null;

/**
 * Checks whether the browser's MediaSource Extensions (MSE) hardware pipeline supports
 * HEVC/H.265 inside fMP4 HLS segments (enabling lossless -c:v copy of 4K/1080p HEVC MKVs on Samsung QLED TVs).
 */
export function canMsePlayHevc(): boolean {
  if (cachedMseHevcSupport !== null) return cachedMseHevcSupport;
  try {
    cachedMseHevcSupport =
      typeof MediaSource !== 'undefined' &&
      typeof MediaSource.isTypeSupported === 'function' &&
      (MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.90"') ||
        MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L120.90"'));
  } catch {
    cachedMseHevcSupport = false;
  }
  return cachedMseHevcSupport;
}

/**
 * Probes the device's actual HTML5 video hardware codec support (including HEVC/H.265
 * on Samsung Smart TVs, Galaxy / Android Chrome & iOS Safari) so Jellyfin Direct Plays
 * whenever possible instead of CPU-transcoding on the Oracle ARM64 VM.
 */
export function getDirectPlayVideoCodecs(): string {
  if (cachedDirectPlayVideoCodecs) return cachedDirectPlayVideoCodecs;
  const codecs = ['h264'];
  try {
    const v = document.createElement('video');
    if (
      v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') === 'probably' ||
      v.canPlayType('video/mp4; codecs="hev1.1.6.L120.90"') === 'probably' ||
      canMsePlayHevc()
    ) {
      codecs.push('hevc', 'h265');
    }
    if (v.canPlayType('video/webm; codecs="vp9"') === 'probably') {
      codecs.push('vp9');
    }
    if (v.canPlayType('video/mp4; codecs="av01.0.04M.08"') === 'probably') {
      codecs.push('av1');
    }
  } catch {
    codecs.push('vp9', 'av1');
  }
  cachedDirectPlayVideoCodecs = codecs.join(',');
  return cachedDirectPlayVideoCodecs;
}
