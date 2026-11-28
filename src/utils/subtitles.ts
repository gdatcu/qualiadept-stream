// Lightweight WebVTT subtitle fetcher & parser for Jellyfin streams.
// Renders crisp custom overlays across Mobile Chrome, Android APK, Desktop, and Samsung Tizen TV
// without relying on fragile browser <track> / video.textTracks index alignment with hls.js.

import type { AppLanguage } from '../i18n';
import type { SubtitleTrack } from '../types/media';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

function parseTimestamp(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    seconds = Number(parts[2]);
  } else {
    minutes = Number(parts[0]);
    seconds = Number(parts[1]);
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function sanitizeCueText(raw: string): string {
  return raw
    // Strip WebVTT / ASS / HTML tags like <i>, <c.color>, {\an8}, <00:01:02.000>
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseSingleBlock(block: string): SubtitleCue | null {
  const lines = block
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return null;
  const first = lines[0].trim();
  if (
    first.startsWith('WEBVTT') ||
    first.startsWith('NOTE') ||
    first.startsWith('STYLE') ||
    first.startsWith('REGION')
  ) {
    return null;
  }

  // Find the timing line ("00:01:23.450 --> 00:01:26.100 ...")
  const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
  if (timeLineIdx === -1) return null;

  const timeLine = lines[timeLineIdx];
  const [startPart, endAndSettings] = timeLine.split('-->');
  if (!startPart || !endAndSettings) return null;

  const endToken = endAndSettings.trim().split(/\s+/)[0];
  const start = parseTimestamp(startPart);
  const end = parseTimestamp(endToken);
  if (start === null || end === null || end <= start) return null;

  const textLines = lines
    .slice(timeLineIdx + 1)
    .map(sanitizeCueText)
    .filter(Boolean);

  if (textLines.length === 0) return null;
  return {
    start,
    end,
    text: textLines.join('\n'),
  };
}

export function parseWebVtt(vttContent: string): SubtitleCue[] {
  const normalized = vttContent
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const parsed = parseSingleBlock(block);
    if (parsed) cues.push(parsed);
  }

  return cues.sort((a, b) => a.start - b.start);
}

const subtitleCueCache = new Map<string, SubtitleCue[]>();

interface InFlightSubtitleEntry {
  promise: Promise<SubtitleCue[]>;
  latestCues: SubtitleCue[];
  listeners: Set<(cues: SubtitleCue[]) => void>;
}

const inFlightSubtitles = new Map<string, InFlightSubtitleEntry>();

function emitProgress(entry: InFlightSubtitleEntry, cues: SubtitleCue[]): void {
  entry.latestCues = cues;
  for (const listener of entry.listeners) {
    listener(cues);
  }
}

async function streamSubtitleUrl(
  url: string,
  authHeader: string | undefined,
  entry: InFlightSubtitleEntry
): Promise<SubtitleCue[]> {
  const controller = new AbortController();
  const IDLE_TIMEOUT_MS = 45_000;
  const MAX_TOTAL_TIMEOUT_MS = 180_000;

  let idleTimer = window.setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  const totalTimer = window.setTimeout(() => controller.abort(), MAX_TOTAL_TIMEOUT_MS);
  const resetIdle = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };

  try {
    const headers: Record<string, string> = {};
    if (authHeader) {
      headers.Authorization = authHeader;
    }
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      const cues = parseWebVtt(text);
      if (cues.length > 0) emitProgress(entry, cues);
      return cues;
    }

    const decoder = new TextDecoder('utf-8');
    const cues: SubtitleCue[] = [];
    let pending = '';
    let lastEmitAt = 0;
    let emittedCount = 0;
    let isFirstChunk = true;

    const flushPendingBlocks = (flushAll: boolean) => {
      const normalized = pending.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const parts = normalized.split(/\n{2,}/);
      if (flushAll) {
        pending = '';
      } else {
        pending = parts.pop() || '';
      }
      for (const block of parts) {
        const parsed = parseSingleBlock(block);
        if (parsed) cues.push(parsed);
      }

      if (cues.length > emittedCount) {
        const now = Date.now();
        // Emit immediately when the very first cue arrives so subtitles appear in ~1-2s,
        // then throttle progressive updates to every 250ms to keep UI silky smooth.
        if (emittedCount === 0 || flushAll || now - lastEmitAt >= 250) {
          emittedCount = cues.length;
          lastEmitAt = now;
          emitProgress(entry, [...cues]);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      resetIdle();
      if (done) {
        pending += decoder.decode();
        flushPendingBlocks(true);
        break;
      }
      if (value) {
        let chunk = decoder.decode(value, { stream: true });
        if (isFirstChunk) {
          chunk = chunk.replace(/^\uFEFF/, '');
          isFirstChunk = false;
        }
        pending += chunk;
        if (pending.includes('\n\n') || pending.includes('\r\n\r\n')) {
          flushPendingBlocks(false);
        }
      }
    }

    cues.sort((a, b) => a.start - b.start);
    return cues;
  } finally {
    window.clearTimeout(idleTimer);
    window.clearTimeout(totalTimer);
  }
}

function startSharedSubtitleFetch(
  primaryUrl: string,
  authHeader?: string
): InFlightSubtitleEntry {
  const cacheKey = primaryUrl.split('?')[0];
  const existing = inFlightSubtitles.get(cacheKey);
  if (existing) return existing;

  const candidateUrls: string[] = [primaryUrl];
  // Alternate 1: Jellyfin endpoint without the /0/ startPositionTicks segment
  const altNoZero = primaryUrl.replace(
    /\/Subtitles\/(\d+)\/0\/Stream\.vtt/i,
    '/Subtitles/$1/Stream.vtt'
  );
  if (altNoZero !== primaryUrl) {
    candidateUrls.push(altNoZero);
  }
  // Alternate 2: Raw SRT endpoint (parseWebVtt supports both WebVTT and SRT natively!)
  const altSrt = primaryUrl.replace(/\/Stream\.vtt/i, '/Stream.srt');
  if (altSrt !== primaryUrl) {
    candidateUrls.push(altSrt);
  }

  const entry: InFlightSubtitleEntry = {
    promise: Promise.resolve([]),
    latestCues: [],
    listeners: new Set(),
  };

  entry.promise = (async () => {
    let lastError: Error | null = null;
    for (const url of candidateUrls) {
      try {
        const cues = await streamSubtitleUrl(url, authHeader, entry);
        if (cues.length > 0) {
          subtitleCueCache.set(cacheKey, cues);
          emitProgress(entry, cues);
          return cues;
        }
        lastError = new Error('Subtitle track returned no cues');
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError || new Error('Failed to load subtitle track');
  })().finally(() => {
    inFlightSubtitles.delete(cacheKey);
  });

  inFlightSubtitles.set(cacheKey, entry);
  return entry;
}

/**
 * Warms a subtitle track in the background (e.g. while user reads DetailModal or
 * nears the end of an episode) so playback starts with subtitles ready instantly.
 */
export function prefetchSubtitleCues(primaryUrl: string, authHeader?: string): void {
  const cacheKey = primaryUrl.split('?')[0];
  if (subtitleCueCache.has(cacheKey) || inFlightSubtitles.has(cacheKey)) return;
  const entry = startSharedSubtitleFetch(primaryUrl, authHeader);
  entry.promise.catch(() => {});
}

/**
 * Fetch WebVTT / SRT subtitles from Jellyfin with progressive streaming (shows the
 * first dialogue lines in ~1-2s instead of waiting for full MKV extraction),
 * shared in-flight deduplication, and in-memory caching.
 */
export async function fetchSubtitleCues(
  primaryUrl: string,
  authHeader?: string,
  signal?: AbortSignal,
  onProgress?: (cues: SubtitleCue[]) => void
): Promise<SubtitleCue[]> {
  const cacheKey = primaryUrl.split('?')[0];
  const cached = subtitleCueCache.get(cacheKey);
  if (cached && cached.length > 0) {
    return cached;
  }

  const entry = startSharedSubtitleFetch(primaryUrl, authHeader);

  if (onProgress) {
    entry.listeners.add(onProgress);
    // Immediately deliver any cues already extracted by a background prefetch!
    if (entry.latestCues.length > 0 && !signal?.aborted) {
      onProgress(entry.latestCues);
    }
  }

  const cleanup = () => {
    if (onProgress) entry.listeners.delete(onProgress);
  };

  if (!signal) {
    try {
      return await entry.promise;
    } finally {
      cleanup();
    }
  }

  if (signal.aborted) {
    cleanup();
    throw new DOMException('Aborted', 'AbortError');
  }

  return await new Promise<SubtitleCue[]>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    entry.promise.then(
      (cues) => {
        signal.removeEventListener('abort', onAbort);
        cleanup();
        if (!signal.aborted) resolve(cues);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        cleanup();
        if (!signal.aborted) reject(err);
      }
    );
  });
}

export type SubtitleSize = 'sm' | 'md' | 'lg' | 'xl';
export type SubtitleStyle = 'pill' | 'outline' | 'box';

export interface SubtitlePreferences {
  size: SubtitleSize;
  style: SubtitleStyle;
  preferredLanguage: string | null;
}

const SUBTITLE_PREFS_KEY = 'qualiadept_subtitle_prefs_v1';

const DEFAULT_SUBTITLE_PREFS: SubtitlePreferences = {
  size: 'md',
  style: 'pill',
  preferredLanguage: null,
};

export function loadSubtitlePreferences(): SubtitlePreferences {
  try {
    const raw = localStorage.getItem(SUBTITLE_PREFS_KEY);
    if (!raw) return DEFAULT_SUBTITLE_PREFS;
    const parsed = JSON.parse(raw) as Partial<SubtitlePreferences>;
    return {
      size:
        parsed.size === 'sm' || parsed.size === 'md' || parsed.size === 'lg' || parsed.size === 'xl'
          ? parsed.size
          : 'md',
      style:
        parsed.style === 'pill' || parsed.style === 'outline' || parsed.style === 'box'
          ? parsed.style
          : 'pill',
      preferredLanguage:
        typeof parsed.preferredLanguage === 'string' && parsed.preferredLanguage.trim()
          ? parsed.preferredLanguage.trim().toLowerCase()
          : null,
    };
  } catch {
    return DEFAULT_SUBTITLE_PREFS;
  }
}

export function saveSubtitlePreferences(prefs: SubtitlePreferences): void {
  try {
    localStorage.setItem(SUBTITLE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors
  }
}

const CANONICAL_LANG_MAP: Record<string, string> = {
  ro: 'ro',
  ron: 'ro',
  rum: 'ro',
  'ro-ro': 'ro',
  romanian: 'ro',
  'română': 'ro',
  romana: 'ro',
  en: 'en',
  eng: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  english: 'en',
  'engleză': 'en',
  engleza: 'en',
  fr: 'fr',
  fre: 'fr',
  fra: 'fr',
  french: 'fr',
  'franceză': 'fr',
  es: 'es',
  spa: 'es',
  spanish: 'es',
  'spaniolă': 'es',
  de: 'de',
  ger: 'de',
  deu: 'de',
  german: 'de',
  'germană': 'de',
  it: 'it',
  ita: 'it',
  italian: 'it',
  'italiană': 'it',
  pt: 'pt',
  por: 'pt',
  hu: 'hu',
  hun: 'hu',
  pl: 'pl',
  pol: 'pl',
  ru: 'ru',
  rus: 'ru',
  tr: 'tr',
  tur: 'tr',
  ja: 'ja',
  jpn: 'ja',
  ko: 'ko',
  kor: 'ko',
};

const ROMANIAN_LABEL_RE = /\b(romanian|rom[âa]n[ăa]|ro|ron|rum)\b/i;

export function normalizeSubtitleLang(langCode?: string | null, label?: string | null): string {
  const raw = (langCode || '').trim().toLowerCase();
  if (raw && raw !== 'und' && raw !== 'unknown') {
    if (CANONICAL_LANG_MAP[raw]) return CANONICAL_LANG_MAP[raw];
    const base = raw.split(/[-_]/)[0];
    if (CANONICAL_LANG_MAP[base]) return CANONICAL_LANG_MAP[base];
    return base;
  }
  const cleanLabel = (label || '').trim();
  if (cleanLabel && ROMANIAN_LABEL_RE.test(cleanLabel)) {
    return 'ro';
  }
  return raw || 'und';
}

export function isRomanianTrack(track: { language?: string | null; label?: string | null }): boolean {
  return normalizeSubtitleLang(track.language, track.label) === 'ro';
}

export function hasRomanianSubtitle(subtitles: SubtitleTrack[]): boolean {
  return subtitles.some((s) => isRomanianTrack(s));
}

function isSdhOrHearingImpaired(label?: string): boolean {
  if (!label) return false;
  return /\b(sdh|cc|hi|hearing impaired)\b/i.test(label);
}

/**
 * Picks the best subtitle track for the viewer:
 * - Normalizes ro/ron/rum/Romanian interchangeably
 * - Auto-selects Romanian when UI is in Romanian (unless explicitly set to 'off' or audio is already Romanian)
 * - Prefers text subtitles (zero transcoding) and non-forced/non-SDH tracks
 */
export function pickPreferredSubtitleTrack(
  subtitles: SubtitleTrack[],
  options: {
    preferredLanguage?: string | null;
    appLang: AppLanguage;
    activeAudioLanguage?: string | null;
    activeAudioLabel?: string | null;
  }
): SubtitleTrack | null {
  if (subtitles.length === 0) return null;

  const prefRaw = (options.preferredLanguage || '').trim().toLowerCase();
  if (prefRaw === 'off') return null;

  const targetLang = prefRaw
    ? normalizeSubtitleLang(prefRaw)
    : options.appLang === 'ro'
    ? 'ro'
    : null;

  const audioIsRomanian = isRomanianTrack({
    language: options.activeAudioLanguage,
    label: options.activeAudioLabel,
  });

  if (targetLang) {
    // Don't auto-enable full Romanian subtitles over Romanian audio unless user explicitly saved 'ro'
    if (targetLang === 'ro' && audioIsRomanian && !prefRaw) {
      return null;
    }

    const matching = subtitles.filter(
      (s) => normalizeSubtitleLang(s.language, s.label) === targetLang
    );
    if (matching.length > 0) {
      // Rank: text > image, external sidecar (instant) > embedded MKV, non-forced > forced, clean > SDH
      const sorted = [...matching].sort((a, b) => {
        const score = (s: SubtitleTrack) =>
          (s.isText ? 100 : 0) +
          (s.isExternal ? 60 : 0) +
          (!s.isForced ? 40 : 0) +
          (!isSdhOrHearingImpaired(s.label) ? 10 : 0) +
          (s.isDefault ? 5 : 0);
        return score(b) - score(a);
      });
      return sorted[0];
    }
  }

  // Fallback to container default subtitle only if user hasn't picked a different preference
  if (!prefRaw) {
    const def = subtitles.find((s) => s.isDefault);
    if (def && !(audioIsRomanian && isRomanianTrack(def) && !def.isForced)) {
      return def;
    }
  }

  return null;
}

export function getActiveSubtitleLines(
  cues: SubtitleCue[],
  currentTime: number,
  offsetSeconds = 0
): string[] {
  if (cues.length === 0) return [];
  const adjustedTime = currentTime - offsetSeconds;
  const active: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.start <= adjustedTime && c.end >= adjustedTime) {
      active.push(c.text);
    }
  }
  return active;
}
