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

export function parseWebVtt(vttContent: string): SubtitleCue[] {
  const normalized = vttContent
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);

    if (lines.length === 0) continue;
    const first = lines[0].trim();
    if (
      first.startsWith('WEBVTT') ||
      first.startsWith('NOTE') ||
      first.startsWith('STYLE') ||
      first.startsWith('REGION')
    ) {
      continue;
    }

    // Find the timing line ("00:01:23.450 --> 00:01:26.100 ...")
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const [startPart, endAndSettings] = timeLine.split('-->');
    if (!startPart || !endAndSettings) continue;

    const endToken = endAndSettings.trim().split(/\s+/)[0];
    const start = parseTimestamp(startPart);
    const end = parseTimestamp(endToken);
    if (start === null || end === null || end <= start) continue;

    const textLines = lines
      .slice(timeLineIdx + 1)
      .map(sanitizeCueText)
      .filter(Boolean);

    if (textLines.length > 0) {
      cues.push({
        start,
        end,
        text: textLines.join('\n'),
      });
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

const subtitleCueCache = new Map<string, SubtitleCue[]>();

/**
 * Fetch WebVTT / SRT subtitles from Jellyfin with in-memory caching, fallback URL formats
 * (.vtt with/without /0/ and raw .srt), and a generous 90s timeout for large Google Drive MKVs.
 */
export async function fetchSubtitleCues(
  primaryUrl: string,
  authHeader?: string,
  signal?: AbortSignal
): Promise<SubtitleCue[]> {
  const cacheKey = primaryUrl.split('?')[0];
  const cached = subtitleCueCache.get(cacheKey);
  if (cached && cached.length > 0) {
    return cached;
  }

  const candidateUrls: string[] = [primaryUrl];
  // Alternate 1: Jellyfin endpoint without the /0/ startPositionTicks segment
  const altNoZero = primaryUrl.replace(/\/Subtitles\/(\d+)\/0\/Stream\.vtt/i, '/Subtitles/$1/Stream.vtt');
  if (altNoZero !== primaryUrl) {
    candidateUrls.push(altNoZero);
  }
  // Alternate 2: Raw SRT endpoint (parseWebVtt supports both WebVTT and SRT natively!)
  const altSrt = primaryUrl.replace(/\/Stream\.vtt/i, '/Stream.srt');
  if (altSrt !== primaryUrl) {
    candidateUrls.push(altSrt);
  }

  let lastError: Error | null = null;

  for (const url of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 90_000);
      const onExternalAbort = () => controller.abort();
      signal?.addEventListener('abort', onExternalAbort, { once: true });

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
        const text = await res.text();
        const cues = parseWebVtt(text);
        if (cues.length > 0) {
          subtitleCueCache.set(cacheKey, cues);
          return cues;
        }
        lastError = new Error('Subtitle track returned no cues');
      } finally {
        window.clearTimeout(timeout);
        signal?.removeEventListener('abort', onExternalAbort);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error('Failed to load subtitle track');
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
      // Rank: text > image, non-forced > forced, clean > SDH, default tie-breaker
      const sorted = [...matching].sort((a, b) => {
        const score = (s: SubtitleTrack) =>
          (s.isText ? 100 : 0) +
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
