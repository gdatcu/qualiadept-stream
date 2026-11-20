import React, { useEffect, useState } from 'react';
import { Check, Info, Play, Plus, Star } from 'lucide-react';
import type { MediaItem } from '../types/media';

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

  useEffect(() => {
    setImgFailed(false);
  }, [item.id]);

  return (
    <section className="relative h-[78vh] min-h-[540px] max-h-[820px] w-full overflow-hidden bg-gradient-to-br from-violet-950/70 via-surface to-obsidian">
      {/* Backdrop Image */}
      {item.backdropUrl && !imgFailed && (
        <img
          src={item.backdropUrl}
          alt={item.name}
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover object-center scale-[1.01]"
        />
      )}

      {/* HBO Max / Netflix cinematic vignettes */}
      <div className="absolute inset-0 bg-gradient-to-t from-obsidian via-obsidian/55 to-obsidian/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-obsidian via-obsidian/70 to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 mx-auto flex max-w-[1600px] flex-col justify-end px-4 pb-16 sm:px-8 sm:pb-24">
        <div className="max-w-2xl animate-fade-in">
          <div className="mb-3 flex flex-wrap items-center gap-2.5 text-xs font-semibold">
            <span className="rounded-md bg-violet-600/90 px-2.5 py-1 uppercase tracking-wider text-white">
              {item.type === 'Series' ? 'Featured Series' : 'Featured Film'}
            </span>
            {item.rating && (
              <span className="flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-amber-300 backdrop-blur-md">
                <Star className="h-3.5 w-3.5 fill-amber-300" />
                {item.rating}
              </span>
            )}
            {item.year && <span className="text-zinc-300">{item.year}</span>}
            {item.officialRating && (
              <span className="rounded border border-white/25 px-1.5 py-0.5 text-[11px] text-zinc-200">
                {item.officialRating}
              </span>
            )}
            {item.runtimeMinutes && (
              <span className="text-zinc-300">
                {Math.floor(item.runtimeMinutes / 60) > 0
                  ? `${Math.floor(item.runtimeMinutes / 60)}h ${item.runtimeMinutes % 60}m`
                  : `${item.runtimeMinutes}m`}
              </span>
            )}
          </div>

          <h1 className="text-4xl font-black tracking-tight text-white drop-shadow-lg sm:text-6xl">
            {item.name}
          </h1>

          <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-zinc-200 sm:text-base">
            {item.overview}
          </p>

          {item.genres.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {item.genres.slice(0, 4).map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-zinc-200 backdrop-blur-sm"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              onClick={() => onPlay(item)}
              className="flex items-center gap-2.5 rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-obsidian shadow-xl transition hover:scale-[1.02] hover:bg-zinc-200"
            >
              <Play className="h-5 w-5 fill-obsidian" />
              {item.resumePositionSeconds ? 'Resume' : 'Play Now'}
            </button>

            <button
              onClick={() => onMoreInfo(item)}
              className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
            >
              <Info className="h-5 w-5" />
              More Info
            </button>

            <button
              onClick={() => onToggleFavorite(item)}
              title={item.isFavorite ? 'Remove from My List' : 'Add to My List'}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
            >
              {item.isFavorite ? (
                <Check className="h-5 w-5 text-violet-400" />
              ) : (
                <Plus className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
