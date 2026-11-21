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

const THROUGHPUT_KEY = 'qualiadept_measured_mbps_v1';
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

export function recordMeasuredThroughput(mbps: number): void {
  if (!Number.isFinite(mbps) || mbps <= 0.05 || mbps > 500) return;
  try {
    const conn = getConnection();
    const connKey = getConnectionKey(conn);
    const prev = getStoredThroughputMbps();
    // Exponentially weighted moving average (Netflix-style ABR smoothing)
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
 * Chooses the optimal starting stream quality based on live Network Information API
 * metrics (type, effectiveType, downlink, rtt, saveData) AND recent real measured
 * fragment throughput from media.qualiadept.eu so mobile playback starts fast and
 * avoids mid-stream buffering stalls.
 */
export function getRecommendedQuality(): QualityPreset {
  const conn = getConnection();
  const measured = getStoredThroughputMbps();
  const downlink =
    conn && typeof conn.downlink === 'number' && conn.downlink > 0 ? conn.downlink : null;
  const rtt = conn && typeof conn.rtt === 'number' && conn.rtt > 0 ? conn.rtt : null;

  // Prefer real measured server-to-device throughput when available, conservatively capped by downlink
  const effectiveMbps =
    measured !== null && downlink !== null
      ? Math.min(measured, downlink)
      : measured ?? downlink;

  if (conn?.saveData || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') {
    return '360p';
  }
  if (effectiveMbps !== null && effectiveMbps < 1.4) {
    return '360p';
  }
  if (rtt !== null && rtt > 400) {
    return '360p';
  }

  if (conn?.effectiveType === '3g') {
    return '480p';
  }
  if (effectiveMbps !== null && effectiveMbps < 3.4) {
    return '480p';
  }
  if (rtt !== null && rtt > 220) {
    return '480p';
  }

  if (conn?.type === 'cellular') {
    // On cellular (4G / 5G): pick 480p when signal/latency looks congested, 720p (3 Mbps) otherwise
    if ((effectiveMbps !== null && effectiveMbps < 5.5) || (rtt !== null && rtt > 140)) {
      return '480p';
    }
    return '720p';
  }

  // Wi-Fi / Ethernet / Desktop
  if (effectiveMbps !== null && effectiveMbps < 5.0) {
    return '720p';
  }

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
