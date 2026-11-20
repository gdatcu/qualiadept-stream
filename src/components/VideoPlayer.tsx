import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
  Subtitles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  fetchNextEpisode,
  getPlaybackInfo,
  reportPlaybackProgress,
} from '../services/jellyfin';
import {
  QUALITY_OPTIONS,
  type AuthSession,
  type MediaItem,
  type PlaybackInfo,
  type QualityPreset,
} from '../types/media';

interface VideoPlayerProps {
  session: AuthSession;
  item: MediaItem;
  onClose: () => void;
  onPlayNext?: (nextItem: MediaItem) => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  session,
  item,
  onClose,
  onPlayNext,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const resumeOverrideRef = useRef<number | null>(null);

  const [quality, setQuality] = useState<QualityPreset>('auto');
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Auto-Play Next Episode state
  const [nextEpisode, setNextEpisode] = useState<MediaItem | null>(null);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const [nextDismissed, setNextDismissed] = useState(false);

  // Reset next-episode state when item changes
  useEffect(() => {
    let active = true;
    setNextEpisode(null);
    setNextCountdown(null);
    setNextDismissed(false);
    resumeOverrideRef.current = null;

    if (item.type === 'Episode') {
      fetchNextEpisode(session, item).then((ep) => {
        if (active) setNextEpisode(ep);
      });
    }
    return () => {
      active = false;
    };
  }, [session, item]);

  // Fetch stream URL & subtitle tracks whenever item or quality changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    getPlaybackInfo(session, item, quality)
      .then((info) => {
        if (active) setPlayback(info);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to start playback');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [session, item, quality]);

  // Attach HLS.js or native video source
  useEffect(() => {
    if (!playback || !videoRef.current) return;
    const video = videoRef.current;
    let hls: Hls | null = null;

    const startPlayback = () => {
      const seekTarget =
        resumeOverrideRef.current !== null
          ? resumeOverrideRef.current
          : item.resumePositionSeconds && item.resumePositionSeconds > 5
          ? item.resumePositionSeconds
          : 0;
      resumeOverrideRef.current = null;

      if (seekTarget > 0) {
        video.currentTime = seekTarget;
      }
      video.play().catch(() => setPlaying(false));
      setLoading(false);
      reportPlaybackProgress(
        session,
        item.id,
        playback.mediaSourceId,
        playback.playSessionId,
        video.currentTime,
        false,
        'start'
      );
    };

    if (playback.isHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 60,
      });
      hls.loadSource(playback.streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
      hls.on(Hls.Events.ERROR, (_ev, data) => {
        if (data.fatal) {
          setError(`Stream error (${data.details}). Try lowering quality or checking your server.`);
          setLoading(false);
        }
      });
    } else {
      video.src = playback.streamUrl;
      video.addEventListener('loadedmetadata', startPlayback, { once: true });
    }

    return () => {
      if (playback) {
        reportPlaybackProgress(
          session,
          item.id,
          playback.mediaSourceId,
          playback.playSessionId,
          video.currentTime || 0,
          true,
          'stop'
        );
      }
      if (hls) hls.destroy();
    };
  }, [playback, session, item]);

  // Sync progress with Jellyfin every 10s
  useEffect(() => {
    if (!playback || session.isDemo) return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      reportPlaybackProgress(
        session,
        item.id,
        playback.mediaSourceId,
        playback.playSessionId,
        video.currentTime,
        video.paused,
        'progress'
      );
    }, 10_000);
    return () => window.clearInterval(id);
  }, [playback, session, item]);

  // Trigger Auto-Play Next Episode countdown when within final 15s
  useEffect(() => {
    if (!nextEpisode || !onPlayNext || nextDismissed || nextCountdown !== null) return;
    if (duration > 30 && currentTime > 0 && duration - currentTime <= 15) {
      setNextCountdown(10);
    }
  }, [currentTime, duration, nextEpisode, onPlayNext, nextDismissed, nextCountdown]);

  // Tick the countdown timer
  useEffect(() => {
    if (nextCountdown === null || !nextEpisode || !onPlayNext) return;
    if (nextCountdown <= 0) {
      onPlayNext(nextEpisode);
      return;
    }
    const timer = window.setTimeout(() => {
      setNextCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [nextCountdown, nextEpisode, onPlayNext]);

  // Keyboard & Samsung Smart TV remote shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      if (e.key === 'Escape' || e.keyCode === 10009 || e.key === 'XF86Back') {
        e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen();
        else onClose();
      } else if (
        e.key === ' ' ||
        e.key === 'k' ||
        e.key === 'MediaPlayPause' ||
        e.keyCode === 10252
      ) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'MediaPlay' || e.keyCode === 415) {
        e.preventDefault();
        video.play();
        setPlaying(true);
      } else if (e.key === 'MediaPause' || e.keyCode === 19) {
        e.preventDefault();
        video.pause();
        setPlaying(false);
      } else if (e.key === 'ArrowRight' || e.key === 'MediaFastForward' || e.keyCode === 417) {
        e.preventDefault();
        seekBy(10);
      } else if (e.key === 'ArrowLeft' || e.key === 'MediaRewind' || e.keyCode === 412) {
        e.preventDefault();
        seekBy(-10);
      } else if (e.key === 'm') {
        video.muted = !video.muted;
        setMuted(video.muted);
      } else if (e.key === 'f') {
        toggleFullscreen();
      } else if (e.key === 'n' && nextEpisode && onPlayNext) {
        onPlayNext(nextEpisode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, nextEpisode, onPlayNext]);

  const wakeControls = () => {
    setShowControls(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
        setShowSubMenu(false);
        setShowQualityMenu(false);
      }
    }, 3500);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
    wakeControls();
  };

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
    wakeControls();
  };

  const handleQualityChange = (nextQuality: QualityPreset) => {
    if (nextQuality === quality) {
      setShowQualityMenu(false);
      return;
    }
    resumeOverrideRef.current = videoRef.current?.currentTime || 0;
    setQuality(nextQuality);
    setShowQualityMenu(false);
    wakeControls();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const selectSubtitle = (trackIndex: number | null) => {
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = i === trackIndex ? 'showing' : 'hidden';
    }
    setActiveSubtitle(trackIndex);
    setShowSubMenu(false);
  };

  const activeQualityLabel =
    QUALITY_OPTIONS.find((q) => q.id === quality)?.label || 'Original';

  return (
    <div
      ref={containerRef}
      data-tv-player="true"
      data-tv-scope="modal"
      onMouseMove={wakeControls}
      className="fixed inset-0 z-50 flex flex-col bg-black select-none"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        onClick={togglePlay}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          if (nextEpisode && onPlayNext && !nextDismissed) {
            onPlayNext(nextEpisode);
          }
        }}
        crossOrigin="anonymous"
        playsInline
        {...({ 'x-webkit-airplay': 'allow' } as Record<string, string>)}
        className="h-full w-full object-contain"
      >
        {playback?.subtitles.map((sub) => (
          <track
            key={sub.index}
            kind="subtitles"
            label={sub.label}
            srcLang={sub.language}
            src={sub.url}
          />
        ))}
      </video>

      {/* Loading Spinner */}
      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/60">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
          <p className="mt-4 text-sm font-medium text-zinc-300">
            Loading {activeQualityLabel} stream...
          </p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center">
          <p className="max-w-md text-sm text-red-300">{error}</p>
          <div className="mt-5 flex items-center gap-3">
            {quality !== '720p' && (
              <button
                onClick={() => handleQualityChange('720p')}
                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-400"
              >
                Try 720p
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-obsidian focus:outline-none focus:ring-4 focus:ring-violet-400"
            >
              Back to Browse
            </button>
          </div>
        </div>
      )}

      {/* Auto-Play Next Episode Countdown Overlay */}
      {nextEpisode && nextCountdown !== null && !nextDismissed && onPlayNext && (
        <div className="absolute bottom-28 right-6 z-30 w-80 overflow-hidden rounded-2xl border border-white/15 bg-surface/95 p-4 shadow-2xl backdrop-blur-xl animate-fade-in">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-violet-400">
              Up Next in {nextCountdown}s
            </span>
            <button
              onClick={() => {
                setNextDismissed(true);
                setNextCountdown(null);
              }}
              aria-label="Cancel auto-play"
              className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 truncate text-sm font-bold text-white">
            {nextEpisode.episodeNumber ? `E${nextEpisode.episodeNumber}: ` : ''}
            {nextEpisode.name}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => onPlayNext(nextEpisode)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-2 text-xs font-bold text-obsidian transition hover:bg-zinc-200 focus:outline-none focus:ring-4 focus:ring-violet-400"
            >
              <Play className="h-3.5 w-3.5 fill-obsidian" />
              Play Now
            </button>
            <button
              onClick={() => {
                setNextDismissed(true);
                setNextCountdown(null);
              }}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Top Overlay Bar */}
      <div
        className={`absolute top-0 left-0 right-0 flex items-center justify-between bg-gradient-to-b from-black/85 to-transparent px-6 py-5 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-violet-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="text-right">
          <h2 className="text-base font-bold text-white">{item.name}</h2>
          {item.seriesName && (
            <p className="text-xs text-zinc-400">
              {item.seriesName} · S{item.seasonNumber}E{item.episodeNumber}
            </p>
          )}
        </div>
      </div>

      {/* Bottom Controls */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-6 pb-6 pt-12 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Scrubber */}
        <div className="mb-3 flex items-center gap-3">
          <span className="w-12 text-xs font-mono text-zinc-300">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (videoRef.current) videoRef.current.currentTime = val;
              setCurrentTime(val);
            }}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-violet-500"
          />
          <span className="w-12 text-right text-xs font-mono text-zinc-300">
            {formatTime(duration)}
          </span>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={togglePlay}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-obsidian transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-violet-400"
            >
              {playing ? (
                <Pause className="h-5 w-5 fill-obsidian" />
              ) : (
                <Play className="h-5 w-5 fill-obsidian ml-0.5" />
              )}
            </button>

            <button
              onClick={() => seekBy(-10)}
              title="Back 10s"
              className="rounded-lg p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              <RotateCcw className="h-5 w-5" />
            </button>

            <button
              onClick={() => seekBy(10)}
              title="Forward 10s"
              className="rounded-lg p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              <RotateCw className="h-5 w-5" />
            </button>

            {nextEpisode && onPlayNext && (
              <button
                onClick={() => onPlayNext(nextEpisode)}
                title={`Next: ${nextEpisode.name}`}
                className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <SkipForward className="h-4 w-4" />
                <span className="hidden sm:inline">Next Ep</span>
              </button>
            )}

            {/* Volume */}
            <div className="flex items-center gap-2 ml-1">
              <button
                onClick={() => {
                  if (!videoRef.current) return;
                  videoRef.current.muted = !muted;
                  setMuted(!muted);
                }}
                className="rounded-lg p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  setMuted(v === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = v;
                    videoRef.current.muted = v === 0;
                  }
                }}
                className="hidden sm:block w-20 h-1 cursor-pointer accent-violet-500"
              />
            </div>
          </div>

          <div className="relative flex items-center gap-2">
            {/* Quality Selector */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowQualityMenu(!showQualityMenu);
                  setShowSubMenu(false);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <Settings className="h-4 w-4 text-violet-400" />
                <span>{activeQualityLabel}</span>
              </button>
              {showQualityMenu && (
                <div className="absolute bottom-12 right-0 w-60 rounded-xl border border-white/15 bg-surface/95 p-1.5 shadow-2xl backdrop-blur-xl">
                  <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Stream Quality
                  </div>
                  {QUALITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => handleQualityChange(opt.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left transition ${
                        quality === opt.id
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-200 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-xs font-bold">{opt.label}</div>
                      <div className="text-[11px] opacity-80">{opt.description}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Subtitles */}
            {playback && playback.subtitles.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowSubMenu(!showSubMenu);
                    setShowQualityMenu(false);
                  }}
                  className={`rounded-lg p-2 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400 ${
                    activeSubtitle !== null ? 'text-violet-400' : 'text-zinc-200'
                  }`}
                >
                  <Subtitles className="h-5 w-5" />
                </button>
                {showSubMenu && (
                  <div className="absolute bottom-12 right-0 w-48 rounded-xl border border-white/15 bg-surface/95 p-1.5 shadow-2xl backdrop-blur-xl">
                    <button
                      onClick={() => selectSubtitle(null)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-xs font-medium ${
                        activeSubtitle === null
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-300 hover:bg-white/10'
                      }`}
                    >
                      Off
                    </button>
                    {playback.subtitles.map((sub, idx) => (
                      <button
                        key={sub.index}
                        onClick={() => selectSubtitle(idx)}
                        className={`w-full rounded-lg px-3 py-2 text-left text-xs font-medium ${
                          activeSubtitle === idx
                            ? 'bg-violet-600 text-white'
                            : 'text-zinc-300 hover:bg-white/10'
                        }`}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={toggleFullscreen}
              className="rounded-lg p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              {isFullscreen ? (
                <Minimize className="h-5 w-5" />
              ) : (
                <Maximize className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
