import React, { useEffect, useState } from 'react';
import { Check, Info, Play, Plus, Star } from 'lucide-react';
import { formatOverviewText, translateGenre, useI18n } from '../i18n';
import type { MediaItem } from '../types/media';
import { isTizenTv } from '../utils/tvNavigation';
import { useTranslatedText } from './TranslatedOverview';

interface HeroBannerProps {
  item: MediaItem;
  onPlay: (item: MediaItem) => void;
  onMoreInfo: (item: MediaItem) => void;
  onToggleFavorite: (item: MediaItem) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  item,
  onPlay,
  onMoreInfo,
  onToggleFavorite,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const isTv = isTizenTv();
  const { lang, t } = useI18n();
  const translatedOverview = useTranslatedText(item.overview, lang, 'high');

  useEffect(() => {
    setImgFailed(false);
  }, [item.id]);

  return (
    <section
      data-tv-hero="true"
      className={`relative w-full overflow-hidden bg-gradient-to-br from-[#121629] via-surface to-obsidian ${
        isTv
          ? 'h-[66vh] min-h-[460px]'
          : 'h-[78vh] min-h-[540px] max-h-[820px]'
      }`}
    >
      {/* Backdrop Image */}
      {item.backdropUrl && !imgFailed && (
        <img
          src={item.backdropUrl}
          alt={item.name}
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover object-center"
        />
      )}

      {/* Netflix / Apple TV+ multi-stop cinema vignettes */}
      <div
        className={
          isTv
            ? 'absolute inset-0 bg-gradient-to-t from-obsidian via-obsidian/45 to-obsidian/15'
            : 'absolute inset-0 bg-gradient-to-t from-obsidian via-obsidian/55 to-obsidian/20'
        }
      />
      <div
        className={
          isTv
            ? 'absolute inset-0 bg-gradient-to-r from-obsidian via-obsidian/80 to-transparent'
            : 'absolute inset-0 bg-gradient-to-r from-obsidian via-obsidian/70 to-transparent'
        }
      />

      {/* Content */}
      <div
        className={
          isTv
            ? 'absolute inset-0 flex w-full flex-col justify-end px-[3.8vw] pb-14'
            : 'absolute inset-0 mx-auto flex max-w-[1600px] flex-col justify-end px-4 pb-16 sm:px-8 sm:pb-24'
        }
      >
        <div className={`${isTv ? 'max-w-3xl' : 'max-w-2xl'} animate-fade-in`}>
          <div
            className={`mb-3 flex flex-wrap items-center font-bold ${
              isTv ? 'gap-3 text-sm' : 'gap-2.5 text-xs font-semibold'
            }`}
          >
            <span
              className={
                isTv
                  ? 'rounded-md border border-white/25 bg-[#121626]/95 px-3 py-1 text-xs font-extrabold uppercase tracking-widest text-white'
                  : 'rounded-md bg-violet-600/90 px-2.5 py-1 uppercase tracking-wider text-white'
              }
            >
              {item.type === 'Series' ? t.featuredSeries : t.featuredFilm}
            </span>
            {item.rating && (
              <span
                className={
                  isTv
                    ? 'flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-[#121626]/95 px-2.5 py-1 text-amber-300'
                    : 'flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-amber-300 backdrop-blur-md'
                }
              >
                <Star className={isTv ? 'h-4 w-4 fill-amber-300' : 'h-3.5 w-3.5 fill-amber-300'} />
                {item.rating}
              </span>
            )}
            {item.year && <span className="text-zinc-200">{item.year}</span>}
            {item.officialRating && (
              <span
                className={
                  isTv
                    ? 'rounded border border-white/35 bg-black/50 px-2 py-0.5 text-xs font-extrabold text-zinc-100'
                    : 'rounded border border-white/25 px-1.5 py-0.5 text-[11px] text-zinc-200'
                }
              >
                {item.officialRating}
              </span>
            )}
            {item.runtimeMinutes && (
              <span className="text-zinc-200">
                {Math.floor(item.runtimeMinutes / 60) > 0
                  ? `${Math.floor(item.runtimeMinutes / 60)}h ${item.runtimeMinutes % 60}m`
                  : `${item.runtimeMinutes}m`}
              </span>
            )}
            {isTv && item.genres.length > 0 && (
              <span className="text-zinc-300 font-semibold">
                • {item.genres.slice(0, 3).map((g) => translateGenre(g, lang)).join('  •  ')}
              </span>
            )}
          </div>

          <h1
            className={
              isTv
                ? 'text-5xl font-black leading-[1.06] tracking-tight text-white drop-shadow-[0_6px_24px_rgba(0,0,0,0.9)]'
                : 'text-4xl font-black tracking-tight text-white drop-shadow-lg sm:text-6xl'
            }
          >
            {item.name}
          </h1>

          <p
            className={
              isTv
                ? 'mt-3.5 max-w-2xl line-clamp-2 text-base leading-relaxed text-zinc-200 drop-shadow'
                : 'mt-4 line-clamp-3 text-sm leading-relaxed text-zinc-200 sm:text-base'
            }
          >
            {formatOverviewText(translatedOverview, lang)}
          </p>

          {!isTv && item.genres.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {item.genres.slice(0, 4).map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-zinc-200 backdrop-blur-sm"
                >
                  {translateGenre(g, lang)}
                </span>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div
            data-tv-row="hero-actions"
            className={`flex flex-wrap items-center ${isTv ? 'mt-6 gap-4' : 'mt-7 gap-3.5'}`}
          >
            <button
              data-tv-default-focus="true"
              data-tv-pill={isTv ? 'true' : undefined}
              onClick={() => onPlay(item)}
              className={
                isTv
                  ? 'flex items-center gap-3 rounded-full bg-white px-8 py-3.5 text-base font-extrabold text-obsidian shadow-2xl transition'
                  : 'flex items-center gap-2.5 rounded-full bg-white px-7 py-3.5 text-sm font-extrabold text-obsidian shadow-xl transition hover:scale-[1.02] hover:bg-zinc-200'
              }
            >
              <Play className={isTv ? 'h-6 w-6 fill-obsidian' : 'h-5 w-5 fill-obsidian'} />
              <span>{item.resumePositionSeconds ? t.resume : t.playNow}</span>
            </button>

            <button
              data-tv-pill={isTv ? 'true' : undefined}
              onClick={() => onMoreInfo(item)}
              className={
                isTv
                  ? 'flex items-center gap-2.5 rounded-full border border-white/25 bg-[#15192b]/95 px-7 py-3.5 text-base font-bold text-white shadow-xl transition'
                  : 'flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-6 py-3.5 text-sm font-bold text-white backdrop-blur-md transition hover:bg-white/25'
              }
            >
              <Info className={isTv ? 'h-6 w-6' : 'h-5 w-5'} />
              <span>{t.moreInfo}</span>
            </button>

            <button
              data-tv-pill={isTv ? 'true' : undefined}
              onClick={() => onToggleFavorite(item)}
              title={item.isFavorite ? t.removeFromMyList : t.addToMyList}
              className={
                isTv
                  ? 'flex items-center gap-2.5 rounded-full border border-white/25 bg-[#15192b]/95 px-6 py-3.5 text-base font-bold text-white shadow-xl transition'
                  : 'flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white backdrop-blur-md transition hover:bg-white/25'
              }
            >
              {item.isFavorite ? (
                <Check className={isTv ? 'h-6 w-6 text-emerald-400' : 'h-5 w-5 text-violet-300'} />
              ) : (
                <Plus className={isTv ? 'h-6 w-6' : 'h-5 w-5'} />
              )}
              {isTv && <span>{item.isFavorite ? t.inMyList : t.navMyList}</span>}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
