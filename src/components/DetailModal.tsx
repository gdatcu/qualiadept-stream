import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Film,
  HardDrive,
  Heart,
  Play,
  RotateCcw,
  Smartphone,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  fetchCollectionItems,
  fetchEpisodes,
  fetchItemDetails,
  fetchPersonItems,
  fetchSeasons,
  fetchSimilarItems,
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
import type {
  AuthSession,
  MediaItem,
  MediaItemDetails,
  PersonCredit,
  PlaybackStartOptions,
  SeasonItem,
} from '../types/media';
import { getRecommendedQuality } from '../utils/network';
import { isTizenTv } from '../utils/tvNavigation';

interface DetailModalProps {
  session: AuthSession;
  item: MediaItem;
  onClose: () => void;
  onPlay: (item: MediaItem, options?: PlaybackStartOptions) => void;
  onSelectItem?: (item: MediaItem) => void;
  onToggleFavorite: (item: MediaItem) => void;
  onTogglePlayed?: (item: MediaItem) => void;
}

function formatRuntimeHours(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatChapterTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatEndsAt(runtimeMinutes?: number, resumeSeconds?: number): string | null {
  if (!runtimeMinutes || runtimeMinutes <= 0) return null;
  const totalSec = runtimeMinutes * 60;
  const remainingSec = Math.max(60, totalSec - (resumeSeconds || 0));
  const endDate = new Date(Date.now() + remainingSec * 1000);
  return endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function extractYouTubeEmbedUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    let videoId: string | null = null;
    if (host === 'youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] || null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.split('/')[2] || null;
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.split('/')[2] || null;
      }
    }
    if (!videoId) return null;
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1`;
  } catch {
    return null;
  }
}

export const DetailModal: React.FC<DetailModalProps> = ({
  session,
  item,
  onClose,
  onPlay,
  onSelectItem,
  onToggleFavorite,
  onTogglePlayed,
}) => {
  const isTv = isTizenTv();
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const chaptersRowRef = useRef<HTMLDivElement>(null);
  const castRowRef = useRef<HTMLDivElement>(null);
  const similarRowRef = useRef<HTMLDivElement>(null);

  const [seasons, setSeasons] = useState<SeasonItem[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [episodes, setEpisodes] = useState<MediaItem[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [collectionItems, setCollectionItems] = useState<MediaItem[]>([]);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  // Rich Jellyfin metadata (Cast & Crew, Specs, Tracks, Tagline, Tags, Trailers, Similar)
  const [details, setDetails] = useState<MediaItemDetails | null>(null);
  const [similarItems, setSimilarItems] = useState<MediaItem[]>([]);
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | null>(null);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number | null>(null);
  const [showAllTags, setShowAllTags] = useState(false);
  const [activeTrailerUrl, setActiveTrailerUrl] = useState<{ name: string; url: string } | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<PersonCredit | null>(null);
  const [personItems, setPersonItems] = useState<MediaItem[]>([]);
  const [loadingPersonItems, setLoadingPersonItems] = useState(false);
  const [, setClockTick] = useState(0);

  // Offline download picker state
  const [downloadTarget, setDownloadTarget] = useState<MediaItem | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<DownloadPresetId>('standard');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [savingToDevice, setSavingToDevice] = useState(false);
  const [, setDownloadTick] = useState(0);

  useEffect(() => {
    return subscribeOfflineDownloads(() => setDownloadTick((t) => t + 1));
  }, []);

  // Keep "Ends at" clock fresh every 30s
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setImgFailed(false);
    setPosterFailed(false);
    setDownloadTarget(null);
    setDownloadError(null);
    setDetails(null);
    setSimilarItems([]);
    setCollectionItems([]);
    setSelectedAudioIndex(null);
    setSelectedSubtitleIndex(null);
    setShowAllTags(false);
    setActiveTrailerUrl(null);
    setSelectedPerson(null);
    setPersonItems([]);
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    if (isTv) {
      window.requestAnimationFrame(() => playBtnRef.current?.focus());
    }
  }, [item.id, isTv]);

  // Fetch rich item details + similar titles in parallel
  useEffect(() => {
    let active = true;
    fetchItemDetails(session, item.id).then((d) => {
      if (!active || !d) return;
      setDetails(d);
      setSelectedAudioIndex(d.defaultAudioIndex);
      setSelectedSubtitleIndex(d.defaultSubtitleIndex);
    });
    if (item.type !== 'BoxSet') {
      fetchSimilarItems(session, item.id).then((list) => {
        if (active) setSimilarItems(list);
      });
    }
    return () => {
      active = false;
    };
  }, [session, item.id, item.type]);

  // Fetch Collection / BoxSet titles
  useEffect(() => {
    if (item.type !== 'BoxSet') return;
    let active = true;
    setLoadingCollection(true);
    fetchCollectionItems(session, item.id)
      .then((list) => {
        if (active) setCollectionItems(list);
      })
      .finally(() => {
        if (active) setLoadingCollection(false);
      });
    return () => {
      active = false;
    };
  }, [session, item.id, item.type]);

  // Pre-warm PlaybackInfo + Direct Play header while user reads details (Netflix-instant Play)
  useEffect(() => {
    if (item.type !== 'Series' && item.type !== 'BoxSet') {
      prefetchPlaybackInfo(session, item, getRecommendedQuality());
    }
  }, [session, item]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeTrailerUrl) setActiveTrailerUrl(null);
        else if (downloadTarget) setDownloadTarget(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, downloadTarget, activeTrailerUrl]);

  useEffect(() => {
    if (item.type !== 'Series') {
      setSeasons([]);
      setEpisodes([]);
      return;
    }
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

  const buildStartOptions = (
    startFromBeginning = false,
    startAtSeconds?: number
  ): PlaybackStartOptions => ({
    startFromBeginning,
    startAtSeconds,
    audioIndex: selectedAudioIndex,
    subtitleIndex: selectedSubtitleIndex,
  });

  const handlePrimaryPlay = (startFromBeginning = false) => {
    if (item.type === 'BoxSet') {
      const firstPlayable = collectionItems.find((c) => c.type !== 'BoxSet');
      if (firstPlayable) {
        if (firstPlayable.type === 'Series') onSelectItem?.(firstPlayable);
        else onPlay(firstPlayable, { startFromBeginning });
      }
      return;
    }
    if (item.type === 'Series' && episodes.length > 0) {
      onPlay(episodes[0], { startFromBeginning });
    } else {
      onPlay(item, buildStartOptions(startFromBeginning));
    }
  };

  const handlePersonClick = async (person: PersonCredit) => {
    if (selectedPerson?.id === person.id) {
      setSelectedPerson(null);
      setPersonItems([]);
      return;
    }
    setSelectedPerson(person);
    setLoadingPersonItems(true);
    const list = await fetchPersonItems(session, person.id);
    setPersonItems(list.filter((m) => m.id !== item.id));
    setLoadingPersonItems(false);
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

  const scrollRow = (ref: React.RefObject<HTMLDivElement | null>, dir: 'left' | 'right') => {
    const el = ref.current;
    if (!el) return;
    const offset = dir === 'left' ? -el.clientWidth * 0.78 : el.clientWidth * 0.78;
    el.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const primaryOfflineRec = item.type !== 'Series' ? getOfflineRecord(item.id) : null;
  const primaryActiveDl = item.type !== 'Series' ? getActiveDownload(item.id) : null;
  const canStoreInApp = supportsInAppOfflineStorage();

  const selectedSeason = seasons.find((s) => s.id === selectedSeasonId) || seasons[0] || null;
  const firstEpisode = episodes[0] || null;
  const seriesPlayLabel = firstEpisode?.resumePositionSeconds
    ? firstEpisode.episodeNumber != null
      ? `Resume Episode ${firstEpisode.episodeNumber}`
      : 'Resume'
    : firstEpisode?.episodeNumber != null
    ? `Play Episode ${firstEpisode.episodeNumber}`
    : 'Play';

  const runtimeLabel = formatRuntimeHours(item.runtimeMinutes);
  const endsAtLabel = formatEndsAt(item.runtimeMinutes, item.resumePositionSeconds);
  const isPlayed = item.isPlayed ?? details?.isPlayed ?? false;
  const primaryTrailer = details?.remoteTrailers[0] || null;
  const castPeople = useMemo(
    () => (details?.people || []).filter((p) => p.type === 'Actor' || p.avatarUrl).slice(0, 20),
    [details]
  );
  const hasMediaTrackBox = Boolean(
    item.type !== 'Series' &&
      details &&
      (details.videoSpec || details.audioTracks.length > 0 || details.subtitleTracks.length > 0)
  );
  const visibleTags = details
    ? showAllTags
      ? details.tags
      : details.tags.slice(0, 10)
    : [];

  return (
    <div
      ref={scrollContainerRef}
      data-tv-scope="modal"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/85 px-3 py-4 pt-[max(1rem,var(--app-safe-top))] pb-[max(1.5rem,var(--app-safe-bottom))] backdrop-blur-md sm:px-6 sm:py-8"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative my-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-white/15 bg-surface shadow-[0_24px_90px_rgba(0,0,0,0.85)] animate-fade-in"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-obsidian/80 text-white backdrop-blur-md transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Cinematic Backdrop + Floating Poster Header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-violet-950/80 via-surface-elevated to-obsidian">
          {/* Backdrop image */}
          <div className="relative h-56 sm:h-80 w-full overflow-hidden">
            {item.backdropUrl && !imgFailed && (
              <img
                src={item.backdropUrl}
                alt={item.name}
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover object-center scale-[1.01]"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/65 to-black/25" />
            <div className="absolute inset-0 bg-gradient-to-r from-surface/90 via-surface/35 to-transparent" />
          </div>

          {/* Floating Poster + Title + Metadata + Action Bar */}
          <div className="relative z-10 -mt-28 sm:-mt-40 px-5 pb-5 sm:px-8 sm:pb-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
              {/* Vertical Poster Card */}
              {item.posterUrl && !posterFailed && (
                <div className="hidden sm:block w-36 md:w-44 flex-shrink-0 overflow-hidden rounded-2xl border border-white/20 bg-obsidian shadow-[0_18px_45px_rgba(0,0,0,0.75)]">
                  <img
                    src={item.posterUrl}
                    alt={item.name}
                    onError={() => setPosterFailed(true)}
                    className="aspect-[2/3] w-full object-cover"
                  />
                </div>
              )}

              {/* Title, Metadata Row & Actions */}
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-white drop-shadow-md">
                  {item.name}
                </h2>

                {/* Metadata Strip (Year · Season · Runtime · Rating · Score · Ends at HH:MM) */}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm font-semibold text-zinc-200">
                  {item.year && <span>{item.year}</span>}
                  {item.type === 'Series' && seasons.length > 0 && (
                    <span className="rounded-md border border-violet-400/30 bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-200">
                      {seasons.length === 1
                        ? selectedSeason?.name || `Season ${selectedSeason?.seasonNumber ?? 1}`
                        : `${seasons.length} Seasons`}
                    </span>
                  )}
                  {runtimeLabel && <span className="text-zinc-300">{runtimeLabel}</span>}
                  {item.officialRating && (
                    <span className="rounded-md border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">
                      {item.officialRating}
                    </span>
                  )}
                  {item.rating && (
                    <span className="flex items-center gap-1 text-amber-300">
                      <Star className="h-3.5 w-3.5 fill-amber-300" />
                      {item.rating}
                    </span>
                  )}
                  {endsAtLabel && item.type !== 'Series' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-400/25 px-2.5 py-0.5 text-xs font-medium text-violet-200">
                      <Clock className="h-3 w-3 text-violet-300" />
                      Ends at {endsAtLabel}
                    </span>
                  )}
                  {isPlayed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                      <Check className="h-3 w-3" />
                      Watched
                    </span>
                  )}
                </div>

                {/* Primary & Secondary Action Bar */}
                <div data-tv-row="detail-actions" className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button
                    ref={playBtnRef}
                    data-tv-default-focus="true"
                    onClick={() => handlePrimaryPlay(false)}
                    className="flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-extrabold text-obsidian shadow-xl transition hover:bg-zinc-200 focus:outline-none focus:ring-4 focus:ring-violet-400"
                  >
                    <Play className="h-4 w-4 fill-obsidian" />
                    {primaryOfflineRec
                      ? 'Play Offline'
                      : item.type === 'Series'
                      ? seriesPlayLabel
                      : item.resumePositionSeconds
                      ? 'Resume'
                      : 'Play'}
                  </button>

                  {/* Play from beginning (when resumable) */}
                  {item.type !== 'Series' && Boolean(item.resumePositionSeconds) && (
                    <button
                      onClick={() => handlePrimaryPlay(true)}
                      title="Play from beginning"
                      className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white backdrop-blur-md transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-violet-400"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span className="hidden sm:inline">Restart</span>
                    </button>
                  )}

                  {/* Watch Trailer */}
                  {primaryTrailer && (
                    <button
                      onClick={() => setActiveTrailerUrl(primaryTrailer)}
                      title={`Watch ${primaryTrailer.name}`}
                      className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white backdrop-blur-md transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-violet-400"
                    >
                      <Film className="h-4 w-4 text-violet-300" />
                      Trailer
                    </button>
                  )}

                  {/* Mark Played / Unplayed */}
                  {onTogglePlayed && !session.isDemo && (
                    <button
                      onClick={() => onTogglePlayed(item)}
                      title={isPlayed ? 'Mark as unplayed' : 'Mark as played'}
                      className={`flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-bold backdrop-blur-md transition focus:outline-none focus:ring-4 focus:ring-violet-400 ${
                        isPlayed
                          ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                          : 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      <Check className="h-4 w-4" />
                      <span className="hidden md:inline">{isPlayed ? 'Played' : 'Mark Played'}</span>
                    </button>
                  )}

                  {/* Favorite Heart */}
                  <button
                    onClick={() => onToggleFavorite(item)}
                    title={item.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                    className={`flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-bold backdrop-blur-md transition focus:outline-none focus:ring-4 focus:ring-violet-400 ${
                      item.isFavorite
                        ? 'border-rose-400/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                        : 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    <Heart
                      className={`h-4 w-4 ${item.isFavorite ? 'fill-rose-400 text-rose-400' : ''}`}
                    />
                    <span className="hidden sm:inline">
                      {item.isFavorite ? 'Favorited' : 'Favorite'}
                    </span>
                  </button>

                  {/* Offline Download Button for Movies / Episodes (mobile/desktop only) */}
                  {!isTv && item.type !== 'Series' && !session.isDemo && (
                    <>
                      {primaryActiveDl ? (
                        <div className="flex items-center gap-2 rounded-full border border-violet-400/40 bg-violet-600/25 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-md">
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
                          <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/15 px-3.5 py-2 text-xs font-bold text-emerald-300 backdrop-blur-md">
                            <CheckCircle2 className="h-4 w-4" />
                            {primaryOfflineRec.qualityLabel} · {formatBytes(primaryOfflineRec.sizeBytes)}
                          </span>
                          <button
                            onClick={() => deleteOfflineDownload(item.id)}
                            title="Remove offline copy"
                            className="rounded-full border border-white/15 bg-white/10 p-2.5 text-zinc-300 transition hover:bg-red-500/20 hover:text-red-300"
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
                          className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
                        >
                          <Download className="h-4 w-4 text-violet-300" />
                          <span className="hidden sm:inline">Download</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Body */}
        <div className="space-y-6 px-5 pb-7 pt-2 sm:px-8 sm:pb-8">
          {/* Download Error Banner */}
          {downloadError && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/15 px-3.5 py-2.5 text-xs text-red-200">
              <span>{downloadError}</span>
              <button onClick={() => setDownloadError(null)} className="p-0.5 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Inline Netflix-Style Offline Download Quality Picker */}
          {downloadTarget && (
            <div className="rounded-2xl border border-violet-500/35 bg-obsidian/90 p-4 shadow-xl">
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

          {/* Media Specs & Pre-Play Audio / Subtitle Selectors */}
          {hasMediaTrackBox && details && (
            <div className="rounded-2xl border border-white/10 bg-obsidian/65 p-4 space-y-2.5">
              {details.videoSpec && (
                <div className="grid grid-cols-[84px_1fr] items-center gap-3 text-xs sm:text-sm">
                  <span className="font-semibold text-zinc-400">Video</span>
                  <span className="font-medium text-zinc-100">{details.videoSpec}</span>
                </div>
              )}

              {details.audioTracks.length > 0 && (
                <div className="grid grid-cols-[84px_1fr] items-center gap-3 text-xs sm:text-sm">
                  <span className="font-semibold text-zinc-400">Audio</span>
                  {details.audioTracks.length > 1 ? (
                    <select
                      aria-label="Audio track"
                      value={selectedAudioIndex ?? details.audioTracks[0].index}
                      onChange={(e) => setSelectedAudioIndex(Number(e.target.value))}
                      className="w-full max-w-md rounded-xl border border-white/15 bg-surface px-3 py-1.5 text-xs sm:text-sm font-medium text-white outline-none transition focus:border-violet-400"
                    >
                      {details.audioTracks.map((a) => (
                        <option key={a.index} value={a.index}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-medium text-zinc-100">
                      {details.audioTracks[0].label}
                    </span>
                  )}
                </div>
              )}

              {details.subtitleTracks.length > 0 && (
                <div className="grid grid-cols-[84px_1fr] items-center gap-3 text-xs sm:text-sm">
                  <span className="font-semibold text-zinc-400">Subtitles</span>
                  <select
                    aria-label="Subtitle track"
                    value={selectedSubtitleIndex === null ? 'off' : String(selectedSubtitleIndex)}
                    onChange={(e) =>
                      setSelectedSubtitleIndex(
                        e.target.value === 'off' ? null : Number(e.target.value)
                      )
                    }
                    className="w-full max-w-md rounded-xl border border-white/15 bg-surface px-3 py-1.5 text-xs sm:text-sm font-medium text-white outline-none transition focus:border-violet-400"
                  >
                    <option value="off">Off</option>
                    {details.subtitleTracks.map((s) => (
                      <option key={s.index} value={String(s.index)}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Tagline, Overview & Genres */}
          <div>
            {details?.tagline && (
              <p className="mb-2 text-base sm:text-lg font-semibold italic text-violet-200/95">
                “{details.tagline}”
              </p>
            )}
            <p className="text-sm sm:text-[15px] leading-relaxed text-zinc-300">
              {item.overview}
            </p>

            {item.genres.length > 0 && (
              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                {item.genres.map((g) => (
                  <span
                    key={g}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-200"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Credits (Director / Writer / Studio), External Links (IMDb / TMDB) & Tags */}
          {details &&
            (details.directors.length > 0 ||
              details.writers.length > 0 ||
              details.studios.length > 0 ||
              details.imdbId ||
              details.tmdbId ||
              details.tags.length > 0) && (
              <div className="space-y-3 border-t border-white/10 pt-4 text-xs sm:text-sm">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {details.directors.length > 0 && (
                    <div className="flex gap-2">
                      <span className="w-20 flex-shrink-0 font-semibold text-zinc-400">Director</span>
                      <span className="font-semibold text-white">{details.directors.join(', ')}</span>
                    </div>
                  )}
                  {details.writers.length > 0 && (
                    <div className="flex gap-2">
                      <span className="w-20 flex-shrink-0 font-semibold text-zinc-400">Writer</span>
                      <span className="font-semibold text-white">{details.writers.join(', ')}</span>
                    </div>
                  )}
                  {details.studios.length > 0 && (
                    <div className="flex gap-2">
                      <span className="w-20 flex-shrink-0 font-semibold text-zinc-400">Studio</span>
                      <span className="text-zinc-200">{details.studios.join(', ')}</span>
                    </div>
                  )}
                </div>

                {/* External Links: IMDb & TMDB */}
                {(details.imdbId || details.tmdbId) && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {details.imdbId && (
                      <a
                        href={`https://www.imdb.com/title/${encodeURIComponent(details.imdbId)}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-400/15 px-3 py-1 text-xs font-extrabold text-amber-300 transition hover:bg-amber-400/25"
                      >
                        IMDb
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {details.tmdbId && (
                      <a
                        href={`https://www.themoviedb.org/${item.type === 'Series' ? 'tv' : 'movie'}/${encodeURIComponent(details.tmdbId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/35 bg-sky-400/15 px-3 py-1 text-xs font-extrabold text-sky-300 transition hover:bg-sky-400/25"
                      >
                        TMDB
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}

                {/* Tags */}
                {details.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="mr-1 text-xs font-semibold text-zinc-500">Tags:</span>
                    {visibleTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300"
                      >
                        {tag}
                      </span>
                    ))}
                    {details.tags.length > 10 && (
                      <button
                        onClick={() => setShowAllTags(!showAllTags)}
                        className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-violet-300 hover:bg-white/10"
                      >
                        {showAllTags ? 'Show less' : `+${details.tags.length - 10} more`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

          {/* Episodes list for Series */}
          {item.type === 'Series' && (
            <div className="border-t border-white/10 pt-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-base font-bold text-white">Episodes</h3>
                  {seasons.length === 1 && selectedSeason && (
                    <span className="rounded-lg border border-violet-400/30 bg-violet-500/15 px-2.5 py-0.5 text-xs font-bold text-violet-200">
                      {selectedSeason.name}
                    </span>
                  )}
                </div>
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
                <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
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
                          {ep.isPlayed && (
                            <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/90 text-white shadow">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
                              {ep.episodeNumber != null && (
                                <span className="flex-shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-violet-300">
                                  E{String(ep.episodeNumber).padStart(2, '0')}
                                </span>
                              )}
                              <span className="truncate">{ep.name}</span>
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

                        {!isTv && !session.isDemo && (
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

          {/* Collection / BoxSet Titles Grid */}
          {item.type === 'BoxSet' && (
            <div className="border-t border-white/10 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base sm:text-lg font-bold text-white">
                  Titles in this Collection
                  {collectionItems.length > 0 && (
                    <span className="ml-2 text-xs font-semibold text-zinc-400">
                      ({collectionItems.length})
                    </span>
                  )}
                </h3>
              </div>
              {loadingCollection ? (
                <p className="text-xs text-zinc-400">Loading collection titles...</p>
              ) : collectionItems.length === 0 ? (
                <p className="text-xs text-zinc-400">No titles found in this collection.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4 md:grid-cols-5">
                  {collectionItems.map((colItem) => (
                    <button
                      key={colItem.id}
                      onClick={() => onSelectItem?.(colItem)}
                      className="group text-left focus:outline-none"
                    >
                      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/10 bg-obsidian transition group-hover:border-violet-400/50">
                        {colItem.posterUrl && (
                          <img
                            src={colItem.posterUrl}
                            alt={colItem.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                        )}
                        {colItem.isPlayed && (
                          <span className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/90 text-white shadow">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                        {colItem.rating && (
                          <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                            <Star className="h-2.5 w-2.5 fill-amber-300" />
                            {colItem.rating}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 truncate text-xs font-bold text-white group-hover:text-violet-300">
                        {colItem.name}
                      </p>
                      {colItem.year && (
                        <p className="text-[11px] text-zinc-400">{colItem.year}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Visual Chapters Carousel (click any scene to jump straight there) */}
          {item.type !== 'Series' && item.type !== 'BoxSet' && details && details.chapters.length > 1 && (
            <div className="border-t border-white/10 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base sm:text-lg font-bold text-white">
                  Chapters
                  <span className="ml-2 text-xs font-semibold text-zinc-400">
                    ({details.chapters.length})
                  </span>
                </h3>
                <div className="hidden sm:flex items-center gap-1.5">
                  <button
                    onClick={() => scrollRow(chaptersRowRef, 'left')}
                    aria-label="Scroll chapters left"
                    className="rounded-full border border-white/15 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/15 hover:text-white"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => scrollRow(chaptersRowRef, 'right')}
                    aria-label="Scroll chapters right"
                    className="rounded-full border border-white/15 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/15 hover:text-white"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div
                ref={chaptersRowRef}
                data-tv-row="detail-chapters"
                className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
              >
                {details.chapters.map((ch) => (
                  <button
                    key={`${ch.index}-${ch.startSeconds}`}
                    onClick={() => onPlay(item, buildStartOptions(false, ch.startSeconds))}
                    className="group w-44 sm:w-52 flex-shrink-0 text-left focus:outline-none"
                  >
                    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-obsidian transition group-hover:border-violet-400/60">
                      {ch.imageUrl ? (
                        <img
                          src={ch.imageUrl}
                          alt={ch.name}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : item.backdropUrl ? (
                        <img
                          src={item.backdropUrl}
                          alt={ch.name}
                          loading="lazy"
                          className="h-full w-full object-cover opacity-55 transition duration-300 group-hover:scale-105"
                        />
                      ) : null}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-obsidian shadow-lg">
                          <Play className="h-4 w-4 fill-obsidian ml-0.5" />
                        </div>
                      </div>
                      <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-200 backdrop-blur-sm">
                        {formatChapterTime(ch.startSeconds)}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-xs font-semibold text-zinc-200 group-hover:text-white">
                      {ch.name}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cast & Crew Carousel */}
          {castPeople.length > 0 && (
            <div className="border-t border-white/10 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base sm:text-lg font-bold text-white">Cast &amp; Crew</h3>
                <div className="hidden sm:flex items-center gap-1.5">
                  <button
                    onClick={() => scrollRow(castRowRef, 'left')}
                    aria-label="Scroll cast left"
                    className="rounded-full border border-white/15 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/15 hover:text-white"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => scrollRow(castRowRef, 'right')}
                    aria-label="Scroll cast right"
                    className="rounded-full border border-white/15 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/15 hover:text-white"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div
                ref={castRowRef}
                data-tv-row="detail-cast"
                className="flex gap-3.5 overflow-x-auto pb-2 scrollbar-hide"
              >
                {castPeople.map((person) => {
                  const isSelected = selectedPerson?.id === person.id;
                  return (
                    <button
                      key={`${person.id}-${person.role || person.type}`}
                      onClick={() => handlePersonClick(person)}
                      className={`group w-28 sm:w-32 flex-shrink-0 text-left transition focus:outline-none ${
                        isSelected ? 'scale-[1.02]' : ''
                      }`}
                    >
                      <div
                        className={`relative aspect-[2/3] w-full overflow-hidden rounded-xl border bg-obsidian/90 transition ${
                          isSelected
                            ? 'border-violet-400 ring-2 ring-violet-400/60'
                            : 'border-white/10 group-hover:border-white/30'
                        }`}
                      >
                        {person.avatarUrl ? (
                          <img
                            src={person.avatarUrl}
                            alt={person.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-900/50 to-surface text-xl font-black text-zinc-400">
                            {person.name
                              .split(' ')
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')}
                          </div>
                        )}
                      </div>
                      <p className="mt-2 truncate text-xs sm:text-[13px] font-bold text-white group-hover:text-violet-300">
                        {person.name}
                      </p>
                      {person.role && (
                        <p className="truncate text-[11px] text-zinc-400">
                          {person.type === 'Actor' ? `as ${person.role}` : person.role}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Inline Person Filmography Drawer (titles in your library starring this person) */}
              {selectedPerson && (
                <div className="mt-4 rounded-2xl border border-violet-500/30 bg-obsidian/75 p-4 animate-fade-in">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-xs sm:text-sm font-bold text-white">
                      More with <span className="text-violet-300">{selectedPerson.name}</span> in
                      your library
                    </h4>
                    <button
                      onClick={() => {
                        setSelectedPerson(null);
                        setPersonItems([]);
                      }}
                      className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {loadingPersonItems ? (
                    <p className="text-xs text-zinc-400">Searching your library...</p>
                  ) : personItems.length === 0 ? (
                    <p className="text-xs text-zinc-400">
                      No other titles with {selectedPerson.name} in your library yet.
                    </p>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
                      {personItems.map((pItem) => (
                        <button
                          key={pItem.id}
                          onClick={() => onSelectItem?.(pItem)}
                          className="group w-24 sm:w-28 flex-shrink-0 text-left"
                        >
                          <div className="aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/10 bg-surface">
                            {pItem.posterUrl && (
                              <img
                                src={pItem.posterUrl}
                                alt={pItem.name}
                                loading="lazy"
                                className="h-full w-full object-cover transition group-hover:scale-105"
                              />
                            )}
                          </div>
                          <p className="mt-1.5 truncate text-xs font-semibold text-white group-hover:text-violet-300">
                            {pItem.name}
                          </p>
                          {pItem.year && (
                            <p className="text-[10px] text-zinc-400">{pItem.year}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* More Like This Carousel */}
          {similarItems.length > 0 && (
            <div className="border-t border-white/10 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base sm:text-lg font-bold text-white">More Like This</h3>
                <div className="hidden sm:flex items-center gap-1.5">
                  <button
                    onClick={() => scrollRow(similarRowRef, 'left')}
                    aria-label="Scroll similar left"
                    className="rounded-full border border-white/15 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/15 hover:text-white"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => scrollRow(similarRowRef, 'right')}
                    aria-label="Scroll similar right"
                    className="rounded-full border border-white/15 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/15 hover:text-white"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div
                ref={similarRowRef}
                data-tv-row="detail-similar"
                className="flex gap-3.5 overflow-x-auto pb-2 scrollbar-hide"
              >
                {similarItems.map((sim) => (
                  <button
                    key={sim.id}
                    onClick={() => onSelectItem?.(sim)}
                    className="group w-28 sm:w-32 flex-shrink-0 text-left focus:outline-none"
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/10 bg-obsidian transition group-hover:border-violet-400/50">
                      {sim.posterUrl && (
                        <img
                          src={sim.posterUrl}
                          alt={sim.name}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      )}
                      {sim.rating && (
                        <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur-sm">
                          <Star className="h-2.5 w-2.5 fill-amber-300" />
                          {sim.rating}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 truncate text-xs sm:text-[13px] font-bold text-white group-hover:text-violet-300">
                      {sim.name}
                    </p>
                    {sim.year && <p className="text-[11px] text-zinc-400">{sim.year}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Embedded Trailer Modal */}
      {activeTrailerUrl && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setActiveTrailerUrl(null);
          }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-lg"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl overflow-hidden rounded-2xl border border-white/20 bg-obsidian shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <Film className="h-4 w-4 text-violet-400 flex-shrink-0" />
                <span className="truncate text-sm font-bold text-white">
                  {item.name} · {activeTrailerUrl.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={activeTrailerUrl.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-zinc-200 hover:bg-white/20"
                >
                  YouTube
                  <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  onClick={() => setActiveTrailerUrl(null)}
                  aria-label="Close trailer"
                  className="rounded-lg p-1.5 text-zinc-300 hover:bg-white/15 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="relative aspect-video w-full bg-black">
              {(() => {
                const embed = extractYouTubeEmbedUrl(activeTrailerUrl.url);
                if (embed) {
                  return (
                    <iframe
                      src={embed}
                      title={activeTrailerUrl.name}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="h-full w-full border-0"
                    />
                  );
                }
                return (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-sm text-zinc-300">
                      This trailer opens externally in your browser.
                    </p>
                    <a
                      href={activeTrailerUrl.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500"
                    >
                      Open Trailer
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
