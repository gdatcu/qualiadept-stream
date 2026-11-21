import type { QualityPreset } from '../types/media';

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

const THROUGHPUT_KEY = 'qualiadept_measured_mbps_v2';
const THROUGHPUT_TTL_MS = 5 * 60 * 1000;

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

export function getNextLowerQuality(q: QualityPreset): QualityPreset | null {
  switch (q) {
    case 'auto':
    case '1080p':
      return '720p';
    case '720p':
      return '480p';
    case '480p':
      return '360p';
    case '360p':
      return null;
  }
}

/**
 * Chooses the fastest, most fluid starting stream quality for the current network.
 *
 * Crucially, on fast 5G / 4G / Wi-Fi we prefer 'auto' (Original) so Jellyfin uses
 * Direct Play or zero-CPU video remux (-c:v copy) instead of forcing heavy ARM64
 * software video transcoding (which causes startup delays and mid-stream buffering).
 * We only cap quality upfront when the mobile signal is genuinely constrained
 * (Save Data, 2G/3G, low downlink, high RTT, or slow measured transfer speed).
 */
export function getRecommendedQuality(): QualityPreset {
  const conn = getConnection();
  const measured = getStoredThroughputMbps();
  const downlink =
    conn && typeof conn.downlink === 'number' && conn.downlink > 0 ? conn.downlink : null;
  const rtt = conn && typeof conn.rtt === 'number' && conn.rtt > 0 ? conn.rtt : null;

  const effectiveMbps =
    measured !== null && downlink !== null
      ? Math.min(measured, downlink)
      : measured ?? downlink;

  if (conn?.saveData || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') {
    return '360p';
  }
  if (effectiveMbps !== null && effectiveMbps < 1.3) {
    return '360p';
  }
  if (rtt !== null && rtt > 450) {
    return '360p';
  }

  if (conn?.effectiveType === '3g') {
    return '480p';
  }
  if (effectiveMbps !== null && effectiveMbps < 3.0) {
    return '480p';
  }
  if (rtt !== null && rtt > 260) {
    return '480p';
  }

  // Moderately constrained cellular (e.g. congested 4G < 5.5 Mbps): cap at 720p (3 Mbps)
  if (conn?.type === 'cellular' && effectiveMbps !== null && effectiveMbps < 5.5) {
    return '720p';
  }

  // Fast 5G / 4G / Wi-Fi: prefer Original (Direct Play / zero-CPU remux = instant Netflix-like start!)
  return 'auto';
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
