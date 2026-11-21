import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  HardDrive,
  Play,
  Plus,
  Smartphone,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  fetchEpisodes,
  fetchSeasons,
  prefetchPlaybackInfo,
  type DownloadPresetId,
} from '../services/jellyfin';
import {
  cancelOfflineDownload,
  deleteOfflineDownload,
  DOWNLOAD_PRESETS,
  estimateDownloadSizeLabel,
  formatBytes,
  getActiveDownload,
  getOfflineRecord,
  saveToDeviceFile,
  startOfflineDownload,
  subscribeOfflineDownloads,
  supportsInAppOfflineStorage,
} from '../services/offlineDownloads';
import type { AuthSession, MediaItem, SeasonItem } from '../types/media';
import { getRecommendedQuality } from '../utils/network';

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

  // Offline download picker state
  const [downloadTarget, setDownloadTarget] = useState<MediaItem | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<DownloadPresetId>('standard');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [savingToDevice, setSavingToDevice] = useState(false);
  const [, setDownloadTick] = useState(0);

  useEffect(() => {
    return subscribeOfflineDownloads(() => setDownloadTick((t) => t + 1));
  }, []);

  useEffect(() => {
    setImgFailed(false);
    setDownloadTarget(null);
    setDownloadError(null);
  }, [item.id]);

  // Pre-warm PlaybackInfo + Direct Play header while user reads details (Netflix-instant Play)
  useEffect(() => {
    if (item.type !== 'Series') {
      prefetchPlaybackInfo(session, item, getRecommendedQuality());
    }
  }, [session, item]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (downloadTarget) setDownloadTarget(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, downloadTarget]);

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
        if (active) {
          setEpisodes(eps);
          if (eps.length > 0) {
            prefetchPlaybackInfo(session, eps[0], getRecommendedQuality());
          }
        }
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

  const handleStartInAppDownload = async () => {
    if (!downloadTarget) return;
    const target = downloadTarget;
    setDownloadError(null);
    setDownloadTarget(null);
    try {
      await startOfflineDownload(session, target, selectedPreset);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleSaveToDevice = async () => {
    if (!downloadTarget) return;
    setSavingToDevice(true);
    setDownloadError(null);
    try {
      await saveToDeviceFile(session, downloadTarget, selectedPreset);
      setDownloadTarget(null);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Could not start device download');
    } finally {
      setSavingToDevice(false);
    }
  };

  const primaryOfflineRec = item.type !== 'Series' ? getOfflineRecord(item.id) : null;
  const primaryActiveDl = item.type !== 'Series' ? getActiveDownload(item.id) : null;
  const canStoreInApp = supportsInAppOfflineStorage();

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
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                onClick={handlePrimaryPlay}
                className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-obsidian transition hover:bg-zinc-200"
              >
                <Play className="h-4 w-4 fill-obsidian" />
                {primaryOfflineRec
                  ? 'Play Offline'
                  : item.type === 'Series'
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

              {/* Offline Download Button for Movies / Episodes */}
              {item.type !== 'Series' && !session.isDemo && (
                <>
                  {primaryActiveDl ? (
                    <div className="flex items-center gap-2 rounded-xl border border-violet-400/40 bg-violet-600/25 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-md">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-300 border-t-transparent" />
                      <span>
                        {primaryActiveDl.status === 'preparing'
                          ? 'Preparing...'
                          : `${primaryActiveDl.percent}% · ${formatBytes(primaryActiveDl.bytesDownloaded)}`}
                      </span>
                      <button
                        onClick={() => cancelOfflineDownload(item.id)}
                        title="Cancel download"
                        className="ml-1 rounded p-0.5 text-zinc-200 hover:bg-white/15"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : primaryOfflineRec ? (
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3.5 py-2.5 text-xs font-bold text-emerald-300 backdrop-blur-md">
                        <CheckCircle2 className="h-4 w-4" />
                        {primaryOfflineRec.qualityLabel} · {formatBytes(primaryOfflineRec.sizeBytes)}
                      </span>
                      <button
                        onClick={() => deleteOfflineDownload(item.id)}
                        title="Remove offline copy"
                        className="rounded-xl border border-white/15 bg-white/10 p-2.5 text-zinc-300 transition hover:bg-red-500/20 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setDownloadError(null);
                        setSelectedPreset('standard');
                        setDownloadTarget(item);
                      }}
                      className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
                    >
                      <Download className="h-4 w-4 text-violet-300" />
                      Download
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 pt-3">
          {/* Download Error Banner */}
          {downloadError && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/15 px-3.5 py-2.5 text-xs text-red-200">
              <span>{downloadError}</span>
              <button onClick={() => setDownloadError(null)} className="p-0.5 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Inline Netflix-Style Offline Download Quality Picker */}
          {downloadTarget && (
            <div className="mb-5 rounded-2xl border border-violet-500/35 bg-obsidian/90 p-4 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Download className="h-4 w-4 text-violet-400" />
                    Download for Offline · {downloadTarget.name}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Pick a compact mobile size (~1–1.5 GB) instead of storing a 10+ GB file.
                  </p>
                </div>
                <button
                  onClick={() => setDownloadTarget(null)}
                  className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {DOWNLOAD_PRESETS.map((preset) => {
                  const active = selectedPreset === preset.id;
                  const estSize = estimateDownloadSizeLabel(downloadTarget, preset.id);
                  return (
                    <button
                      key={preset.id}
                      onClick={() => setSelectedPreset(preset.id)}
                      className={`flex items-start justify-between gap-2 rounded-xl border p-3 text-left transition ${
                        active
                          ? 'border-violet-400 bg-violet-600/25 text-white'
                          : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          <span>{preset.label}</span>
                          {preset.recommended && (
                            <span className="rounded bg-violet-500/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-200">
                              Best
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-zinc-400">{preset.description}</p>
                      </div>
                      <span className="flex-shrink-0 rounded-md bg-black/40 px-2 py-0.5 font-mono text-[11px] font-semibold text-violet-300">
                        {estSize}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                {canStoreInApp && (
                  <button
                    onClick={handleStartInAppDownload}
                    className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg transition hover:bg-violet-500"
                  >
                    <HardDrive className="h-4 w-4" />
                    Save Inside App (Watch Offline)
                  </button>
                )}
                <button
                  onClick={handleSaveToDevice}
                  disabled={savingToDevice}
                  className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
                >
                  <Smartphone className="h-4 w-4" />
                  {savingToDevice ? 'Preparing...' : 'Save .mp4 to Phone'}
                </button>
              </div>
            </div>
          )}

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
                  {episodes.map((ep) => {
                    const epOffline = getOfflineRecord(ep.id);
                    const epActive = getActiveDownload(ep.id);
                    return (
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
                        className="group flex cursor-pointer items-center gap-3 sm:gap-4 rounded-xl border border-white/5 bg-obsidian/60 p-2.5 transition hover:border-violet-500/40 hover:bg-surface-elevated focus:outline-none focus:ring-4 focus:ring-violet-400"
                      >
                        <div className="relative h-16 w-28 sm:h-20 sm:w-36 flex-shrink-0 overflow-hidden rounded-lg bg-surface">
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

                        {/* Per-Episode Offline Download Action */}
                        {!session.isDemo && (
                          <div
                            className="flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {epActive ? (
                              <button
                                onClick={() => cancelOfflineDownload(ep.id)}
                                title="Cancel download"
                                className="flex items-center gap-1 rounded-lg bg-violet-600/30 px-2 py-1.5 text-[11px] font-bold text-violet-200 hover:bg-violet-600/50"
                              >
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-300 border-t-transparent" />
                                <span>{epActive.percent}%</span>
                              </button>
                            ) : epOffline ? (
                              <button
                                onClick={() => deleteOfflineDownload(ep.id)}
                                title={`Downloaded (${epOffline.qualityLabel} · ${formatBytes(epOffline.sizeBytes)}). Tap to delete.`}
                                className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-red-500/20 hover:text-red-300"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setDownloadError(null);
                                  setSelectedPreset('standard');
                                  setDownloadTarget(ep);
                                }}
                                title="Download episode for offline viewing"
                                className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                              >
                                <Download className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
