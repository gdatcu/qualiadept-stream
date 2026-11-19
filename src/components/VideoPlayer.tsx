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
  Subtitles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getPlaybackInfo, reportPlaybackProgress } from '../services/jellyfin';
import type { AuthSession, MediaItem, PlaybackInfo } from '../types/media';

interface VideoPlayerProps {
  session: AuthSession;
  item: MediaItem;
  onClose: () => void;
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<number | null>(null);

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

  // Fetch stream URL & subtitle tracks
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    getPlaybackInfo(session, item)
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
  }, [session, item]);

  // Attach HLS.js or native video source
  useEffect(() => {
    if (!playback || !videoRef.current) return;
    const video = videoRef.current;
    let hls: Hls | null = null;

    const startPlayback = () => {
      if (item.resumePositionSeconds && item.resumePositionSeconds > 5) {
        video.currentTime = item.resumePositionSeconds;
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
          setError(`Stream error (${data.details}). Check your media server connection.`);
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

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      if (e.key === 'Escape') {
        if (document.fullscreenElement) document.exitFullscreen();
        else onClose();
      } else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
      } else if (e.key === 'ArrowLeft') {
        video.currentTime = Math.max(0, video.currentTime - 10);
      } else if (e.key === 'm') {
        video.muted = !video.muted;
        setMuted(video.muted);
      } else if (e.key === 'f') {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const wakeControls = () => {
    setShowControls(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
        setShowSubMenu(false);
      }
    }, 3000);
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

  return (
    <div
      ref={containerRef}
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
        crossOrigin="anonymous"
        playsInline
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
            Loading stream...
          </p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center">
          <p className="max-w-md text-sm text-red-300">{error}</p>
          <button
            onClick={onClose}
            className="mt-5 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-obsidian"
          >
            Back to Browse
          </button>
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
          className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-obsidian transition hover:scale-105"
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
              className="rounded-lg p-2 text-zinc-200 transition hover:bg-white/10"
            >
              <RotateCcw className="h-5 w-5" />
            </button>

            <button
              onClick={() => seekBy(10)}
              title="Forward 10s"
              className="rounded-lg p-2 text-zinc-200 transition hover:bg-white/10"
            >
              <RotateCw className="h-5 w-5" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2 ml-2">
              <button
                onClick={() => {
                  if (!videoRef.current) return;
                  videoRef.current.muted = !muted;
                  setMuted(!muted);
                }}
                className="rounded-lg p-2 text-zinc-200 transition hover:bg-white/10"
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
            {/* Subtitles */}
            {playback && playback.subtitles.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowSubMenu(!showSubMenu)}
                  className={`rounded-lg p-2 transition hover:bg-white/10 ${
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
              className="rounded-lg p-2 text-zinc-200 transition hover:bg-white/10"
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
