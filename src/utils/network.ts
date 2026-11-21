import { QUALITY_OPTIONS, type QualityPreset } from '../types/media';

interface NetworkConnectionLike {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
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

const THROUGHPUT_KEY = 'qualiadept_measured_mbps_v2';
const THROUGHPUT_TTL_MS = 5 * 60 * 1000;
const CEILING_KEY = 'qualiadept_stable_ceiling_v1';
const CEILING_TTL_MS = 15 * 60 * 1000;

function getConnection(): NetworkConnectionLike | null {
  try {
    const nav = navigator as Navigator & { connection?: NetworkConnectionLike };
    return nav.connection ?? null;
  } catch {
    return null;
  }
}

function getConnectionKey(conn: NetworkConnectionLike | null): string {
  if (!conn) return 'unknown';
  return `${conn.type || 'unknown'}:${conn.effectiveType || 'unknown'}`;
}

export function isCellularConnection(): boolean {
  const conn = getConnection();
  return conn?.type === 'cellular';
}

export function getNetworkLabel(): string {
  const conn = getConnection();
  if (!conn) return 'Online';
  if (conn.saveData) return 'Data Saver';
  if (conn.type === 'wifi') return 'Wi-Fi';
  if (conn.type === 'ethernet') return 'Ethernet';
  if (conn.type === 'cellular') {
    if (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g') return '2G Mobile';
    if (conn.effectiveType === '3g') return '3G Mobile';
    return '5G / 4G Mobile';
  }
  if (conn.effectiveType) return conn.effectiveType.toUpperCase();
  return 'Online';
}

/**
 * Records pure network transfer throughput (TTFB excluded so server-side FFmpeg wait
 * never poisons the mobile network speed estimate).
 */
export function recordMeasuredThroughput(mbps: number): void {
  if (!Number.isFinite(mbps) || mbps <= 0.1 || mbps > 500) return;
  try {
    const conn = getConnection();
    const connKey = getConnectionKey(conn);
    const prev = getStoredThroughputMbps();
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
 * for 15 minutes, so subsequent episodes/movies don't repeat the buffering discovery cycle.
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
 * Picks the next lower quality tier that ACTUALLY reduces stream bitrate below
 * both the current tier and the source file's native bitrate (never wastes a step
 * switching from e.g. a 6 Mbps Original to an 8 Mbps 1080p cap).
 */
export function getNextLowerQuality(
  current: QualityPreset,
  sourceBitrate?: number
): QualityPreset | null {
  const ladder: QualityPreset[] = isCellularConnection()
    ? ['auto', '720p', '480p', '360p']
    : ['auto', '1080p', '720p', '480p', '360p'];

  const currentRank = qualityRank(current);
  const currentOptionBitrate =
    QUALITY_OPTIONS.find((o) => o.id === current)?.videoBitrate ?? sourceBitrate ?? 12_000_000;
  const effectiveCurrentBitrate =
    sourceBitrate && current === 'auto'
      ? sourceBitrate
      : Math.min(currentOptionBitrate, sourceBitrate ?? currentOptionBitrate);

  const candidates = ladder.filter((q) => qualityRank(q) < currentRank);
  if (candidates.length === 0) return null;

  // Prefer the first lower tier whose target bitrate is meaningfully (< 88%) below current effective bitrate
  for (const candidate of candidates) {
    const targetBitrate = QUALITY_OPTIONS.find((o) => o.id === candidate)?.videoBitrate;
    if (!targetBitrate || targetBitrate < effectiveCurrentBitrate * 0.88) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1];
}

/**
 * Chooses the optimal starting stream quality for the current network,
 * prioritizing stability over quality whenever a stable ceiling has been observed
 * on this network or the connection reports constrained bandwidth/latency.
 */
export function getRecommendedQuality(): QualityPreset {
  const conn = getConnection();
  const measured = getStoredThroughputMbps();
  const ceiling = getStableCeilingQuality();
  const downlink =
    conn && typeof conn.downlink === 'number' && conn.downlink > 0 ? conn.downlink : null;
  const rtt = conn && typeof conn.rtt === 'number' && conn.rtt > 0 ? conn.rtt : null;

  const effectiveMbps =
    measured !== null && downlink !== null
      ? Math.min(measured, downlink)
      : measured ?? downlink;

  let networkPick: QualityPreset = 'auto';

  if (
    conn?.saveData ||
    conn?.effectiveType === 'slow-2g' ||
    conn?.effectiveType === '2g' ||
    (effectiveMbps !== null && effectiveMbps < 1.3) ||
    (rtt !== null && rtt > 450)
  ) {
    networkPick = '360p';
  } else if (
    conn?.effectiveType === '3g' ||
    (effectiveMbps !== null && effectiveMbps < 3.0) ||
    (rtt !== null && rtt > 260)
  ) {
    networkPick = '480p';
  } else if (conn?.type === 'cellular' && effectiveMbps !== null && effectiveMbps < 5.5) {
    networkPick = '720p';
  }

  if (ceiling && qualityRank(ceiling) < qualityRank(networkPick)) {
    return ceiling;
  }

  return networkPick;
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

let cachedDirectPlayVideoCodecs: string | null = null;

/**
 * Probes the device's actual HTML5 video hardware codec support (including HEVC/H.265
 * on modern Samsung Galaxy / Android Chrome & iOS Safari) so Jellyfin Direct Plays
 * whenever possible instead of CPU-transcoding on the Oracle ARM64 VM.
 */
export function getDirectPlayVideoCodecs(): string {
  if (cachedDirectPlayVideoCodecs) return cachedDirectPlayVideoCodecs;
  const codecs = ['h264'];
  try {
    const v = document.createElement('video');
    if (
      v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== '' ||
      v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') !== ''
    ) {
      codecs.push('hevc', 'h265');
    }
    if (v.canPlayType('video/webm; codecs="vp9"') !== '') {
      codecs.push('vp9');
    }
    if (v.canPlayType('video/mp4; codecs="av01.0.04M.08"') !== '') {
      codecs.push('av1');
    }
  } catch {
    codecs.push('vp9', 'av1');
  }
  cachedDirectPlayVideoCodecs = codecs.join(',');
  return cachedDirectPlayVideoCodecs;
}
