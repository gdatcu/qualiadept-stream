import { isHiddenLanguageSession, type AppLanguage } from '../i18n';
import type { MediaItem } from '../types/media';

const STORAGE_KEY = 'qualiadept_ro_official_meta_v1';
const MAX_CACHE_ENTRIES = 600;
const HIT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const REQUEST_TIMEOUT_MS = 8_000;
const TMDB_CONCURRENCY = 4;

export interface OfficialRoMeta {
  title?: string;
  overview?: string;
  tagline?: string;
  source: 'tmdb' | 'wikidata' | 'none';
  ts: number;
}

const RAW_TMDB_KEY = (import.meta.env.VITE_TMDB_API_KEY as string | undefined)?.trim() || '';

export function hasTmdbApiKey(): boolean {
  return RAW_TMDB_KEY.length > 0;
}

function isBearerToken(key: string): boolean {
  return key.startsWith('eyJ') || key.length > 64;
}

let cacheLoaded = false;
const memoryCache = new Map<string, OfficialRoMeta>();
const inFlight = new Map<string, Promise<OfficialRoMeta | null>>();
const listeners = new Set<() => void>();
let persistTimer: number | null = null;
let notifyTimer: number | null = null;
let cacheVersion = 0;

function notifyListeners(): void {
  cacheVersion++;
  if (notifyTimer !== null) return;
  notifyTimer = window.setTimeout(() => {
    notifyTimer = null;
    for (const fn of listeners) {
      fn();
    }
  }, 120);
}

export function subscribeOfficialRoMeta(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOfficialRoMetaVersion(): number {
  return cacheVersion;
}

function ensureCacheLoaded(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, OfficialRoMeta>;
    if (!parsed || typeof parsed !== 'object') return;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== 'object' || typeof entry.ts !== 'number') continue;
      const ttl = entry.source === 'none' ? MISS_TTL_MS : HIT_TTL_MS;
      if (now - entry.ts < ttl) {
        memoryCache.set(key, entry);
      }
    }
  } catch {
    // Ignore storage read errors
  }
}

function schedulePersist(): void {
  if (isHiddenLanguageSession()) return;
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    if (isHiddenLanguageSession()) return;
    while (memoryCache.size > MAX_CACHE_ENTRIES) {
      const oldest = memoryCache.keys().next().value;
      if (oldest === undefined) break;
      memoryCache.delete(oldest);
    }
    const obj: Record<string, OfficialRoMeta> = {};
    for (const [k, v] of memoryCache.entries()) {
      obj[k] = v;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      try {
        while (memoryCache.size > 200) {
          const oldest = memoryCache.keys().next().value;
          if (oldest === undefined) break;
          memoryCache.delete(oldest);
        }
        const trimmed: Record<string, OfficialRoMeta> = {};
        for (const [k, v] of memoryCache.entries()) {
          trimmed[k] = v;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // Ignore quota errors
      }
    }
  }, 500);
}

function storeEntry(key: string, entry: OfficialRoMeta): void {
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  while (memoryCache.size > MAX_CACHE_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
  schedulePersist();
  notifyListeners();
}

export interface MetaLookupTarget {
  type: MediaItem['type'];
  tmdbId?: string;
  imdbId?: string;
}

function getCacheKey(target: MetaLookupTarget): string | null {
  const kind = target.type === 'Series' ? 'tv' : target.type === 'Movie' ? 'movie' : null;
  if (!kind) return null;
  if (target.tmdbId) return `${kind}:tmdb:${target.tmdbId}`;
  if (target.imdbId) return `${kind}:imdb:${target.imdbId}`;
  return null;
}

export function getCachedOfficialRoMeta(target: MetaLookupTarget): OfficialRoMeta | null {
  const key = getCacheKey(target);
  if (!key) return null;
  ensureCacheLoaded();
  const entry = memoryCache.get(key);
  if (!entry) return null;
  const ttl = entry.source === 'none' ? MISS_TTL_MS : HIT_TTL_MS;
  if (Date.now() - entry.ts >= ttl) {
    memoryCache.delete(key);
    return null;
  }
  return entry;
}

function normalizeCompare(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Returns the localized display title for a MediaItem plus an optional original-title
 * subtitle when the official Romanian title differs from the original title.
 */
export function getLocalizedTitleInfo(
  item: Pick<MediaItem, 'name' | 'type' | 'tmdbId' | 'imdbId'>,
  lang: AppLanguage,
  overrideIds?: { tmdbId?: string; imdbId?: string }
): { title: string; originalTitle: string | null } {
  if (lang !== 'ro') {
    return { title: item.name, originalTitle: null };
  }
  const meta = getCachedOfficialRoMeta({
    type: item.type,
    tmdbId: overrideIds?.tmdbId || item.tmdbId,
    imdbId: overrideIds?.imdbId || item.imdbId,
  });
  const roTitle = meta?.title?.trim();
  if (!roTitle) {
    return { title: item.name, originalTitle: null };
  }
  const isDifferent = normalizeCompare(roTitle) !== normalizeCompare(item.name);
  return {
    title: roTitle,
    originalTitle: isDifferent ? item.name : null,
  };
}

async function fetchJsonWithTimeout(url: string, headers?: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    window.clearTimeout(timer);
  }
}

function buildTmdbRequest(path: string, extraParams = ''): { url: string; headers?: Record<string, string> } {
  const sep = path.includes('?') ? '&' : '?';
  if (isBearerToken(RAW_TMDB_KEY)) {
    return {
      url: `https://api.themoviedb.org/3${path}${extraParams ? `${sep}${extraParams}` : ''}`,
      headers: {
        Authorization: `Bearer ${RAW_TMDB_KEY}`,
        Accept: 'application/json',
      },
    };
  }
  const query = `api_key=${encodeURIComponent(RAW_TMDB_KEY)}${extraParams ? `&${extraParams}` : ''}`;
  return {
    url: `https://api.themoviedb.org/3${path}${sep}${query}`,
  };
}

interface TmdbMediaResponse {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  tagline?: string;
  alternative_titles?: {
    titles?: Array<{ iso_3166_1?: string; title?: string }>;
    results?: Array<{ iso_3166_1?: string; title?: string }>;
  };
}

async function fetchSingleFromTmdb(
  kind: 'movie' | 'tv',
  tmdbId: string
): Promise<OfficialRoMeta | null> {
  try {
    const req = buildTmdbRequest(
      `/${kind}/${encodeURIComponent(tmdbId)}`,
      'language=ro-RO&append_to_response=alternative_titles'
    );
    const data = (await fetchJsonWithTimeout(req.url, req.headers)) as TmdbMediaResponse;
    const primaryRo = (kind === 'movie' ? data.title : data.name)?.trim() || '';
    const original = (kind === 'movie' ? data.original_title : data.original_name)?.trim() || '';

    const altList =
      kind === 'movie'
        ? data.alternative_titles?.titles || []
        : data.alternative_titles?.results || [];
    const roAlt =
      altList.find((a) => a.iso_3166_1 === 'RO' && a.title && a.title.trim().length > 0)?.title?.trim() ||
      '';

    let chosenTitle: string | undefined;
    if (primaryRo && (!original || normalizeCompare(primaryRo) !== normalizeCompare(original))) {
      chosenTitle = primaryRo;
    } else if (roAlt) {
      chosenTitle = roAlt;
    } else if (primaryRo) {
      chosenTitle = primaryRo;
    }

    const overview = data.overview?.trim() || undefined;
    const tagline = data.tagline?.trim() || undefined;

    if (!chosenTitle && !overview && !tagline) {
      return { source: 'none', ts: Date.now() };
    }
    return {
      title: chosenTitle,
      overview,
      tagline,
      source: 'tmdb',
      ts: Date.now(),
    };
  } catch {
    return null;
  }
}

async function resolveTmdbIdFromImdb(
  kind: 'movie' | 'tv',
  imdbId: string
): Promise<string | null> {
  try {
    const req = buildTmdbRequest(
      `/find/${encodeURIComponent(imdbId)}`,
      'external_source=imdb_id&language=ro-RO'
    );
    const data = (await fetchJsonWithTimeout(req.url, req.headers)) as {
      movie_results?: Array<{ id?: number }>;
      tv_results?: Array<{ id?: number }>;
    };
    const hit = kind === 'movie' ? data.movie_results?.[0] : data.tv_results?.[0];
    return hit?.id ? String(hit.id) : null;
  } catch {
    return null;
  }
}

function cleanWikidataTitle(raw: string): string {
  return raw
    .replace(
      /\s*\((?:film|serial|serial TV|miniserial|mini-serial|desen animat|anime|documentar)[^)]*\)\s*$/i,
      ''
    )
    .trim();
}

/**
 * Free, zero-API-key fallback using Wikidata official Romanian labels (`ro`) and
 * Romanian Wikipedia article titles by IMDb ID (never Google Translate).
 */
async function fetchBatchFromWikidata(
  targets: Array<{ key: string; imdbId: string }>
): Promise<void> {
  if (targets.length === 0) return;
  const BATCH_SIZE = 45;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const values = batch
      .map((t) => `"${t.imdbId.replace(/[^a-zA-Z0-9]/g, '')}"`)
      .join(' ');
    const query = `SELECT ?imdb ?roLabel ?roWikiTitle WHERE {
  VALUES ?imdb { ${values} }
  ?item wdt:P345 ?imdb .
  OPTIONAL { ?item rdfs:label ?roLabel . FILTER(LANG(?roLabel) = "ro") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://ro.wikipedia.org/> ; schema:name ?roWikiTitle . }
}`;

    try {
      const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
      const data = (await fetchJsonWithTimeout(url, {
        Accept: 'application/sparql-results+json',
      })) as {
        results?: {
          bindings?: Array<{
            imdb?: { value?: string };
            roLabel?: { value?: string };
            roWikiTitle?: { value?: string };
          }>;
        };
      };

      const foundByImdb = new Map<string, string>();
      for (const row of data?.results?.bindings || []) {
        const imdb = row.imdb?.value;
        if (!imdb || foundByImdb.has(imdb)) continue;
        const rawLabel = row.roLabel?.value || row.roWikiTitle?.value;
        if (rawLabel) {
          const cleaned = cleanWikidataTitle(rawLabel);
          if (cleaned) foundByImdb.set(imdb, cleaned);
        }
      }

      const now = Date.now();
      for (const item of batch) {
        const title = foundByImdb.get(item.imdbId);
        if (title) {
          storeEntry(item.key, { title, source: 'wikidata', ts: now });
        } else {
          storeEntry(item.key, { source: 'none', ts: now });
        }
      }
    } catch {
      // Network error: don't cache as miss so it can retry next session
    }
  }
}

interface TmdbTask {
  key: string;
  kind: 'movie' | 'tv';
  tmdbId?: string;
  imdbId?: string;
  priority: 'high' | 'normal';
  resolve: (value: OfficialRoMeta | null) => void;
}

const tmdbQueue: TmdbTask[] = [];
let tmdbActive = 0;

function drainTmdbQueue(): void {
  while (tmdbActive < TMDB_CONCURRENCY && tmdbQueue.length > 0) {
    const task = tmdbQueue.shift()!;
    tmdbActive++;
    void (async () => {
      try {
        let resolvedTmdbId = task.tmdbId;
        if (!resolvedTmdbId && task.imdbId) {
          resolvedTmdbId = (await resolveTmdbIdFromImdb(task.kind, task.imdbId)) || undefined;
        }
        let meta: OfficialRoMeta | null = null;
        if (resolvedTmdbId) {
          meta = await fetchSingleFromTmdb(task.kind, resolvedTmdbId);
        }
        if (meta) {
          storeEntry(task.key, meta);
        }
        task.resolve(meta);
      } catch {
        task.resolve(null);
      } finally {
        inFlight.delete(task.key);
        tmdbActive = Math.max(0, tmdbActive - 1);
        drainTmdbQueue();
      }
    })();
  }
}

/**
 * Ensures official Romanian metadata is fetched (from TMDB when configured, or
 * Wikidata fallback) for a single Movie or Series item.
 */
export function ensureOfficialRoMeta(
  target: MetaLookupTarget,
  priority: 'high' | 'normal' = 'high'
): Promise<OfficialRoMeta | null> {
  const key = getCacheKey(target);
  if (!key) return Promise.resolve(null);

  const cached = getCachedOfficialRoMeta(target);
  if (cached) return Promise.resolve(cached);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve(null);
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const kind = target.type === 'Series' ? 'tv' : 'movie';

  if (hasTmdbApiKey()) {
    const promise = new Promise<OfficialRoMeta | null>((resolve) => {
      const task: TmdbTask = {
        key,
        kind,
        tmdbId: target.tmdbId,
        imdbId: target.imdbId,
        priority,
        resolve,
      };
      if (priority === 'high') {
        const insertAt = tmdbQueue.findIndex((t) => t.priority !== 'high');
        if (insertAt === -1) tmdbQueue.push(task);
        else tmdbQueue.splice(insertAt, 0, task);
      } else {
        tmdbQueue.push(task);
      }
      drainTmdbQueue();
    });
    inFlight.set(key, promise);
    return promise;
  }

  // Zero-API-key fallback: Wikidata official Romanian title by IMDb ID
  if (target.imdbId) {
    const promise = fetchBatchFromWikidata([{ key, imdbId: target.imdbId }])
      .then(() => getCachedOfficialRoMeta(target))
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, promise);
    return promise;
  }

  return Promise.resolve(null);
}

/**
 * Background batch enrichment for catalog items when the user is in Romanian mode.
 */
export function prefetchOfficialRoMeta(items: MetaLookupTarget[]): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const uniquePending: Array<{ key: string; target: MetaLookupTarget }> = [];
  const seen = new Set<string>();

  for (const target of items) {
    const key = getCacheKey(target);
    if (!key || seen.has(key)) continue;
    if (getCachedOfficialRoMeta(target) || inFlight.has(key)) continue;
    seen.add(key);
    uniquePending.push({ key, target });
  }

  if (uniquePending.length === 0) return;

  if (hasTmdbApiKey()) {
    for (const { target } of uniquePending) {
      void ensureOfficialRoMeta(target, 'normal');
    }
    return;
  }

  // Batch Wikidata lookups into single SPARQL queries (45 IDs per request)
  const wikidataTargets: Array<{ key: string; imdbId: string; target: MetaLookupTarget }> = [];
  for (const { key, target } of uniquePending) {
    if (target.imdbId) {
      wikidataTargets.push({ key, imdbId: target.imdbId, target });
    }
  }
  if (wikidataTargets.length === 0) return;

  const batchPromise = fetchBatchFromWikidata(wikidataTargets).finally(() => {
    for (const t of wikidataTargets) {
      inFlight.delete(t.key);
    }
  });
  for (const t of wikidataTargets) {
    inFlight.set(
      t.key,
      batchPromise.then(() => getCachedOfficialRoMeta(t.target))
    );
  }
}
