import React, { useEffect, useState } from 'react';
import { formatOverviewText, type AppLanguage } from '../i18n';
import { getCachedTranslation, translateText } from '../services/translate';

/**
 * Translates dynamic media text (overview / tagline) into the active UI language
 * with synchronous cache lookup on render (zero flicker) and automatic cancellation.
 */
export function useTranslatedText(
  text: string | undefined,
  lang: AppLanguage,
  priority: 'high' | 'normal' = 'high'
): string {
  const source = text || '';
  const syncHit = getCachedTranslation(source, lang);

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
