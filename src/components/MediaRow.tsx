import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Star } from 'lucide-react';
import type { MediaItem } from '../types/media';

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  showProgress?: boolean;
  onSelect: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
}

export const MediaRow: React.FC<MediaRowProps> = ({
  title,
  items,
  showProgress = false,
  onSelect,
  onPlay,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);

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
    <section className="relative group/row mb-10">
      <div className="mb-3.5 flex items-center justify-between px-4 sm:px-8">
        <h2 className="text-lg font-bold tracking-tight text-white sm:text-xl">
          {title}
        </h2>
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
      </div>

      <div
        ref={rowRef}
        className="no-scrollbar flex gap-4 overflow-x-auto px-4 pb-2 sm:px-8"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(item);
              }
            }}
            className={`group/card relative flex-shrink-0 cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-surface transition-all duration-300 hover:scale-[1.04] hover:border-violet-400/50 hover:shadow-xl hover:shadow-violet-900/20 focus:outline-none focus:scale-[1.05] focus:ring-4 focus:ring-violet-400 focus:border-violet-400 ${
              showProgress ? 'w-64 sm:w-72' : 'w-40 sm:w-48'
            }`}
          >
            <div
              className={`relative w-full overflow-hidden bg-gradient-to-br from-violet-950/70 via-surface-elevated to-obsidian ${
                showProgress ? 'aspect-video' : 'aspect-[2/3]'
              }`}
            >
              {(showProgress ? item.backdropUrl : item.posterUrl) ? (
                <img
                  src={showProgress ? item.backdropUrl : item.posterUrl}
                  alt={item.name}
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                  className="h-full w-full object-cover transition duration-500 group-hover/card:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-4 text-center">
                  <span className="text-sm font-bold text-zinc-400 line-clamp-3">
                    {item.name}
                  </span>
                </div>
              )}

              {/* Hover Play Overlay */}
              <div className="absolute inset-0 flex items-center justify-center bg-obsidian/50 opacity-0 transition group-hover/card:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(item);
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-obsidian shadow-lg transition hover:scale-110"
                >
                  <Play className="h-5 w-5 fill-obsidian ml-0.5" />
                </button>
              </div>

              {/* Rating badge */}
              {item.rating && !showProgress && (
                <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-obsidian/80 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300 backdrop-blur-md">
                  <Star className="h-3 w-3 fill-amber-300" />
                  {item.rating}
                </div>
              )}

              {/* Continue Watching progress bar */}
              {showProgress && (item.playedPercentage ?? 0) > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                    style={{ width: `${Math.min(100, item.playedPercentage || 0)}%` }}
                  />
                </div>
              )}
            </div>

            <div className="p-3">
              <h3 className="truncate text-sm font-semibold text-white">
                {item.name}
              </h3>
              <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                {item.year && <span>{item.year}</span>}
                {item.type === 'Series' && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-200">
                    SERIES
                  </span>
                )}
                {item.runtimeMinutes && !showProgress && (
                  <span>{item.runtimeMinutes}m</span>
                )}
                {showProgress && item.playedPercentage && (
                  <span className="text-violet-300">
                    {Math.round(item.playedPercentage)}% watched
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
