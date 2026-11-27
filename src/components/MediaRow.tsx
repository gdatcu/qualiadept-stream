import React, { useRef } from 'react';
import { Check, ChevronLeft, ChevronRight, Heart, Layers, Play, Star, X } from 'lucide-react';
import type { MediaItem } from '../types/media';
import { isTizenTv } from '../utils/tvNavigation';

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  showProgress?: boolean;
  onSelect: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  onToggleFavorite?: (item: MediaItem) => void;
  onTogglePlayed?: (item: MediaItem) => void;
  onRemoveContinueWatching?: (item: MediaItem) => void;
}

export const MediaRow: React.FC<MediaRowProps> = React.memo(({
  title,
  items,
  showProgress = false,
  onSelect,
  onPlay,
  onToggleFavorite,
  onTogglePlayed,
  onRemoveContinueWatching,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const isTv = isTizenTv();

  if (items.length === 0) return null;

  const scroll = (dir: 'left' | 'right') => {
    if (!rowRef.current) return;
    const amount = rowRef.current.clientWidth * 0.75;
    rowRef.current.scrollBy({
      left: dir === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  return (
    <section className={`tv-row-section relative group/row ${isTv ? 'mb-7' : 'mb-10'}`}>
      <div
        className={`flex items-center justify-between ${
          isTv ? 'mb-1 px-[3.8vw]' : 'mb-1.5 px-4 sm:px-8'
        }`}
      >
        <h2
          className={`tracking-tight text-white ${
            isTv ? 'text-[1.35rem] font-extrabold' : 'text-lg sm:text-xl font-bold'
          }`}
        >
          {title}
        </h2>
        {!isTv && (
          <div className="hidden sm:flex items-center gap-1.5 opacity-0 transition group-hover/row:opacity-100">
            <button
              onClick={() => scroll('left')}
              aria-label="Scroll left"
              className="rounded-lg border border-white/10 bg-surface/90 p-1.5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => scroll('right')}
              aria-label="Scroll right"
              className="rounded-lg border border-white/10 bg-surface/90 p-1.5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={rowRef}
        data-tv-row="media-row"
        className={`no-scrollbar flex overflow-x-auto ${
          isTv ? 'gap-6 px-[3.8vw] py-4' : 'gap-4 px-4 sm:px-8 py-2'
        }`}
      >
        {items.map((item) => {
          const isLandscape = showProgress || item.type === 'Episode';
          const thumbSrc = isLandscape ? item.backdropUrl || item.posterUrl : item.posterUrl;
          return (
            <div
              key={item.id}
              data-tv-card="true"
              role="button"
              tabIndex={0}
              onClick={() => onSelect(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(item);
                }
              }}
              className={`group/card relative flex-shrink-0 cursor-pointer focus:outline-none ${
                isTv
                  ? isLandscape
                    ? 'w-[17.5rem]'
                    : 'w-[10.5rem]'
                  : `overflow-hidden border border-white/10 bg-surface transition-all duration-300 hover:scale-[1.04] hover:border-violet-400/50 hover:shadow-xl hover:shadow-violet-900/20 focus:scale-[1.05] focus:ring-4 focus:ring-violet-400 focus:border-violet-400 ${
                      isLandscape ? 'w-64 sm:w-72 rounded-xl' : 'w-40 sm:w-48 rounded-xl'
                    }`
              }`}
            >
              <div
                className={`tv-card-frame relative w-full overflow-hidden bg-gradient-to-br from-[#161a2e] via-surface-elevated to-obsidian ${
                  isLandscape ? 'aspect-video' : 'aspect-[2/3]'
                } ${isTv ? 'rounded-2xl border border-white/15' : ''}`}
              >
                {thumbSrc ? (
                  <img
                    src={thumbSrc}
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                    className={
                      isTv
                        ? 'h-full w-full object-cover'
                        : 'h-full w-full object-cover transition duration-500 group-hover/card:scale-105'
                    }
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-4 text-center">
                    <span className="text-sm font-bold text-zinc-300 line-clamp-3">
                      {item.name}
                    </span>
                  </div>
                )}

                {/* Subtle bottom gradient on landscape cards for episode badge & progress contrast */}
                {isTv && isLandscape && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
                )}

                {/* Hover Play Overlay (desktop mouse only, skipped by TV D-pad via tabIndex=-1) */}
                {!isTv && (
                  <div className="absolute inset-0 flex items-center justify-center bg-obsidian/50 opacity-0 transition group-hover/card:opacity-100">
                    <button
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlay(item);
                      }}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-obsidian shadow-lg transition hover:scale-110"
                    >
                      <Play className="h-5 w-5 fill-obsidian ml-0.5" />
                    </button>
                  </div>
                )}

                {/* Quick Action Pill Strip on Hover (Desktop/Touch — never disrupts TV D-pad) */}
                {!isTv && (onRemoveContinueWatching || onToggleFavorite || onTogglePlayed) && (
                  <div className="absolute top-2 left-2 z-10 flex items-center gap-1 opacity-0 transition group-hover/card:opacity-100">
                    {onRemoveContinueWatching && (
                      <button
                        tabIndex={-1}
                        title="Remove from Continue Watching"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveContinueWatching(item);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-obsidian/85 text-zinc-200 backdrop-blur-md transition hover:bg-red-500/85 hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {onTogglePlayed && item.type !== 'BoxSet' && (
                      <button
                        tabIndex={-1}
                        title={item.isPlayed ? 'Mark as unplayed' : 'Mark as played'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePlayed(item);
                        }}
                        className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition ${
                          item.isPlayed
                            ? 'bg-emerald-500/90 text-white'
                            : 'bg-obsidian/85 text-zinc-200 hover:bg-emerald-500/80 hover:text-white'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {onToggleFavorite && item.type !== 'BoxSet' && (
                      <button
                        tabIndex={-1}
                        title={item.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(item);
                        }}
                        className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition ${
                          item.isFavorite
                            ? 'bg-rose-500/90 text-white'
                            : 'bg-obsidian/85 text-zinc-200 hover:bg-rose-500/80 hover:text-white'
                        }`}
                      >
                        <Heart
                          className={`h-3.5 w-3.5 ${item.isFavorite ? 'fill-white' : ''}`}
                        />
                      </button>
                    )}
                  </div>
                )}

                {/* Watched indicator */}
                {item.isPlayed && !showProgress && (
                  <div
                    className={`pointer-events-none absolute top-2.5 left-2.5 flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ${
                      isTv
                        ? 'h-7 w-7'
                        : 'h-6 w-6 group-hover/card:opacity-0 transition'
                    }`}
                  >
                    <Check className={isTv ? 'h-4 w-4 stroke-[3]' : 'h-3.5 w-3.5'} />
                  </div>
                )}

                {/* Rating badge */}
                {item.rating && !isLandscape && (
                  <div
                    className={`absolute top-2.5 right-2.5 flex items-center gap-1 rounded-lg font-extrabold text-amber-300 ${
                      isTv
                        ? 'bg-black/85 border border-white/10 px-2 py-0.5 text-xs'
                        : 'bg-obsidian/85 px-2 py-0.5 text-[11px] font-bold backdrop-blur-md'
                    }`}
                  >
                    <Star className={isTv ? 'h-3.5 w-3.5 fill-amber-300' : 'h-3 w-3 fill-amber-300'} />
                    {item.rating}
                  </div>
                )}

                {/* Episode badge inside landscape frame on TV */}
                {isTv && item.type === 'Episode' && item.seasonNumber != null && item.episodeNumber != null && (
                  <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/85 border border-white/15 px-2 py-0.5 text-xs font-extrabold tracking-wide text-white">
                    S{String(item.seasonNumber).padStart(2, '0')} · E{String(item.episodeNumber).padStart(2, '0')}
                  </div>
                )}

                {/* Collection / BoxSet badge */}
                {item.type === 'BoxSet' && (
                  <div
                    className={`absolute bottom-2.5 left-2.5 flex items-center gap-1 rounded-md font-extrabold uppercase tracking-wide text-white shadow ${
                      isTv
                        ? 'bg-[#121626]/95 border border-white/20 px-2.5 py-1 text-xs'
                        : 'bg-violet-600/90 px-2 py-0.5 text-[10px]'
                    }`}
                  >
                    <Layers className={isTv ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
                    Collection
                  </div>
                )}

                {/* Continue Watching progress bar */}
                {showProgress && (item.playedPercentage ?? 0) > 0 && (
                  <div
                    className={`absolute bottom-0 left-0 right-0 bg-white/30 ${
                      isTv ? 'h-2' : 'h-1'
                    }`}
                  >
                    <div
                      className="h-full bg-white"
                      style={{ width: `${Math.min(100, item.playedPercentage || 0)}%` }}
                    />
                  </div>
                )}
              </div>

              <div className={isTv ? 'pt-2.5 px-0.5' : 'p-3'}>
                <h3
                  className={
                    isTv
                      ? 'tv-card-title truncate text-[0.92rem] font-bold text-zinc-200 transition-colors'
                      : 'truncate text-sm font-bold text-white'
                  }
                >
                  {item.type === 'Episode' && item.seriesName ? item.seriesName : item.name}
                </h3>
                <div
                  className={
                    isTv
                      ? 'mt-0.5 flex items-center gap-2 text-[0.78rem] font-medium text-zinc-400'
                      : 'mt-1 flex items-center gap-2 text-xs text-zinc-400'
                  }
                >
                  {item.type === 'Episode' && (
                    <span className="truncate text-zinc-300 font-semibold">
                      {!isTv && item.seasonNumber && item.episodeNumber
                        ? `S${item.seasonNumber} · E${item.episodeNumber} · `
                        : ''}
                      {item.name}
                    </span>
                  )}
                  {item.type !== 'Episode' && item.year && <span>{item.year}</span>}
                  {item.type === 'Series' && (
                    <span
                      className={
                        isTv
                          ? 'rounded bg-white/10 px-1.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-wider text-zinc-300'
                          : 'rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-zinc-200'
                      }
                    >
                      Series
                    </span>
                  )}
                  {item.runtimeMinutes && !isLandscape && (
                    <span>
                      {Math.floor(item.runtimeMinutes / 60) > 0
                        ? `${Math.floor(item.runtimeMinutes / 60)}h ${item.runtimeMinutes % 60}m`
                        : `${item.runtimeMinutes}m`}
                    </span>
                  )}
                  {showProgress && item.playedPercentage && (
                    <span className="font-semibold text-zinc-300">
                      {Math.round(item.playedPercentage)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});
