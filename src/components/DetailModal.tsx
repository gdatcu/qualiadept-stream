import React, { useEffect, useState } from 'react';
import { Check, Play, Plus, Star, X } from 'lucide-react';
import { fetchEpisodes, fetchSeasons } from '../services/jellyfin';
import type { AuthSession, MediaItem, SeasonItem } from '../types/media';

interface DetailModalProps {
  session: AuthSession;
  item: MediaItem;
  onClose: () => void;
  onPlay: (item: MediaItem) => void;
  onToggleFavorite: (item: MediaItem) => void;
}

export const DetailModal: React.FC<DetailModalProps> = ({
  session,
  item,
  onClose,
  onPlay,
  onToggleFavorite,
}) => {
  const [seasons, setSeasons] = useState<SeasonItem[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [episodes, setEpisodes] = useState<MediaItem[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [item.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (item.type !== 'Series') return;
    let active = true;
    fetchSeasons(session, item.id).then((list) => {
      if (!active) return;
      setSeasons(list);
      if (list.length > 0) {
        setSelectedSeasonId(list[0].id);
      }
    });
    return () => {
      active = false;
    };
  }, [session, item]);

  useEffect(() => {
    if (item.type !== 'Series' || !selectedSeasonId) return;
    let active = true;
    setLoadingEpisodes(true);
    fetchEpisodes(session, item.id, selectedSeasonId)
      .then((eps) => {
        if (active) setEpisodes(eps);
      })
      .finally(() => {
        if (active) setLoadingEpisodes(false);
      });
    return () => {
      active = false;
    };
  }, [session, item, selectedSeasonId]);

  const handlePrimaryPlay = () => {
    if (item.type === 'Series' && episodes.length > 0) {
      onPlay(episodes[0]);
    } else {
      onPlay(item);
    }
  };

  return (
    <div
      data-tv-scope="modal"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative my-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-white/15 bg-surface shadow-2xl animate-fade-in"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-obsidian/80 text-white backdrop-blur-md transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Backdrop Header */}
        <div className="relative h-64 sm:h-80 w-full overflow-hidden bg-gradient-to-br from-violet-950/80 via-surface-elevated to-obsidian">
          {item.backdropUrl && !imgFailed && (
            <img
              src={item.backdropUrl}
              alt={item.name}
              onError={() => setImgFailed(true)}
              className="h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />

          <div className="absolute bottom-5 left-6 right-6">
            <h2 className="text-2xl sm:text-4xl font-black text-white drop-shadow">
              {item.name}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={handlePrimaryPlay}
                className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-obsidian transition hover:bg-zinc-200"
              >
                <Play className="h-4 w-4 fill-obsidian" />
                {item.type === 'Series'
                  ? 'Play Episode 1'
                  : item.resumePositionSeconds
                  ? 'Resume'
                  : 'Play'}
              </button>

              <button
                onClick={() => onToggleFavorite(item)}
                className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
              >
                {item.isFavorite ? (
                  <>
                    <Check className="h-4 w-4 text-violet-400" />
                    In My List
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    My List
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 pt-3">
          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-zinc-300">
            {item.rating && (
              <span className="flex items-center gap-1 text-amber-300">
                <Star className="h-3.5 w-3.5 fill-amber-300" />
                {item.rating}
              </span>
            )}
            {item.year && <span>{item.year}</span>}
            {item.officialRating && (
              <span className="rounded border border-white/20 px-1.5 py-0.5 text-[11px]">
                {item.officialRating}
              </span>
            )}
            {item.runtimeMinutes && <span>{item.runtimeMinutes} min</span>}
            {item.genres.map((g) => (
              <span
                key={g}
                className="rounded-full bg-white/10 px-2.5 py-0.5 text-zinc-300"
              >
                {g}
              </span>
            ))}
          </div>

          <p className="mt-4 text-sm leading-relaxed text-zinc-300">
            {item.overview}
          </p>

          {/* Episodes list for Series */}
          {item.type === 'Series' && (
            <div className="mt-6 border-t border-white/10 pt-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-bold text-white">Episodes</h3>
                {seasons.length > 1 && (
                  <select
                    value={selectedSeasonId}
                    onChange={(e) => setSelectedSeasonId(e.target.value)}
                    className="rounded-lg border border-white/15 bg-obsidian px-3 py-1.5 text-xs font-semibold text-white outline-none"
                  >
                    {seasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {loadingEpisodes ? (
                <p className="text-xs text-zinc-400">Loading episodes...</p>
              ) : (
                <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                  {episodes.map((ep) => (
                    <div
                      key={ep.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onPlay(ep)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onPlay(ep);
                        }
                      }}
                      className="group flex cursor-pointer items-center gap-4 rounded-xl border border-white/5 bg-obsidian/60 p-2.5 transition hover:border-violet-500/40 hover:bg-surface-elevated focus:outline-none focus:ring-4 focus:ring-violet-400"
                    >
                      <div className="relative h-20 w-36 flex-shrink-0 overflow-hidden rounded-lg bg-surface">
                        <img
                          src={ep.backdropUrl}
                          alt={ep.name}
                          className="h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                          <Play className="h-6 w-6 fill-white text-white" />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="truncate text-sm font-semibold text-white">
                            {ep.episodeNumber ? `${ep.episodeNumber}. ` : ''}
                            {ep.name}
                          </h4>
                          {ep.runtimeMinutes && (
                            <span className="text-xs text-zinc-400 flex-shrink-0">
                              {ep.runtimeMinutes}m
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-zinc-400">
                          {ep.overview}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
