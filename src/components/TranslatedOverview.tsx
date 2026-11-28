import React, { useEffect, useMemo, useState } from 'react';
import { formatOverviewText, type AppLanguage } from '../i18n';
import {
  ensureOfficialRoMeta,
  getCachedOfficialRoMeta,
  getLocalizedTitleInfo,
  getOfficialRoMetaVersion,
  subscribeOfficialRoMeta,
} from '../services/tmdb';
import {
  getCachedTagTranslation,
  getCachedTranslation,
  translateTagsBatch,
  translateText,
} from '../services/translate';
import type { MediaItem } from '../types/media';

/**
 * Subscribes to official Romanian metadata updates (TMDB / Wikidata) when active.
 */
export function useOfficialRoMetaVersion(enabled: boolean): number {
  const [version, setVersion] = useState(() => getOfficialRoMetaVersion());

  useEffect(() => {
    if (!enabled) return;
    setVersion(getOfficialRoMetaVersion());
    return subscribeOfficialRoMeta(() => {
      setVersion(getOfficialRoMetaVersion());
    });
  }, [enabled]);

  return version;
}

/**
 * Resolves official Romanian title (plus original title when different) and
 * official human-written Romanian overview/tagline from TMDB (or Wikidata fallback).
 */
export function useLocalizedMediaMeta(
  item: Pick<MediaItem, 'name' | 'type' | 'tmdbId' | 'imdbId'>,
  lang: AppLanguage,
  overrideIds?: { tmdbId?: string; imdbId?: string }
): {
  title: string;
  originalTitle: string | null;
  officialOverview?: string;
  officialTagline?: string;
} {
  const version = useOfficialRoMetaVersion(lang === 'ro');
  const tmdbId = overrideIds?.tmdbId || item.tmdbId;
  const imdbId = overrideIds?.imdbId || item.imdbId;

  useEffect(() => {
    if (lang !== 'ro') return;
    if (item.type !== 'Movie' && item.type !== 'Series') return;
    if (!tmdbId && !imdbId) return;
    void ensureOfficialRoMeta({ type: item.type, tmdbId, imdbId }, 'high');
  }, [lang, item.type, tmdbId, imdbId]);

  return useMemo(() => {
    void version;
    if (lang !== 'ro') {
      return { title: item.name, originalTitle: null };
    }
    const { title, originalTitle } = getLocalizedTitleInfo(item, lang, { tmdbId, imdbId });
    const meta = getCachedOfficialRoMeta({ type: item.type, tmdbId, imdbId });
    return {
      title,
      originalTitle,
      officialOverview: meta?.overview,
      officialTagline: meta?.tagline,
    };
  }, [version, lang, item.name, item.type, tmdbId, imdbId]);
}

/**
 * Translates dynamic media text (overview / tagline) into the active UI language
 * with synchronous cache lookup on render (zero flicker) and automatic cancellation.
 * If an official human-written text is provided (e.g. from TMDB ro-RO), it is returned
 * immediately without calling machine translation.
 */
export function useTranslatedText(
  text: string | undefined,
  lang: AppLanguage,
  priority: 'high' | 'normal' = 'high',
  officialText?: string
): string {
  const source = text || '';
  const official = officialText?.trim() || '';
  const syncHit = official ? official : getCachedTranslation(source, lang);

  const [resolved, setResolved] = useState<{
    source: string;
    lang: AppLanguage;
    translated: string;
  } | null>(null);

  useEffect(() => {
    if (!source || syncHit !== null) return;
    let active = true;
    const controller = new AbortController();

    translateText(source, lang, { priority, signal: controller.signal }).then((translated) => {
      if (!active || controller.signal.aborted) return;
      setResolved({ source, lang, translated });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [source, lang, priority, syncHit]);

  if (syncHit !== null) return syncHit;
  if (resolved && resolved.source === source && resolved.lang === lang) {
    return resolved.translated;
  }
  return source;
}

/**
 * Translates a list of TMDB/Jellyfin tags into the active UI language using
 * instant dictionary/cache hits and a single batched request for any remaining tags.
 */
export function useTranslatedTags(
  tags: string[],
  lang: AppLanguage
): Record<string, string> {
  const signature = `${lang}::${tags.join('\u0001')}`;

  const { syncMap, hasUncached } = useMemo(() => {
    const map: Record<string, string> = {};
    let missing = false;
    for (const tag of tags) {
      const hit = getCachedTagTranslation(tag, lang);
      if (hit !== null) {
        map[tag] = hit;
      } else {
        map[tag] = tag;
        missing = true;
      }
    }
    return { syncMap: map, hasUncached: missing };
  }, [signature]);

  const [asyncResult, setAsyncResult] = useState<{
    signature: string;
    map: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    if (!hasUncached || tags.length === 0) return;
    let active = true;
    const controller = new AbortController();

    translateTagsBatch(tags, lang, controller.signal).then((map) => {
      if (!active || controller.signal.aborted) return;
      setAsyncResult({ signature, map });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [signature, hasUncached]);

  if (asyncResult && asyncResult.signature === signature) {
    return asyncResult.map;
  }
  return syncMap;
}

interface TranslatedOverviewProps {
  text: string | undefined;
  lang: AppLanguage;
  priority?: 'high' | 'normal';
}

/**
 * Isolated memoized text node for lists (e.g. series episodes) so each description
 * translates independently without triggering re-renders on sibling rows.
 */
export const TranslatedOverview: React.FC<TranslatedOverviewProps> = React.memo(
  ({ text, lang, priority = 'normal' }) => {
    const translated = useTranslatedText(text, lang, priority);
    return <>{formatOverviewText(translated, lang)}</>;
  }
);
TranslatedOverview.displayName = 'TranslatedOverview';
