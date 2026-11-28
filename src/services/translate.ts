import { isHiddenLanguageSession, type AppLanguage } from '../i18n';

const STORAGE_KEY = 'qualiadept_desc_translations_v1';
const MAX_CACHE_ENTRIES = 400;
const REQUEST_TIMEOUT_MS = 8_000;
const FAILURE_COOLDOWN_MS = 60_000;
const MAX_CONCURRENT = 2;
const MIN_SPACING_MS = 45;

// Instant offline Romanian translations for the built-in Demo Mode catalog
const DEMO_TRANSLATIONS_RO: Record<string, string> = {
  'In an apocalyptic Amsterdam, a group of warriors and scientists gather at the Oude Kerk to stage a desperate mission to save the world from destructive robots.':
    'Într-un Amsterdam apocaliptic, un grup de luptători și oameni de știință se adună la Oude Kerk pentru o misiune disperată de a salva lumea de roboții distructivi.',
  'A lonely young woman, Sintel, helps and befriends a baby dragon, whom she calls Scales. When he is kidnapped by an adult dragon, Sintel embarks on a perilous quest to find him.':
    'O tânără singuratică, Sintel, ajută și se împrietenește cu un pui de dragon pe care îl numește Scales. Când acesta este răpit de un dragon adult, Sintel pornește într-o călătorie primejdioasă pentru a-l găsi.',
  'A giant, gentle rabbit deals with three bullying rodents in a lush forest, devising an ingenious and hilarious plan to teach them a lesson.':
    'Un iepure uriaș și blând are de-a face cu trei rozătoare răutăcioase într-o pădure luxuriantă și pune la cale un plan ingenios și amuzant pentru a le da o lecție.',
  'Two strange characters, Proog and Emo, explore a capricious and seemingly infinite mechanical world, testing the boundaries of perception and trust.':
    'Două personaje ciudate, Proog și Emo, explorează o lume mecanică capricioasă și aparent infinită, punând la încercare limitele percepției și ale încrederii.',
  'A curated showcase of open-source short films demonstrating multi-season browsing, episode playback, and adaptive HLS streaming on Qualiadept Stream.':
    'O selecție de scurtmetraje open-source care demonstrează navigarea pe sezoane, redarea episoadelor și streamingul adaptiv HLS pe Qualiadept Stream.',
  'Adaptive HLS test stream demonstrating instant seeking and quality switching.':
    'Flux de test HLS adaptiv care demonstrează derularea instantanee și schimbarea calității.',
  'Direct Play MP4 demonstration with crisp 1080p playback.':
    'Demonstrație MP4 Direct Play cu redare clară la rezoluție 1080p.',
};

const PLACEHOLDER_OVERVIEWS = new Set([
  'no description available.',
  'nicio descriere disponibilă.',
]);

const RO_DIACRITIC_WORD_RE = /\S*[ăâîșțşţ]\S*/gi;
const RO_STOPWORD_RE =
  /\b(și|este|sunt|pentru|într-o|într-un|după|când|către|despre|fără|dintre|această|acest|unui|unei|însă|încă|până|printre|atunci|fiind|devine|viața|lumea|își|să)\b/gi;
const EN_STOPWORD_RE =
  /\b(the|and|with|that|this|from|they|their|when|into|who|which|have|has|been|will|would|about|through|after|before|between)\b/gi;

let cacheLoaded = false;
const memoryCache = new Map<string, string>();
const recentFailures = new Map<string, number>();
let persistTimer: number | null = null;

function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}_${text.length}`;
}

function makeCacheKey(text: string, targetLang: AppLanguage): string {
  return `${targetLang}:${hashText(text)}`;
}

function ensureCacheLoaded(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === 'string' && val.length > 0) {
        memoryCache.set(key, val);
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
    // Enforce LRU size cap (Map preserves insertion order)
    while (memoryCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = memoryCache.keys().next().value;
      if (oldestKey === undefined) break;
      memoryCache.delete(oldestKey);
    }
    const obj: Record<string, string> = {};
    for (const [k, v] of memoryCache.entries()) {
      obj[k] = v;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // Storage quota tight: trim to newest 150 entries and retry once
      try {
        while (memoryCache.size > 150) {
          const oldestKey = memoryCache.keys().next().value;
          if (oldestKey === undefined) break;
          memoryCache.delete(oldestKey);
        }
        const trimmed: Record<string, string> = {};
        for (const [k, v] of memoryCache.entries()) {
          trimmed[k] = v;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // Ignore quota errors
      }
    }
  }, 400);
}

function storeCachedTranslation(key: string, translated: string): void {
  memoryCache.delete(key);
  memoryCache.set(key, translated);
  while (memoryCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey === undefined) break;
    memoryCache.delete(oldestKey);
  }
  schedulePersist();
}

export function looksRomanian(text: string): boolean {
  const diacriticWords = text.match(RO_DIACRITIC_WORD_RE)?.length ?? 0;
  const roStopwords = text.match(RO_STOPWORD_RE)?.length ?? 0;
  const enStopwords = text.match(EN_STOPWORD_RE)?.length ?? 0;
  const roSignal = diacriticWords + roStopwords;
  if (roSignal < 2) return false;
  return roSignal > enStopwords;
}

export function needsTranslation(
  text: string | undefined,
  targetLang: AppLanguage
): boolean {
  const trimmed = (text || '').trim();
  if (trimmed.length < 2) return false;
  if (PLACEHOLDER_OVERVIEWS.has(trimmed.toLowerCase())) return false;
  if (targetLang === 'ro') {
    return !looksRomanian(trimmed);
  }
  // In English mode, keep English metadata untouched and only translate Romanian descriptions
  return looksRomanian(trimmed);
}

/**
 * Synchronous cache lookup used on initial render to guarantee zero flicker
 * whenever a translation is already cached or unnecessary.
 */
export function getCachedTranslation(
  text: string | undefined,
  targetLang: AppLanguage
): string | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  if (!needsTranslation(trimmed, targetLang)) return trimmed;

  if (targetLang === 'ro' && DEMO_TRANSLATIONS_RO[trimmed]) {
    return DEMO_TRANSLATIONS_RO[trimmed];
  }

  ensureCacheLoaded();
  const key = makeCacheKey(trimmed, targetLang);
  const hit = memoryCache.get(key);
  if (hit !== undefined) {
    // Refresh recency for LRU ordering
    memoryCache.delete(key);
    memoryCache.set(key, hit);
    return hit;
  }
  return null;
}

function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n+/);
  let current = '';

  const pushSegment = (segment: string) => {
    const trimmed = segment.trim();
    if (!trimmed) return;
    if (!current) {
      current = trimmed;
      return;
    }
    if (current.length + 1 + trimmed.length <= maxLen) {
      current = `${current} ${trimmed}`;
    } else {
      chunks.push(current);
      current = trimmed;
    }
  };

  for (const para of paragraphs) {
    if (para.length <= maxLen) {
      pushSegment(para);
      continue;
    }
    const sentences = para.split(/(?<=[.!?…])\s+/);
    for (const sentence of sentences) {
      if (sentence.length <= maxLen) {
        pushSegment(sentence);
      } else {
        // Fallback: split very long single sentence on spaces
        const words = sentence.split(/\s+/);
        for (const word of words) {
          pushSegment(word);
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

async function fetchJsonWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Plain GET with zero custom headers = CORS simple request (no OPTIONS preflight)
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function translateViaGoogleGtx(text: string, targetLang: AppLanguage): Promise<string> {
  const chunks = splitIntoChunks(text, 1200);
  const parts: string[] = [];

  for (const chunk of chunks) {
    const url =
      `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(chunk)}`;
    const data = await fetchJsonWithTimeout(url);
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error('Unexpected Google Translate response');
    }
    const translatedChunk = (data[0] as unknown[])
      .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('')
      .trim();
    if (!translatedChunk) {
      throw new Error('Empty Google Translate result');
    }
    parts.push(translatedChunk);
  }

  return parts.join(' ').trim();
}

async function translateViaMyMemory(text: string, targetLang: AppLanguage): Promise<string> {
  const sourceLang = targetLang === 'ro' ? 'en' : 'ro';
  const chunks = splitIntoChunks(text, 450);
  const parts: string[] = [];

  for (const chunk of chunks) {
    const url =
      `https://api.mymemory.translated.net/get` +
      `?q=${encodeURIComponent(chunk)}&langpair=${sourceLang}|${targetLang}`;
    const data = (await fetchJsonWithTimeout(url)) as {
      responseStatus?: number;
      responseData?: { translatedText?: string };
    };
    const translatedChunk = data?.responseData?.translatedText?.trim();
    if (
      data?.responseStatus !== 200 ||
      !translatedChunk ||
      /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translatedChunk)
    ) {
      throw new Error('MyMemory translation unavailable');
    }
    parts.push(translatedChunk);
  }

  return parts.join(' ').trim();
}

interface QueuedTask {
  key: string;
  text: string;
  targetLang: AppLanguage;
  priority: 'high' | 'normal';
  refCount: number;
  resolve: (value: string) => void;
  cleanupListeners: Array<() => void>;
}

interface InFlightEntry {
  promise: Promise<string>;
  task: QueuedTask;
}

const inFlightEntries = new Map<string, InFlightEntry>();
const taskQueue: QueuedTask[] = [];
let activeCount = 0;

function enqueueTask(task: QueuedTask): void {
  if (task.priority === 'high') {
    const insertAt = taskQueue.findIndex((t) => t.priority !== 'high');
    if (insertAt === -1) taskQueue.push(task);
    else taskQueue.splice(insertAt, 0, task);
  } else {
    taskQueue.push(task);
  }
}

function drainQueue(): void {
  while (activeCount < MAX_CONCURRENT && taskQueue.length > 0) {
    const task = taskQueue.shift()!;
    activeCount++;
    void executeTask(task).finally(() => {
      window.setTimeout(() => {
        activeCount = Math.max(0, activeCount - 1);
        drainQueue();
      }, MIN_SPACING_MS);
    });
  }
}

function cleanupTaskListeners(task: QueuedTask): void {
  for (const off of task.cleanupListeners) {
    off();
  }
  task.cleanupListeners.length = 0;
}

async function executeTask(task: QueuedTask): Promise<void> {
  try {
    let result: string | null = null;
    try {
      result = await translateViaGoogleGtx(task.text, task.targetLang);
    } catch {
      try {
        result = await translateViaMyMemory(task.text, task.targetLang);
      } catch {
        result = null;
      }
    }

    if (result && result.length > 0) {
      recentFailures.delete(task.key);
      storeCachedTranslation(task.key, result);
      task.resolve(result);
    } else {
      recentFailures.set(task.key, Date.now());
      task.resolve(task.text);
    }
  } catch {
    recentFailures.set(task.key, Date.now());
    task.resolve(task.text);
  } finally {
    cleanupTaskListeners(task);
    inFlightEntries.delete(task.key);
  }
}

function attachAbortSignal(task: QueuedTask, signal?: AbortSignal): void {
  if (!signal) return;
  const onAbort = () => {
    task.refCount = Math.max(0, task.refCount - 1);
    if (task.refCount === 0) {
      const idx = taskQueue.indexOf(task);
      if (idx !== -1) {
        taskQueue.splice(idx, 1);
        cleanupTaskListeners(task);
        inFlightEntries.delete(task.key);
        task.resolve(task.text);
      }
    }
  };
  signal.addEventListener('abort', onAbort, { once: true });
  task.cleanupListeners.push(() => signal.removeEventListener('abort', onAbort));
}

export interface TranslateOptions {
  priority?: 'high' | 'normal';
  signal?: AbortSignal;
}

/**
 * Translates a media description or tagline into the target language on demand,
 * with persistent LRU caching, request deduplication, priority queueing, and
 * silent fallback to the original text when offline.
 */
export async function translateText(
  text: string | undefined,
  targetLang: AppLanguage,
  options: TranslateOptions = {}
): Promise<string> {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';

  const cached = getCachedTranslation(trimmed, targetLang);
  if (cached !== null) return cached;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return trimmed;
  }

  const key = makeCacheKey(trimmed, targetLang);
  const failedAt = recentFailures.get(key);
  if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) {
    return trimmed;
  }

  if (options.signal?.aborted) {
    return trimmed;
  }

  const priority = options.priority ?? 'normal';

  const existing = inFlightEntries.get(key);
  if (existing) {
    existing.task.refCount++;
    // Promote queued task to high priority if a foreground component requests it
    if (priority === 'high' && existing.task.priority !== 'high') {
      const idx = taskQueue.indexOf(existing.task);
      if (idx !== -1) {
        taskQueue.splice(idx, 1);
        existing.task.priority = 'high';
        enqueueTask(existing.task);
      }
    }
    attachAbortSignal(existing.task, options.signal);
    return existing.promise;
  }

  let task!: QueuedTask;
  const promise = new Promise<string>((resolve) => {
    task = {
      key,
      text: trimmed,
      targetLang,
      priority,
      refCount: 1,
      resolve,
      cleanupListeners: [],
    };
    enqueueTask(task);
    attachAbortSignal(task, options.signal);
    drainQueue();
  });

  inFlightEntries.set(key, { promise, task });
  return promise;
}
