import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  Cast,
  Check,
  HardDrive,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
  Subtitles,
  Sun,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  fetchNextEpisode,
  getCastPlaybackInfo,
  getPlaybackInfo,
  prefetchPlaybackInfo,
  reportPlaybackProgress,
} from '../services/jellyfin';
import { getOfflinePlaybackInfo } from '../services/offlineDownloads';
import {
  QUALITY_OPTIONS,
  type AuthSession,
  type MediaItem,
  type PlaybackInfo,
  type QualityPreset,
  type SubtitleTrack,
} from '../types/media';
import {
  initCastSdk,
  seekChromecast,
  setChromecastActiveSubtitle,
  setChromecastVolume,
  showAirPlayPicker,
  startChromecast,
  stopChromecast,
  supportsAirPlay,
  toggleChromecastMute,
  toggleChromecastPlayPause,
  type CastState,
} from '../utils/chromecast';
import {
  clearStableCeiling,
  getNetworkLabel,
  getNextLowerQuality,
  getRecommendedQuality,
  isAndroidWebViewPlatform,
  qualityRank,
  recordMeasuredThroughput,
  recordStableCeiling,
  subscribeNetworkChange,
} from '../utils/network';
import {
  fetchSubtitleCues,
  getActiveSubtitleLines,
  type SubtitleCue,
} from '../utils/subtitles';
import { isTizenTv } from '../utils/tvNavigation';

interface VideoPlayerProps {
  session: AuthSession;
  item: MediaItem;
  onClose: () => void;
  onPlayNext?: (nextItem: MediaItem) => void;
}

const BRIGHTNESS_STORAGE_KEY = 'qualiadept_player_brightness_v1';
const MIN_BRIGHTNESS = 0.3;
const MAX_BRIGHTNESS = 1.4;

function clampBrightness(val: number): number {
  return Math.max(MIN_BRIGHTNESS, Math.min(MAX_BRIGHTNESS, Math.round(val * 100) / 100));
}

function loadSavedBrightness(): number {
  try {
    const raw = localStorage.getItem(BRIGHTNESS_STORAGE_KEY);
    if (!raw) return 1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampBrightness(parsed) : 1;
  } catch {
    return 1;
  }
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function getBufferAheadSeconds(video: HTMLVideoElement): number {
  const ct = video.currentTime || 0;
  for (let i = 0; i < video.buffered.length; i++) {
    const start = video.buffered.start(i);
    const end = video.buffered.end(i);
    if (ct >= start - 0.5 && ct <= end + 0.5) {
      return Math.max(0, end - ct);
    }
  }
  return 0;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  session,
  item,
  onClose,
  onPlayNext,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const brightnessTrackRef = useRef<HTMLDivElement>(null);
  const centerPlayBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const qualityBtnRef = useRef<HTMLButtonElement>(null);
  const subBtnRef = useRef<HTMLButtonElement>(null);
  const isTv = isTizenTv();
  const resumeOverrideRef = useRef<number | null>(null);
  const swipeStartRef = useRef<{ y: number; startBrightness: number; moved: boolean } | null>(null);
  const brightnessHudTimerRef = useRef<number | null>(null);
  const adaptiveNoticeTimerRef = useRef<number | null>(null);
  const manualQualityLockedRef = useRef(false);
  const lastAdaptTsRef = useRef(0);
  const lastSeekTsRef = useRef(0);
  const streamStartedAtRef = useRef(0);
  const stallTimestampsRef = useRef<number[]>([]);
  const hasStartedPlayingRef = useRef(false);
  const userPausedRef = useRef(false);
  const nextPrefetchedIdRef = useRef<string | null>(null);
  const offlineRevokeRef = useRef<(() => void) | null>(null);

  const [quality, setQuality] = useState<QualityPreset>(() => getRecommendedQuality());
  const [autoStability, setAutoStability] = useState(true);
  const [bufferAheadSec, setBufferAheadSec] = useState(0);
  const [networkLabel, setNetworkLabel] = useState(() => getNetworkLabel());
  const [offlineQualityLabel, setOfflineQualityLabel] = useState<string | null>(null);
  const [forceHls, setForceHls] = useState(false);
  const [useNativeHls, setUseNativeHls] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [adaptiveNotice, setAdaptiveNotice] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [slowBuffering, setSlowBuffering] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [controlsActivity, setControlsActivity] = useState(0);

  // Brightness (Netflix-style in-app brightness control)
  const [brightness, setBrightness] = useState<number>(() => loadSavedBrightness());
  const [isDraggingBrightness, setIsDraggingBrightness] = useState(false);
  const [showBrightnessHud, setShowBrightnessHud] = useState(false);

  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | null>(null);
  const [activeTextSubIndex, setActiveTextSubIndex] = useState<number | null>(null);
  const [burnInSubIndex, setBurnInSubIndex] = useState<number | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [loadingSubtitles, setLoadingSubtitles] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Auto-Play Next Episode state
  const [nextEpisode, setNextEpisode] = useState<MediaItem | null>(null);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const [nextDismissed, setNextDismissed] = useState(false);

  // Chromecast / AirPlay state
  const [castAvailable, setCastAvailable] = useState(false);
  const [castDeviceName, setCastDeviceName] = useState<string | null>(null);
  const [castNotice, setCastNotice] = useState<string | null>(null);
  const [castState, setCastState] = useState<CastState>({
    isConnected: false,
    deviceName: null,
    isPaused: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    volumeLevel: 1,
    isMuted: false,
  });
  const castStateRef = useRef<CastState>(castState);
  castStateRef.current = castState;

  const bumpControls = useCallback(() => {
    setShowControls(true);
    setControlsActivity((c) => c + 1);
  }, []);

  const updateBrightness = useCallback((nextVal: number, flashHud = false) => {
    const clamped = clampBrightness(nextVal);
    setBrightness(clamped);
    try {
      localStorage.setItem(BRIGHTNESS_STORAGE_KEY, String(clamped));
    } catch {
      // Ignore storage errors
    }
    if (flashHud) {
      setShowBrightnessHud(true);
      if (brightnessHudTimerRef.current) window.clearTimeout(brightnessHudTimerRef.current);
      brightnessHudTimerRef.current = window.setTimeout(() => {
        setShowBrightnessHud(false);
      }, 1200);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (brightnessHudTimerRef.current) window.clearTimeout(brightnessHudTimerRef.current);
      if (adaptiveNoticeTimerRef.current) window.clearTimeout(adaptiveNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return initCastSdk(setCastAvailable, (nextState) => {
      setCastState(nextState);
      if (nextState.isConnected && nextState.deviceName) {
        setCastDeviceName(nextState.deviceName);
      } else if (!nextState.isConnected) {
        setCastDeviceName(null);
      }
    });
  }, []);

  // Keep mobile screen awake while player is open (Screen Wake Lock API)
  useEffect(() => {
    type WakeLockSentinelLike = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    const requestWakeLock = async () => {
      try {
        sentinel = await nav.wakeLock!.request('screen');
      } catch {
        // Browser may reject if tab is hidden or low battery
      }
    };

    requestWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => {});
    };
  }, []);

  // Sync fullscreen state when exited via Escape or system back
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Smart auto-hide controls: NEVER hide while paused, loading, buffering, dragging brightness, or any menu is open
  useEffect(() => {
    if (
      !showControls ||
      !playing ||
      showSubMenu ||
      showQualityMenu ||
      loading ||
      buffering ||
      Boolean(error) ||
      isDraggingBrightness
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShowControls(false);
    }, 5500);

    return () => window.clearTimeout(timer);
  }, [
    showControls,
    controlsActivity,
    playing,
    showSubMenu,
    showQualityMenu,
    loading,
    buffering,
    error,
    isDraggingBrightness,
  ]);

  const qualityRef = useRef<QualityPreset>(quality);
  qualityRef.current = quality;
  const playbackRef = useRef<PlaybackInfo | null>(playback);
  playbackRef.current = playback;
  const streamStatusRef = useRef<string | null>(streamStatus);
  streamStatusRef.current = streamStatus;

  const flashAdaptiveNotice = useCallback((message: string) => {
    setAdaptiveNotice(message);
    if (adaptiveNoticeTimerRef.current) window.clearTimeout(adaptiveNoticeTimerRef.current);
    adaptiveNoticeTimerRef.current = window.setTimeout(() => {
      setAdaptiveNotice(null);
    }, 3200);
  }, []);

  const stepDownQuality = useCallback(
    (reason: string, targetOverride?: QualityPreset): boolean => {
      if (manualQualityLockedRef.current || castStateRef.current.isConnected) return false;
      const now = Date.now();
      // 12s cooldown allows fast cascading (Original → 720p → 480p → 360p) until completely stable
      if (now - lastAdaptTsRef.current < 12_000) return false;

      const currentQ = qualityRef.current;
      const nextQ =
        targetOverride ?? getNextLowerQuality(currentQ, playbackRef.current?.sourceBitrate);
      if (!nextQ || qualityRank(nextQ) >= qualityRank(currentQ)) return false;

      lastAdaptTsRef.current = now;
      stallTimestampsRef.current = [];
      const cur = videoRef.current?.currentTime || 0;
      resumeOverrideRef.current =
        cur > 1
          ? cur
          : !hasStartedPlayingRef.current && item.resumePositionSeconds && item.resumePositionSeconds > 5
          ? item.resumePositionSeconds
          : 0;
      if (playbackRef.current && !playbackRef.current.isHls) {
        setForceHls(true);
      }
      recordStableCeiling(nextQ);
      setQuality(nextQ);
      const label = QUALITY_OPTIONS.find((q) => q.id === nextQ)?.label || nextQ;
      flashAdaptiveNotice(`Lowered to ${label} · ${reason}`);
      return true;
    },
    [flashAdaptiveNotice, item.resumePositionSeconds]
  );

  // Records a mid-playback stall (ignoring manual seek transitions within 3s).
  // 2 stalls within 90 seconds (e.g. buffering every 20-45s) immediately lowers quality until stable!
  const recordStall = useCallback(
    (reason = 'stabilizing playback') => {
      if (!hasStartedPlayingRef.current || castStateRef.current.isConnected) return;
      const now = Date.now();
      if (now - lastSeekTsRef.current < 3000) return;

      const recent = stallTimestampsRef.current.filter((t) => now - t < 90_000);
      // Debounce duplicate waiting + BUFFER_STALLED_ERROR events firing within 2s of each other
      if (recent.length > 0 && now - recent[recent.length - 1] < 2000) return;

      recent.push(now);
      stallTimestampsRef.current = recent;

      if (recent.length >= 2) {
        stepDownQuality(reason);
      }
    },
    [stepDownQuality]
  );

  // Live network change adaptation across Wi-Fi / 5G / 4G / 3G
  useEffect(() => {
    return subscribeNetworkChange(() => {
      setNetworkLabel(getNetworkLabel());
      if (manualQualityLockedRef.current || castStateRef.current.isConnected) return;
      const recommended = getRecommendedQuality();
      if (qualityRank(recommended) < qualityRank(qualityRef.current)) {
        stepDownQuality('adapted to network', recommended);
      }
    });
  }, [stepDownQuality]);

  // Reset next-episode and track selection state when item changes
  useEffect(() => {
    let active = true;
    setNextEpisode(null);
    setNextCountdown(null);
    setNextDismissed(false);
    setSelectedAudioIndex(null);
    setActiveTextSubIndex(null);
    setBurnInSubIndex(null);
    setSubtitleCues([]);
    setLoadingSubtitles(false);
    setForceHls(false);
    setUseNativeHls(false);
    setStreamStatus('Preparing stream...');
    resumeOverrideRef.current = null;
    stallTimestampsRef.current = [];
    hasStartedPlayingRef.current = false;
    userPausedRef.current = false;
    nextPrefetchedIdRef.current = null;
    if (!manualQualityLockedRef.current) {
      setQuality(getRecommendedQuality());
    }

    if (item.type === 'Episode') {
      fetchNextEpisode(session, item).then((ep) => {
        if (active) setNextEpisode(ep);
      });
    }
    return () => {
      active = false;
    };
  }, [session, item]);

  // Fetch stream URL (preferring local offline OPFS download when available!) whenever item, quality, audio, burn-in, or retry changes
  useEffect(() => {
    let active = true;
    offlineRevokeRef.current?.();
    offlineRevokeRef.current = null;
    setOfflineQualityLabel(null);
    setPlayback(null);
    setLoading(true);
    setBuffering(false);
    setSlowBuffering(false);
    setUseNativeHls(false);
    setStreamStatus('Connecting to server...');
    setError(null);
    hasStartedPlayingRef.current = false;
    streamStartedAtRef.current = 0;
    stallTimestampsRef.current = [];

    const tryLoad = async () => {
      const canUseOffline =
        !manualQualityLockedRef.current &&
        selectedAudioIndex === null &&
        burnInSubIndex === null &&
        !forceHls;

      if (canUseOffline) {
        const offline = await getOfflinePlaybackInfo(item.id);
        if (!active) {
          offline?.revoke();
          return;
        }
        if (offline) {
          offlineRevokeRef.current = offline.revoke;
          setOfflineQualityLabel(offline.qualityLabel);
          setStreamStatus('Opening offline download...');
          setPlayback(offline.playback);
          return;
        }
      }

      const info = await getPlaybackInfo(session, item, quality, {
        audioStreamIndex: selectedAudioIndex,
        burnInSubtitleIndex: burnInSubIndex,
        forceHls,
        bypassCache: retryNonce > 0,
      });
      if (active) {
        setStreamStatus(info.isHls ? 'Loading playlist...' : 'Opening direct stream...');
        setPlayback(info);
      }
    };

    tryLoad().catch((err) => {
      if (active) {
        setError(err instanceof Error ? err.message : 'Failed to start playback');
        setLoading(false);
      }
    });

    return () => {
      active = false;
      offlineRevokeRef.current?.();
      offlineRevokeRef.current = null;
    };
  }, [session, item, quality, selectedAudioIndex, burnInSubIndex, forceHls, retryNonce]);

  // Attach HLS.js (with Android WebView inline demuxer + automatic Native HLS fallback) or native video source
  useEffect(() => {
    if (!playback || !videoRef.current) return;
    const video = videoRef.current;
    let hls: Hls | null = null;
    let manifestParsed = false;
    let startReported = false;
    let networkRetries = 0;
    let mediaRetries = 0;
    let initialFragFailures = 0;
    let retryTimer: number | null = null;
    let cleanupNative: (() => void) | null = null;

    const isOfflineFile = playback.mediaSourceId.startsWith('offline-');
    const canNativeHls = Boolean(
      video.canPlayType('application/vnd.apple.mpegurl') ||
        video.canPlayType('application/x-mpegURL')
    );
    const shouldUseHlsJs = playback.isHls && Hls.isSupported() && !useNativeHls;

    const initialSeekTarget =
      resumeOverrideRef.current !== null
        ? resumeOverrideRef.current
        : item.resumePositionSeconds && item.resumePositionSeconds > 5
        ? item.resumePositionSeconds
        : 0;
    resumeOverrideRef.current = null;

    const reportStartOnce = () => {
      if (startReported || isOfflineFile) return;
      startReported = true;
      reportPlaybackProgress(
        session,
        item.id,
        playback.mediaSourceId,
        playback.playSessionId,
        initialSeekTarget || video.currentTime,
        false,
        'start'
      );
    };

    const triggerPlay = () => {
      if (userPausedRef.current) {
        video.pause();
        setPlaying(false);
        return;
      }
      video
        .play()
        .then(() => {
          if (userPausedRef.current) {
            video.pause();
            setPlaying(false);
            return;
          }
          setPlaying(true);
        })
        .catch(() => {
          setPlaying(false);
          setShowControls(true);
        });
      reportStartOnce();
    };

    if (shouldUseHlsJs) {
      const isWebView = isAndroidWebViewPlatform();
      video.removeAttribute('src');
      hls = new Hls({
        // Disable blob Web Worker on Capacitor / Android WebView where blob workers can silently stall MSE transmuxing
        enableWorker: !isWebView,
        lowLatencyMode: false,
        startFragPrefetch: false,
        startPosition: initialSeekTarget > 0 ? initialSeekTarget : -1,
        // Deep forward buffer cushion absorbs 5G dips and tower handoffs with zero pauses
        maxBufferLength: 60,
        maxMaxBufferLength: 180,
        maxBufferSize: 120 * 1000 * 1000,
        backBufferLength: 20,
        maxBufferHole: 1.5,
        highBufferWatchdogPeriod: 2,
        maxStarvationDelay: 4,
        nudgeOffset: 0.25,
        nudgeMaxRetry: 12,
        fragLoadingTimeOut: 25_000,
        manifestLoadingTimeOut: 15_000,
        levelLoadingTimeOut: 15_000,
        fragLoadingMaxRetry: 4,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 2,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        setStreamStatus('Loading playlist...');
        hls?.loadSource(playback.streamUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        manifestParsed = true;
        // Keep loading=true until FRAG_BUFFERED / onCanPlay fires so startup watchdog stays active
        // and we never flash fake "Buffering..." at 0:00 before segment 0 arrives.
        setStreamStatus('Buffering first video segment...');
        triggerPlay();
      });

      hls.on(Hls.Events.FRAG_LOADING, (_ev, data) => {
        if (!hasStartedPlayingRef.current) {
          const sn = data.frag?.sn;
          setStreamStatus(
            typeof sn === 'number'
              ? `Downloading segment #${sn}...`
              : 'Downloading first video segment...'
          );
        }
      });

      hls.on(Hls.Events.FRAG_LOADED, (_ev, data) => {
        if (!hasStartedPlayingRef.current) {
          setStreamStatus('Decoding video...');
        }
        const stats = data.frag?.stats;
        if (!stats) return;
        const bytes = stats.loaded || 0;
        // Measure ONLY body transfer duration (end - first), excluding server FFmpeg TTFB wait
        const firstByte = stats.loading?.first || 0;
        const endByte = stats.loading?.end || 0;
        const transferMs = endByte - firstByte;
        if (bytes >= 60_000 && firstByte > 0 && transferMs >= 20) {
          const sampleMbps = (bytes * 8) / (transferMs / 1000) / 1_000_000;
          recordMeasuredThroughput(sampleMbps);
        }
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        networkRetries = 0;
        initialFragFailures = 0;
        setLoading(false);
        setBuffering(false);
        setSlowBuffering(false);
        setStreamStatus(null);
        if (video.paused && !hasStartedPlayingRef.current) {
          triggerPlay();
        }
      });

      hls.on(Hls.Events.ERROR, (_ev, data) => {
        const httpCode = data.response?.code;

        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            if (hasStartedPlayingRef.current) {
              setBuffering(true);
              recordStall('stabilizing playback');
            }
            return;
          }

          // Surface non-fatal MSE/worker/segment issues instead of spinning silently at 0:00
          if (
            data.details === Hls.ErrorDetails.INTERNAL_EXCEPTION ||
            data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR ||
            data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_PARSING_ERROR
          ) {
            if (canNativeHls && !hasStartedPlayingRef.current) {
              setStreamStatus('Switching to native Android player...');
              setUseNativeHls(true);
              return;
            }
            setStreamStatus(`Recovering decoder (${data.details})...`);
            return;
          }

          if (
            data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT
          ) {
            initialFragFailures += 1;
            const detail = httpCode ? `HTTP ${httpCode}` : 'timeout';
            setStreamStatus(`Segment retry #${initialFragFailures} (${detail})...`);
            if (!hasStartedPlayingRef.current && initialFragFailures >= 2 && canNativeHls) {
              setStreamStatus('Switching to native Android player...');
              setUseNativeHls(true);
            }
          }
          return;
        }

        const isClientHttpError =
          typeof httpCode === 'number' &&
          httpCode >= 400 &&
          httpCode < 500 &&
          httpCode !== 408 &&
          httpCode !== 429;

        // Auto-recover from transient 5G / transcoding stalls before showing an error screen.
        // Crucial: MANIFEST_* failures MUST call loadSource() — startLoad() silently stops hls.js!
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !isClientHttpError && networkRetries < 3) {
          networkRetries += 1;
          setStreamStatus(
            `Reconnecting (${data.details}${httpCode ? ` · HTTP ${httpCode}` : ''})...`
          );
          if (hasStartedPlayingRef.current) setBuffering(true);
          const isManifestErr =
            !manifestParsed ||
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;
          retryTimer = window.setTimeout(() => {
            if (!hls) return;
            if (isManifestErr) {
              hls.loadSource(playback.streamUrl);
            } else {
              hls.startLoad(video.currentTime || initialSeekTarget || -1);
            }
          }, 1000 * networkRetries);
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
          mediaRetries += 1;
          setStreamStatus('Recovering media buffer...');
          if (hasStartedPlayingRef.current) setBuffering(true);
          hls?.recoverMediaError();
          return;
        }

        // Last-resort automatic fallback to Android/Safari native hardware HLS before showing error screen
        if (canNativeHls && !useNativeHls) {
          setStreamStatus('Switching to native Android player...');
          setUseNativeHls(true);
          return;
        }

        setError(
          `Stream interrupted (${data.details}${httpCode ? ` · HTTP ${httpCode}` : ''}). Tap Retry or try another quality.`
        );
        setLoading(false);
        setBuffering(false);
        setSlowBuffering(false);
        setShowControls(true);
      });

      hls.attachMedia(video);
    } else {
      hlsRef.current = null;
      if (playback.isHls && useNativeHls) {
        setStreamStatus('Loading via native Android player...');
      }

      const onMetadata = () => {
        if (initialSeekTarget > 0) {
          try {
            video.currentTime = initialSeekTarget;
          } catch {
            // Some native HLS streams seek after canplay
          }
        }
        setStreamStatus(isOfflineFile ? 'Starting offline video...' : 'Buffering first frame...');
        triggerPlay();
      };

      const onCanPlayReady = () => {
        if (initialSeekTarget > 0 && video.currentTime < 1 && !hasStartedPlayingRef.current) {
          try {
            video.currentTime = initialSeekTarget;
          } catch {
            // Ignore seek failure
          }
        }
        setLoading(false);
        setBuffering(false);
        setSlowBuffering(false);
        setStreamStatus(null);
      };

      const onNativeError = () => {
        if (!isOfflineFile && !playback.isHls) {
          // Direct Play failed to decode — immediately switch to adaptive HLS
          setForceHls(true);
          flashAdaptiveNotice('Direct Play unsupported · switching to adaptive stream');
          return;
        }
        if (!isOfflineFile && stepDownQuality('switching to adaptive stream')) return;
        setError(
          isOfflineFile
            ? 'Could not decode this offline download in the browser. Delete and re-download in Mobile HD (MP4).'
            : 'Could not load this stream. Tap Retry or try another quality.'
        );
        setLoading(false);
        setBuffering(false);
        setSlowBuffering(false);
        setShowControls(true);
      };

      video.src = playback.streamUrl;
      video.addEventListener('loadedmetadata', onMetadata, { once: true });
      video.addEventListener('canplay', onCanPlayReady, { once: true });
      video.addEventListener('error', onNativeError, { once: true });
      cleanupNative = () => {
        video.removeEventListener('loadedmetadata', onMetadata);
        video.removeEventListener('canplay', onCanPlayReady);
        video.removeEventListener('error', onNativeError);
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
    }

    let stopReported = false;
    const reportStopOnce = () => {
      if (stopReported || !playback || isOfflineFile) return;
      stopReported = true;
      reportPlaybackProgress(
        session,
        item.id,
        playback.mediaSourceId,
        playback.playSessionId,
        video.currentTime || 0,
        true,
        'stop'
      );
    };
    window.addEventListener('pagehide', reportStopOnce);

    return () => {
      window.removeEventListener('pagehide', reportStopOnce);
      if (retryTimer) window.clearTimeout(retryTimer);
      hlsRef.current = null;
      reportStopOnce();
      if (hls) hls.destroy();
      if (cleanupNative) cleanupNative();
    };
  }, [playback, useNativeHls, session, item, stepDownQuality, recordStall, flashAdaptiveNotice]);

  // Continuous 1-second Stability-First Monitor (works on Wi-Fi, 5G, 4G, 3G):
  // Lowers quality automatically until playback runs with zero periodic buffering.
  useEffect(() => {
    if (!playback || loading || error || playback.mediaSourceId.startsWith('offline-')) {
      setBufferAheadSec(0);
      return;
    }

    let continuousStallSec = 0;
    let lowBufferStreakSec = 0;
    let bufferingTicks90s: number[] = [];

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || castStateRef.current.isConnected) return;

      const ahead = getBufferAheadSeconds(video);
      setBufferAheadSec(Math.round(ahead));

      if (!hasStartedPlayingRef.current || video.paused) {
        continuousStallSec = 0;
        lowBufferStreakSec = 0;
        return;
      }

      const now = Date.now();
      // Ignore the 3s immediately after a manual timeline seek
      if (now - lastSeekTsRef.current < 3000) {
        continuousStallSec = 0;
        lowBufferStreakSec = 0;
        return;
      }

      const isCurrentlyStalled = video.readyState < 3 || ahead < 0.25;
      if (isCurrentlyStalled) {
        continuousStallSec += 1;
        lowBufferStreakSec = 0;
        bufferingTicks90s = [...bufferingTicks90s.filter((t) => now - t < 90_000), now];

        // Trigger A: single continuous stall >= 4s -> step down immediately
        if (continuousStallSec >= 4) {
          stepDownQuality('eliminating buffering');
          return;
        }
        // Trigger B: >= 5 seconds total spent buffering within any 90s window -> step down
        if (bufferingTicks90s.length >= 5) {
          stepDownQuality('prioritizing stability');
          return;
        }
      } else {
        continuousStallSec = 0;
        const playedLongEnough = streamStartedAtRef.current > 0 && now - streamStartedAtRef.current > 10_000;
        const farFromEnd = !video.duration || video.duration - video.currentTime > 12;

        // Trigger C: forward buffer stays critically low (< 3.5s) for 4 consecutive seconds ->
        // step down proactively BEFORE the video pauses to buffer!
        if (playedLongEnough && farFromEnd && ahead < 3.5) {
          lowBufferStreakSec += 1;
          if (lowBufferStreakSec >= 4) {
            lowBufferStreakSec = 0;
            stepDownQuality('low buffer cushion');
          }
        } else {
          lowBufferStreakSec = 0;
        }
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [playback, loading, error, stepDownQuality]);

  // Loading & stall recovery watchdog:
  // - If Direct Play stalls at 0:00 for 7s, automatically fall back to adaptive HLS
  // - If HLS.js stalls at 0:00 for 12s on Android WebView, automatically switch to Native Android HLS (or step down quality)
  // - If buffering lasts > 3.5s mid-playback, automatically lower quality first before user waits
  // - Hard timeout after 35s of initial loading so the player can never spin forever
  useEffect(() => {
    if ((!loading && !buffering) || error) {
      setSlowBuffering(false);
      return;
    }

    const nudgeTimer = window.setTimeout(
      () => {
        const video = videoRef.current;
        const hls = hlsRef.current;
        const currentPlayback = playbackRef.current;
        const isOffline = Boolean(currentPlayback?.mediaSourceId.startsWith('offline-'));

        // Startup stall on Direct Play (e.g. unsupported HEVC/audio in Android WebView) -> force HLS immediately
        if (
          loading &&
          !hasStartedPlayingRef.current &&
          currentPlayback &&
          !currentPlayback.isHls &&
          !isOffline
        ) {
          resumeOverrideRef.current =
            item.resumePositionSeconds && item.resumePositionSeconds > 5
              ? item.resumePositionSeconds
              : 0;
          setForceHls(true);
          flashAdaptiveNotice('Direct Play stalled · switching to adaptive stream');
          return;
        }

        if (
          !loading &&
          video &&
          !video.paused &&
          hasStartedPlayingRef.current &&
          Date.now() - lastSeekTsRef.current >= 3000
        ) {
          if (stepDownQuality('auto-adjusted for stability')) {
            return;
          }
        }
        setSlowBuffering(true);
        if (!loading && !userPausedRef.current && video && hls && !video.paused && video.buffered.length > 0) {
          const nextPos = (video.currentTime || 0) + 0.3;
          video.currentTime = nextPos;
          hls.startLoad(nextPos);
          video.play().catch(() => {});
        }
      },
      loading ? 7000 : 3500
    );

    // Secondary startup recovery at 12s: if HLS.js still has 0 buffered seconds, try Android Native HLS or lower quality
    const startupFallbackTimer =
      loading && playback && !playback.mediaSourceId.startsWith('offline-')
        ? window.setTimeout(() => {
            const video = videoRef.current;
            if (!video || hasStartedPlayingRef.current) return;
            const buffered = getBufferAheadSeconds(video);
            if (buffered >= 1) return;

            const canNative = Boolean(
              video.canPlayType('application/vnd.apple.mpegurl') ||
                video.canPlayType('application/x-mpegURL')
            );
            if (playback.isHls && !useNativeHls && canNative) {
              resumeOverrideRef.current =
                item.resumePositionSeconds && item.resumePositionSeconds > 5
                  ? item.resumePositionSeconds
                  : 0;
              setStreamStatus('Switching to native Android player...');
              setUseNativeHls(true);
              flashAdaptiveNotice('Switched to native Android video engine');
              return;
            }
            if (!manualQualityLockedRef.current) {
              stepDownQuality('faster mobile startup');
            }
          }, 12_000)
        : null;

    const hardLoadTimeout = loading
      ? window.setTimeout(() => {
          setError(
            `Stream is taking too long to start (${streamStatusRef.current || 'waiting for first video chunk'}). Tap Retry or switch quality.`
          );
          setLoading(false);
          setBuffering(false);
          setSlowBuffering(false);
          setShowControls(true);
        }, 35_000)
      : null;

    return () => {
      window.clearTimeout(nudgeTimer);
      if (startupFallbackTimer) window.clearTimeout(startupFallbackTimer);
      if (hardLoadTimeout) window.clearTimeout(hardLoadTimeout);
    };
  }, [
    buffering,
    loading,
    error,
    playback,
    useNativeHls,
    item,
    stepDownQuality,
    flashAdaptiveNotice,
  ]);

  // Sync progress with Jellyfin every 10s (uses TV's live progress while casting so paused local video never conflicts)
  useEffect(() => {
    if (!playback || session.isDemo || playback.mediaSourceId.startsWith('offline-')) return;
    const id = window.setInterval(() => {
      const liveCast = castStateRef.current;
      if (liveCast.isConnected) {
        reportPlaybackProgress(
          session,
          item.id,
          playback.mediaSourceId,
          playback.playSessionId,
          liveCast.currentTime,
          liveCast.isPaused,
          'progress'
        );
        return;
      }
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

  // Pre-warm Next Episode PlaybackInfo 35s before credits finish for instant binge transition
  useEffect(() => {
    if (!nextEpisode || nextPrefetchedIdRef.current === nextEpisode.id) return;
    if (duration > 40 && currentTime > 0 && duration - currentTime <= 35) {
      nextPrefetchedIdRef.current = nextEpisode.id;
      prefetchPlaybackInfo(
        session,
        nextEpisode,
        manualQualityLockedRef.current ? quality : getRecommendedQuality()
      );
    }
  }, [currentTime, duration, nextEpisode, session, quality]);

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

  const pauseVideo = useCallback(() => {
    if (castStateRef.current.isConnected) {
      if (!castStateRef.current.isPaused) toggleChromecastPlayPause();
      bumpControls();
      return;
    }
    userPausedRef.current = true;
    const video = videoRef.current;
    if (video) {
      video.pause();
    }
    setPlaying(false);
    bumpControls();
  }, [bumpControls]);

  const resumeVideo = useCallback(() => {
    if (castStateRef.current.isConnected) {
      if (castStateRef.current.isPaused) toggleChromecastPlayPause();
      bumpControls();
      return;
    }
    userPausedRef.current = false;
    const video = videoRef.current;
    if (video) {
      video.play().catch(() => {
        setPlaying(false);
      });
    }
    setPlaying(true);
    bumpControls();
  }, [bumpControls]);

  const togglePlay = useCallback(() => {
    if (castStateRef.current.isConnected) {
      toggleChromecastPlayPause();
      bumpControls();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    // If UI shows Pause (playingRef) OR media is actively playing, always honor the user's Pause tap!
    if (!video.paused || playingRef.current) {
      pauseVideo();
    } else {
      resumeVideo();
    }
  }, [bumpControls, pauseVideo, resumeVideo]);

  const seekBy = useCallback(
    (delta: number) => {
      if (castStateRef.current.isConnected) {
        const target = Math.max(
          0,
          Math.min(
            castStateRef.current.duration || duration || Infinity,
            castStateRef.current.currentTime + delta
          )
        );
        seekChromecast(target);
        bumpControls();
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
      bumpControls();
    },
    [bumpControls, duration]
  );

  // Sync browser/OS MediaSession controls (Android Chrome notifications, headphones, Samsung TV)
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      ms.setActionHandler('play', () => resumeVideo());
      ms.setActionHandler('pause', () => pauseVideo());
      ms.setActionHandler('seekbackward', () => seekBy(-10));
      ms.setActionHandler('seekforward', () => seekBy(10));
    } catch {
      // Ignore unsupported mediaSession actions
    }
    return () => {
      try {
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
        ms.setActionHandler('seekbackward', null);
        ms.setActionHandler('seekforward', null);
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [pauseVideo, resumeVideo, seekBy]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
    bumpControls();
  }, [bumpControls]);

  const showControlsRef = useRef(showControls);
  showControlsRef.current = showControls;

  // Auto-focus inside Quality / Subtitles menus when opened on TV
  useEffect(() => {
    if (!showSubMenu && !showQualityMenu) return;
    const raf = window.requestAnimationFrame(() => {
      const firstMenuBtn = document.querySelector(
        '[data-tv-player-menu="true"] button:not([disabled])'
      ) as HTMLElement | null;
      firstMenuBtn?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [showSubMenu, showQualityMenu]);

  // Auto-focus Play/Pause (or Back while loading) when controls wake on TV
  useEffect(() => {
    if (!isTv || !showControls || showSubMenu || showQualityMenu) return;
    const raf = window.requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      const inPlayer = active && containerRef.current?.contains(active) && active !== containerRef.current;
      if (!inPlayer) {
        (centerPlayBtnRef.current || backBtnRef.current)?.focus();
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isTv, showControls, showSubMenu, showQualityMenu, loading, buffering]);

  // Keyboard & Samsung Smart TV SolarCell remote shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      const isBackKey = e.key === 'Escape' || e.keyCode === 10009 || e.key === 'XF86Back';
      if (isBackKey) {
        e.preventDefault();
        if (showSubMenu || showQualityMenu) {
          const restoreTarget = showQualityMenu ? qualityBtnRef.current : subBtnRef.current;
          setShowSubMenu(false);
          setShowQualityMenu(false);
          bumpControls();
          window.requestAnimationFrame(() => {
            (restoreTarget || centerPlayBtnRef.current || backBtnRef.current)?.focus();
          });
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          onClose();
        }
        return;
      }

      // Keep controls alive whenever the user interacts with the remote/keyboard
      const controlsWereVisible = showControlsRef.current;
      bumpControls();

      if (
        e.key === ' ' ||
        e.key === 'k' ||
        e.key === 'MediaPlayPause' ||
        e.keyCode === 10252
      ) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'MediaPlay' || e.keyCode === 415) {
        e.preventDefault();
        resumeVideo();
      } else if (e.key === 'MediaPause' || e.keyCode === 19) {
        e.preventDefault();
        pauseVideo();
      } else if (e.key === 'MediaStop' || e.keyCode === 413) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'MediaFastForward' || e.keyCode === 417) {
        e.preventDefault();
        seekBy(15);
      } else if (e.key === 'MediaRewind' || e.keyCode === 412) {
        e.preventDefault();
        seekBy(-15);
      } else if (e.key === 'Enter' || e.keyCode === 13) {
        if (!controlsWereVisible && !showSubMenu && !showQualityMenu) {
          // First Center/OK press while HUD is hidden: wake HUD & focus Play/Pause
          e.preventDefault();
          window.requestAnimationFrame(() => {
            (centerPlayBtnRef.current || backBtnRef.current)?.focus();
          });
        } else {
          // If HUD is visible and nothing clickable is focused yet, toggle play/pause cleanly
          const active = document.activeElement as HTMLElement | null;
          const isInteractiveFocused = Boolean(
            active &&
              containerRef.current?.contains(active) &&
              (active.tagName === 'BUTTON' ||
                active.tagName === 'INPUT' ||
                active.tagName === 'A' ||
                active.tagName === 'SELECT')
          );
          if (!isInteractiveFocused) {
            e.preventDefault();
            togglePlay();
            window.requestAnimationFrame(() => {
              (centerPlayBtnRef.current || backBtnRef.current)?.focus();
            });
          }
        }
      } else if (
        !controlsWereVisible &&
        !showSubMenu &&
        !showQualityMenu &&
        (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown')
      ) {
        // When HUD is hidden: Left/Right quick-seeks ±10s, Up/Down wakes controls and focuses Back or Play/Pause
        e.preventDefault();
        if (e.key === 'ArrowRight') {
          seekBy(10);
        } else if (e.key === 'ArrowLeft') {
          seekBy(-10);
        }
        window.requestAnimationFrame(() => {
          const targetBtn =
            e.key === 'ArrowUp'
              ? backBtnRef.current || centerPlayBtnRef.current
              : centerPlayBtnRef.current || backBtnRef.current;
          targetBtn?.focus();
        });
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
  }, [
    onClose,
    nextEpisode,
    onPlayNext,
    showSubMenu,
    showQualityMenu,
    togglePlay,
    pauseVideo,
    resumeVideo,
    seekBy,
    toggleFullscreen,
    bumpControls,
  ]);

  const loadOnChromecast = useCallback(
    async (overrides?: {
      quality?: QualityPreset;
      audioIndex?: number | null;
      burnInIndex?: number | null;
      textSubIndex?: number | null;
      startTime?: number;
    }) => {
      if (!playback) return null;
      const q = overrides?.quality ?? quality;
      const aIdx = overrides?.audioIndex !== undefined ? overrides.audioIndex : selectedAudioIndex;
      const bIdx = overrides?.burnInIndex !== undefined ? overrides.burnInIndex : burnInSubIndex;
      const tIdx =
        overrides?.textSubIndex !== undefined ? overrides.textSubIndex : activeTextSubIndex;
      const startTime =
        overrides?.startTime !== undefined
          ? overrides.startTime
          : castStateRef.current.isConnected
          ? castStateRef.current.currentTime
          : videoRef.current?.currentTime || 0;

      const castStream = await getCastPlaybackInfo(session, item, q, {
        audioStreamIndex: aIdx,
        burnInSubtitleIndex: bIdx,
      });

      const castTextSubs = (playback.subtitles || [])
        .filter((s) => s.isText && s.url)
        .map((s) => ({
          id: s.index,
          label: s.label,
          language: s.language,
          url: s.url!,
        }));

      return startChromecast({
        streamUrl: castStream.streamUrl,
        isHls: castStream.isHls,
        title: item.name,
        subtitle: item.seriesName
          ? `${item.seriesName} · S${item.seasonNumber}E${item.episodeNumber}`
          : undefined,
        posterUrl: item.backdropUrl || item.posterUrl,
        currentTime: startTime,
        subtitles: castTextSubs,
        activeSubtitleId: bIdx !== null ? null : tIdx,
      });
    },
    [playback, quality, selectedAudioIndex, burnInSubIndex, activeTextSubIndex, session, item]
  );

  const getResumePositionForReload = () => {
    const cur = videoRef.current?.currentTime || currentTime || 0;
    if (cur > 1) return cur;
    if (!hasStartedPlayingRef.current && item.resumePositionSeconds && item.resumePositionSeconds > 5) {
      return item.resumePositionSeconds;
    }
    return 0;
  };

  const handleQualityChange = (nextQuality: QualityPreset) => {
    manualQualityLockedRef.current = true;
    setAutoStability(false);
    setForceHls(false);
    setUseNativeHls(false);
    if (nextQuality === quality) {
      setShowQualityMenu(false);
      return;
    }
    setQuality(nextQuality);
    setShowQualityMenu(false);
    bumpControls();

    if (castStateRef.current.isConnected) {
      loadOnChromecast({ quality: nextQuality }).catch(() => {});
      return;
    }
    resumeOverrideRef.current = getResumePositionForReload();
  };

  const handleEnableAutoStability = () => {
    manualQualityLockedRef.current = false;
    setAutoStability(true);
    setForceHls(false);
    setUseNativeHls(false);
    clearStableCeiling();
    setShowQualityMenu(false);
    bumpControls();

    const recommended = getRecommendedQuality();
    if (recommended !== quality) {
      resumeOverrideRef.current = getResumePositionForReload();
      setQuality(recommended);
    }
    flashAdaptiveNotice('Auto Stability enabled · prioritizing smooth playback');
  };

  const handleRetryStream = () => {
    resumeOverrideRef.current = getResumePositionForReload();
    setUseNativeHls(false);
    setError(null);
    setRetryNonce((n) => n + 1);
    bumpControls();
  };

  const handleCastClick = async () => {
    bumpControls();

    if (castDeviceName || castStateRef.current.isConnected) {
      const tvPos = castStateRef.current.currentTime;
      stopChromecast();
      setCastDeviceName(null);
      if (videoRef.current) {
        if (tvPos > 1) videoRef.current.currentTime = tvPos;
        videoRef.current.play().catch(() => {});
      }
      return;
    }

    if (supportsAirPlay(videoRef.current)) {
      showAirPlayPicker(videoRef.current);
      return;
    }

    if (!playback) return;

    try {
      setCastNotice(null);
      const device = await loadOnChromecast();
      if (device) {
        videoRef.current?.pause();
        setCastDeviceName(device);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'No Chromecast device selected. Use Chrome or Edge on the same Wi-Fi as your TV.';
      if (!String(msg).toLowerCase().includes('cancel')) {
        setCastNotice(msg);
        window.setTimeout(() => setCastNotice(null), 5000);
      }
    }
  };

  // Fetch & parse WebVTT subtitle cues directly in JS for reliable custom overlay rendering
  // across Mobile Chrome, Android APK, Desktop, and Samsung Tizen TV (with automatic burn-in fallback).
  useEffect(() => {
    if (activeTextSubIndex === null || !playback) {
      setSubtitleCues([]);
      setLoadingSubtitles(false);
      return;
    }

    const selectedSub = (playback.subtitles || []).find(
      (s) => s.index === activeTextSubIndex && s.isText && s.url
    );
    if (!selectedSub?.url) {
      setSubtitleCues([]);
      setLoadingSubtitles(false);
      return;
    }

    const controller = new AbortController();
    setLoadingSubtitles(true);
    setSubtitleCues([]);
    flashAdaptiveNotice(`Loading subtitles: ${selectedSub.label}...`);

    const authHeader =
      !session.isDemo && session.accessToken
        ? `MediaBrowser Client="Qualiadept Stream", Device="Web", DeviceId="qualiadept-web", Version="1.0.0", Token="${session.accessToken}"`
        : undefined;

    fetchSubtitleCues(selectedSub.url, authHeader, controller.signal)
      .then((cues) => {
        if (controller.signal.aborted) return;
        setSubtitleCues(cues);
        setLoadingSubtitles(false);
        flashAdaptiveNotice(`Subtitles ready: ${selectedSub.label}`);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoadingSubtitles(false);
        setSubtitleCues([]);
        // If WebVTT extraction fails (or returns 0 cues), seamlessly fall back to Jellyfin HLS burn-in
        if (!session.isDemo && !playback.mediaSourceId.startsWith('offline-')) {
          setActiveTextSubIndex(null);
          resumeOverrideRef.current = videoRef.current?.currentTime || currentTime || 0;
          setBurnInSubIndex(selectedSub.index);
          flashAdaptiveNotice(`Using server burn-in for ${selectedSub.label}...`);
        } else {
          flashAdaptiveNotice(`Could not load ${selectedSub.label}`);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeTextSubIndex, playback, session, flashAdaptiveNotice]);

  const effectiveAudioIndex = selectedAudioIndex ?? playback?.defaultAudioIndex ?? null;

  const handleAudioSelect = (audioIndex: number) => {
    if (audioIndex === effectiveAudioIndex) {
      setShowSubMenu(false);
      return;
    }
    setSelectedAudioIndex(audioIndex);
    setShowSubMenu(false);
    bumpControls();

    if (castStateRef.current.isConnected) {
      loadOnChromecast({ audioIndex }).catch(() => {});
      return;
    }
    resumeOverrideRef.current = videoRef.current?.currentTime || 0;
  };

  const handleSubtitleSelect = (sub: SubtitleTrack | null) => {
    const isCasting = castStateRef.current.isConnected;
    if (!sub) {
      setActiveTextSubIndex(null);
      if (burnInSubIndex !== null) {
        setBurnInSubIndex(null);
        if (isCasting) {
          loadOnChromecast({ burnInIndex: null, textSubIndex: null }).catch(() => {});
        } else {
          resumeOverrideRef.current = videoRef.current?.currentTime || 0;
        }
      } else if (isCasting) {
        setChromecastActiveSubtitle(null);
      }
      setShowSubMenu(false);
      bumpControls();
      return;
    }

    if (sub.isText && sub.url) {
      setActiveTextSubIndex(sub.index);
      if (burnInSubIndex !== null) {
        setBurnInSubIndex(null);
        if (isCasting) {
          loadOnChromecast({ burnInIndex: null, textSubIndex: sub.index }).catch(() => {});
        } else {
          resumeOverrideRef.current = videoRef.current?.currentTime || 0;
        }
      } else if (isCasting) {
        setChromecastActiveSubtitle(sub.index);
      }
    } else {
      setActiveTextSubIndex(null);
      if (burnInSubIndex !== sub.index) {
        setBurnInSubIndex(sub.index);
        if (isCasting) {
          loadOnChromecast({ burnInIndex: sub.index, textSubIndex: null }).catch(() => {});
        } else {
          resumeOverrideRef.current = videoRef.current?.currentTime || 0;
        }
      }
    }
    setShowSubMenu(false);
    bumpControls();
  };

  // Vertical brightness slider pointer handling (works on both touch and mouse)
  const applyBrightnessFromClientY = (clientY: number) => {
    const track = brightnessTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const nextVal = MIN_BRIGHTNESS + ratio * (MAX_BRIGHTNESS - MIN_BRIGHTNESS);
    updateBrightness(nextVal, true);
  };

  // Left-side touch swipe gesture for brightness (Netflix / VLC style)
  const handleVideoTouchStart = (e: React.TouchEvent<HTMLVideoElement>) => {
    if (e.touches.length !== 1 || showSubMenu || showQualityMenu) return;
    const touch = e.touches[0];
    const width = containerRef.current?.clientWidth || window.innerWidth;
    if (touch.clientX <= width * 0.35) {
      swipeStartRef.current = {
        y: touch.clientY,
        startBrightness: brightness,
        moved: false,
      };
    } else {
      swipeStartRef.current = null;
    }
  };

  const handleVideoTouchMove = (e: React.TouchEvent<HTMLVideoElement>) => {
    if (!swipeStartRef.current || e.touches.length !== 1) return;
    const deltaY = swipeStartRef.current.y - e.touches[0].clientY;
    if (Math.abs(deltaY) > 12) {
      swipeStartRef.current.moved = true;
      const nextVal = swipeStartRef.current.startBrightness + deltaY / 260;
      updateBrightness(nextVal, true);
    }
  };

  const handleVideoTouchEnd = () => {
    swipeStartRef.current = null;
  };

  // Tapping video toggles controls visibility (or closes open menus) instead of accidentally pausing
  const handleVideoSurfaceClick = () => {
    if (swipeStartRef.current?.moved) return;
    if (showSubMenu || showQualityMenu) {
      setShowSubMenu(false);
      setShowQualityMenu(false);
      bumpControls();
      return;
    }
    if (showControls) {
      if (playing && !loading && !buffering) {
        setShowControls(false);
      }
    } else {
      bumpControls();
    }
  };

  const isCasting = Boolean(castDeviceName || castState.isConnected);
  const displayCurrentTime = isCasting ? castState.currentTime : currentTime;
  const displayDuration = isCasting ? castState.duration || duration : duration;
  const displayPlaying = isCasting ? !castState.isPaused : playing;
  const displayMuted = isCasting ? castState.isMuted : muted;
  const displayVolume = isCasting ? castState.volumeLevel : volume;

  const activeSubtitleIndex = burnInSubIndex ?? activeTextSubIndex;
  const hasAudioOrSubs =
    Boolean(playback && (playback.audioTracks.length > 0 || playback.subtitles.length > 0));
  const activeQualityLabel =
    QUALITY_OPTIONS.find((q) => q.id === quality)?.label || 'Original';
  const brightnessPct = Math.round(brightness * 100);
  const brightnessFillPct =
    ((brightness - MIN_BRIGHTNESS) / (MAX_BRIGHTNESS - MIN_BRIGHTNESS)) * 100;

  return (
    <div
      ref={containerRef}
      data-tv-player="true"
      data-tv-controls-visible={showControls || isCasting ? 'true' : 'false'}
      data-tv-scope="modal"
      onMouseMove={bumpControls}
      className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden bg-black select-none"
    >
      {/* Blurred backdrop artwork while initial stream loads (prevents dead black screen) */}
      {loading && !error && (item.backdropUrl || item.posterUrl) && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={item.backdropUrl || item.posterUrl}
            alt=""
            className="h-full w-full scale-105 object-cover opacity-35 blur-xl"
          />
          <div className="absolute inset-0 bg-black/55" />
        </div>
      )}

      {/* Video Element */}
      <video
        ref={videoRef}
        onClick={handleVideoSurfaceClick}
        onTouchStart={handleVideoTouchStart}
        onTouchMove={handleVideoTouchMove}
        onTouchEnd={handleVideoTouchEnd}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onPlay={() => setPlaying(true)}
        onPlaying={() => {
          hasStartedPlayingRef.current = true;
          if (streamStartedAtRef.current === 0) {
            streamStartedAtRef.current = Date.now();
          }
          setPlaying(true);
          setBuffering(false);
          setLoading(false);
          setStreamStatus(null);
        }}
        onSeeking={() => {
          lastSeekTsRef.current = Date.now();
        }}
        onWaiting={() => {
          if (hasStartedPlayingRef.current) {
            setBuffering(true);
            recordStall('stabilizing playback');
          }
        }}
        onCanPlay={() => {
          setLoading(false);
          setBuffering(false);
          setStreamStatus(null);
        }}
        onPause={() => {
          setPlaying(false);
          setShowControls(true);
        }}
        onEnded={() => {
          if (nextEpisode && onPlayNext && !nextDismissed) {
            onPlayNext(nextEpisode);
          }
        }}
        crossOrigin="anonymous"
        preload="auto"
        playsInline
        style={{
          filter: brightness !== 1 ? `brightness(${brightness})` : undefined,
        }}
        {...({ 'x-webkit-airplay': 'allow' } as Record<string, string>)}
        className="h-full w-full object-contain"
      />

      {/* Custom WebVTT Subtitle Overlay (works identically on Mobile Chrome, Android APK, Desktop & Samsung TV) */}
      {!castDeviceName && !error && (subtitleCues.length > 0 || loadingSubtitles) && (() => {
        const activeLines = getActiveSubtitleLines(subtitleCues, displayCurrentTime);
        if (activeLines.length === 0 && !loadingSubtitles) return null;
        return (
          <div
            className={`pointer-events-none absolute inset-x-4 z-20 flex flex-col items-center gap-1 text-center transition-all duration-200 sm:inset-x-12 ${
              showControls ? 'bottom-28 sm:bottom-32' : 'bottom-8 sm:bottom-12'
            }`}
          >
            {loadingSubtitles && activeLines.length === 0 ? (
              <span className="rounded-lg bg-black/70 px-3 py-1 text-xs font-medium text-zinc-200 backdrop-blur-sm">
                Loading subtitles...
              </span>
            ) : (
              activeLines.map((line, idx) => (
                <span
                  key={idx}
                  className={`max-w-4xl whitespace-pre-line rounded-lg bg-black/75 px-3.5 py-1.5 font-semibold leading-snug text-white shadow-lg [text-shadow:0_2px_6px_rgba(0,0,0,0.95)] ${
                    isTv ? 'text-2xl px-5 py-2' : 'text-sm sm:text-xl'
                  }`}
                >
                  {line}
                </span>
              ))
            )}
          </div>
        );
      })()}

      {/* Center Play / Pause + ±10s Overlay (Netflix-style, great for mobile & touch) */}
      {showControls && !loading && !buffering && !error && !castDeviceName && !showSubMenu && !showQualityMenu && (
        <div
          data-tv-row="center"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-6 sm:gap-10"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              seekBy(-10);
            }}
            aria-label="Back 10 seconds"
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:scale-110 hover:bg-black/65 active:scale-95 sm:h-14 sm:w-14"
          >
            <RotateCcw className="h-6 w-6" />
          </button>
          <button
            type="button"
            ref={centerPlayBtnRef}
            data-tv-default-focus="true"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            aria-label={playing ? 'Pause' : 'Play'}
            className="pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-obsidian shadow-2xl transition hover:scale-105 active:scale-95 sm:h-20 sm:w-20"
          >
            {playing ? (
              <Pause className="h-7 w-7 fill-obsidian sm:h-8 sm:w-8" />
            ) : (
              <Play className="ml-1 h-7 w-7 fill-obsidian sm:h-8 sm:w-8" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              seekBy(10);
            }}
            aria-label="Forward 10 seconds"
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:scale-110 hover:bg-black/65 active:scale-95 sm:h-14 sm:w-14"
          >
            <RotateCw className="h-6 w-6" />
          </button>
        </div>
      )}

      {/* Netflix-style Left Brightness Vertical Slider (hidden on Samsung TV & during loading/buffering) */}
      {!isTv && (
        <div
          className={`absolute left-3 top-1/2 z-20 -translate-y-1/2 flex flex-col items-center gap-2 rounded-2xl border border-white/15 bg-black/55 px-2 py-3 backdrop-blur-md transition-opacity duration-300 sm:left-5 ${
            (isDraggingBrightness || (showControls && !loading && !buffering)) &&
            !error &&
            !castDeviceName &&
            !showSubMenu &&
            !showQualityMenu
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <Sun className="h-4 w-4 text-amber-300" />
          <div
            ref={brightnessTrackRef}
            role="slider"
            aria-label="Brightness"
            aria-valuemin={Math.round(MIN_BRIGHTNESS * 100)}
            aria-valuemax={Math.round(MAX_BRIGHTNESS * 100)}
            aria-valuenow={brightnessPct}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              setIsDraggingBrightness(true);
              applyBrightnessFromClientY(e.clientY);
            }}
            onPointerMove={(e) => {
              if (!isDraggingBrightness) return;
              applyBrightnessFromClientY(e.clientY);
            }}
            onPointerUp={() => setIsDraggingBrightness(false)}
            onPointerCancel={() => setIsDraggingBrightness(false)}
            className="relative h-28 w-5 cursor-pointer touch-none flex items-center justify-center sm:h-36"
          >
            <div className="relative h-full w-1.5 overflow-hidden rounded-full bg-white/25">
              <div
                className="absolute bottom-0 left-0 right-0 rounded-full bg-gradient-to-t from-violet-500 to-amber-300"
                style={{ height: `${brightnessFillPct}%` }}
              />
            </div>
            <div
              className="pointer-events-none absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-md"
              style={{ bottom: `${brightnessFillPct}%` }}
            />
          </div>
          <span className="text-[10px] font-bold tabular-nums text-zinc-200">
            {brightnessPct}%
          </span>
        </div>
      )}

      {/* Transient Brightness HUD (shown when swiping on left edge) */}
      {showBrightnessHud && (
        <div className="pointer-events-none absolute top-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/75 px-4 py-2 text-xs font-bold text-white shadow-xl backdrop-blur-md">
          <Sun className="h-4 w-4 text-amber-300" />
          <span>Brightness {brightnessPct}%</span>
        </div>
      )}

      {/* Transient Adaptive Quality Notice */}
      {adaptiveNotice && !showBrightnessHud && (
        <div className="pointer-events-none absolute top-20 left-1/2 z-30 max-w-[90vw] -translate-x-1/2 truncate rounded-full border border-violet-400/35 bg-black/80 px-4 py-2 text-xs font-semibold text-zinc-100 shadow-xl backdrop-blur-md">
          {adaptiveNotice}
        </div>
      )}

      {/* Loading / Buffering Spinner */}
      {(loading || buffering) && !error && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 px-6 text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
          <p className="mt-4 text-xs sm:text-sm font-medium text-zinc-200 drop-shadow">
            {loading ? `Loading ${activeQualityLabel} stream...` : 'Buffering...'}
          </p>
          {streamStatus && (
            <p className="mt-1 max-w-xs text-[11px] text-zinc-400 drop-shadow">
              {streamStatus}
            </p>
          )}
          {slowBuffering && (
            <div className="pointer-events-auto mt-4 flex max-w-md flex-wrap items-center justify-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRetryStream();
                }}
                className="flex items-center gap-1.5 rounded-xl bg-white/95 px-3.5 py-2 text-xs font-bold text-obsidian shadow-lg hover:bg-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reconnect
              </button>
              {playback?.isHls &&
                !useNativeHls &&
                Boolean(
                  videoRef.current?.canPlayType('application/vnd.apple.mpegurl') ||
                    videoRef.current?.canPlayType('application/x-mpegURL')
                ) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      resumeOverrideRef.current = getResumePositionForReload();
                      setStreamStatus('Switching to native Android player...');
                      setUseNativeHls(true);
                    }}
                    className="rounded-xl border border-emerald-400/35 bg-emerald-500/20 px-3.5 py-2 text-xs font-bold text-emerald-100 shadow-lg backdrop-blur-md hover:bg-emerald-500/30"
                  >
                    Native Player
                  </button>
                )}
              {quality !== 'auto' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleQualityChange('auto');
                  }}
                  className="rounded-xl border border-white/20 bg-white/15 px-3.5 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md hover:bg-white/25"
                >
                  Try Original
                </button>
              )}
              {quality !== '720p' && quality !== '480p' && quality !== '360p' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleQualityChange('720p');
                  }}
                  className="rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg hover:bg-violet-500"
                >
                  Switch to 720p
                </button>
              )}
              {quality === '720p' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleQualityChange('480p');
                  }}
                  className="rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg hover:bg-violet-500"
                >
                  Switch to 480p
                </button>
              )}
              {quality === '480p' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleQualityChange('360p');
                  }}
                  className="rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg hover:bg-violet-500"
                >
                  Switch to 360p
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90 p-6 text-center">
          <p className="max-w-md text-sm text-red-300">{error}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleRetryStream}
              className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-obsidian hover:bg-zinc-200 focus:outline-none focus:ring-4 focus:ring-violet-400"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
            {quality !== 'auto' && (
              <button
                onClick={() => handleQualityChange('auto')}
                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-400"
              >
                Try Original
              </button>
            )}
            {quality !== '720p' ? (
              <button
                onClick={() => handleQualityChange('720p')}
                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-400"
              >
                Try 720p
              </button>
            ) : (
              <button
                onClick={() => handleQualityChange('480p')}
                className="rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-violet-400"
              >
                Try 480p
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-violet-400"
            >
              Back to Browse
            </button>
          </div>
        </div>
      )}

      {/* Casting to TV Overlay */}
      {castDeviceName && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-obsidian/95 px-6 pb-28 pt-16 text-center backdrop-blur-md">
          {(item.backdropUrl || item.posterUrl) && (
            <img
              src={item.backdropUrl || item.posterUrl}
              alt={item.name}
              className="mb-5 h-36 w-60 sm:h-44 sm:w-72 rounded-2xl object-cover shadow-2xl border border-white/15"
            />
          )}
          <div className="flex items-center gap-2 text-violet-400">
            <Cast className="h-4 w-4 sm:h-5 sm:w-5" />
            <span className="text-xs font-bold uppercase tracking-wider">
              {castState.isBuffering
                ? `Buffering on ${castDeviceName}...`
                : castState.isPaused
                ? `Paused on ${castDeviceName}`
                : `Casting to ${castDeviceName}`}
            </span>
          </div>
          <h3 className="mt-2 text-xl sm:text-2xl font-black text-white">{item.name}</h3>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => seekBy(-10)}
              aria-label="Back 10 seconds on TV"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
            <button
              onClick={() => toggleChromecastPlayPause()}
              className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-obsidian hover:bg-zinc-200"
            >
              {displayPlaying ? (
                <>
                  <Pause className="h-4 w-4 fill-obsidian" />
                  Pause on TV
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-obsidian" />
                  Play on TV
                </>
              )}
            </button>
            <button
              onClick={() => seekBy(10)}
              aria-label="Forward 10 seconds on TV"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              <RotateCw className="h-5 w-5" />
            </button>
          </div>
          <button
            onClick={handleCastClick}
            className="mt-4 rounded-xl border border-white/20 bg-white/10 px-5 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/20"
          >
            Stop Casting
          </button>
        </div>
      )}

      {/* Transient Cast Notice */}
      {castNotice && (
        <div className="absolute top-20 left-1/2 z-30 max-w-[90vw] -translate-x-1/2 rounded-xl border border-violet-500/40 bg-surface/95 px-4 py-2.5 text-center text-xs font-medium text-zinc-200 shadow-xl backdrop-blur-md">
          {castNotice}
        </div>
      )}

      {/* Auto-Play Next Episode Countdown Overlay */}
      {nextEpisode && nextCountdown !== null && !nextDismissed && onPlayNext && (
        <div className="absolute bottom-24 right-3 sm:bottom-28 sm:right-6 z-30 w-[min(92vw,20rem)] overflow-hidden rounded-2xl border border-white/15 bg-surface/95 p-4 shadow-2xl backdrop-blur-xl animate-fade-in">
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
        data-tv-row="top"
        className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-3 bg-gradient-to-b from-black/85 to-transparent px-3 pt-[max(0.75rem,var(--app-safe-top))] pb-6 sm:px-6 sm:py-5 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          ref={backBtnRef}
          onClick={onClose}
          className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs sm:text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-violet-400"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>

        <div className="min-w-0 text-right">
          <h2 className="truncate text-sm sm:text-base font-bold text-white">{item.name}</h2>
          {item.seriesName && (
            <p className="truncate text-[11px] sm:text-xs text-zinc-400">
              {item.seriesName} · S{item.seasonNumber}E{item.episodeNumber}
            </p>
          )}
        </div>
      </div>

      {/* Responsive Mobile Backdrop for open Menus */}
      {(showSubMenu || showQualityMenu) && (
        <div
          onClick={() => {
            setShowSubMenu(false);
            setShowQualityMenu(false);
          }}
          className="fixed inset-0 z-30 bg-black/50 sm:hidden"
        />
      )}

      {/* Bottom Controls (z-40 sits ABOVE the z-30 mobile menu backdrop so bottom sheets are 100% clickable!) */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-3 pb-[max(0.75rem,var(--app-safe-bottom))] pt-10 sm:px-6 sm:pb-6 sm:pt-12 transition-opacity duration-300 ${
          showControls || isCasting ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Scrubber */}
        <div data-tv-row="timeline" className="mb-3 sm:mb-4 flex items-center gap-2 sm:gap-3">
          <span className="w-10 sm:w-12 text-[11px] sm:text-xs font-mono text-zinc-300 tabular-nums">
            {formatTime(displayCurrentTime)}
          </span>
          <input
            type="range"
            aria-label="Seek timeline"
            min={0}
            max={displayDuration || 100}
            value={displayCurrentTime}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                seekBy(15);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                seekBy(-15);
              }
            }}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (isCasting) {
                seekChromecast(val);
              } else {
                if (videoRef.current) videoRef.current.currentTime = val;
                setCurrentTime(val);
              }
              bumpControls();
            }}
            className={`${isTv ? 'h-2.5' : 'h-1.5'} flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-violet-500`}
          />
          <span className="w-10 sm:w-12 text-right text-[11px] sm:text-xs font-mono text-zinc-300 tabular-nums">
            {formatTime(displayDuration)}
          </span>
        </div>

        {/* Control Buttons */}
        <div data-tv-row="bottom" className="flex items-center justify-between gap-1 sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-2.5 min-w-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              aria-label={displayPlaying ? 'Pause' : 'Play'}
              className="flex h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 items-center justify-center rounded-full bg-white text-obsidian transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-violet-400"
            >
              {displayPlaying ? (
                <Pause className="h-4 w-4 sm:h-5 sm:w-5 fill-obsidian" />
              ) : (
                <Play className="h-4 w-4 sm:h-5 sm:w-5 fill-obsidian ml-0.5" />
              )}
            </button>

            <button
              onClick={() => seekBy(-10)}
              title="Back 10s"
              className="hidden xs:inline-flex sm:inline-flex rounded-lg p-1.5 sm:p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              <RotateCcw className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>

            <button
              onClick={() => seekBy(10)}
              title="Forward 10s"
              className="hidden xs:inline-flex sm:inline-flex rounded-lg p-1.5 sm:p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              <RotateCw className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>

            {nextEpisode && onPlayNext && (
              <button
                onClick={() => onPlayNext(nextEpisode)}
                title={`Next: ${nextEpisode.name}`}
                className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1.5 sm:px-3 text-xs font-semibold text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <SkipForward className="h-4 w-4" />
                <span className="hidden sm:inline">Next Ep</span>
              </button>
            )}

            {/* Volume (hidden on Samsung TV where remote hardware Volume +/- controls TV volume) */}
            {!isTv && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    if (isCasting) {
                      toggleChromecastMute();
                      bumpControls();
                      return;
                    }
                    if (!videoRef.current) return;
                    videoRef.current.muted = !muted;
                    setMuted(!muted);
                    bumpControls();
                  }}
                  aria-label={displayMuted ? 'Unmute' : 'Mute'}
                  className="rounded-lg p-1.5 sm:p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  {displayMuted || displayVolume === 0 ? (
                    <VolumeX className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : (
                    <Volume2 className="h-4 w-4 sm:h-5 sm:w-5" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={displayMuted ? 0 : displayVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (isCasting) {
                      setChromecastVolume(v);
                      bumpControls();
                      return;
                    }
                    setVolume(v);
                    setMuted(v === 0);
                    if (videoRef.current) {
                      videoRef.current.volume = v;
                      videoRef.current.muted = v === 0;
                    }
                    bumpControls();
                  }}
                  className="hidden md:block w-20 h-1 cursor-pointer accent-violet-500"
                />
              </div>
            )}
          </div>

          <div className="relative flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
            {/* Quality Selector */}
            <div className="relative">
              <button
                ref={qualityBtnRef}
                onClick={() => {
                  setShowQualityMenu(!showQualityMenu);
                  setShowSubMenu(false);
                  bumpControls();
                }}
                className={`flex items-center gap-1.5 rounded-xl bg-white/15 font-semibold text-white transition hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-violet-400 ${
                  isTv ? 'px-3.5 py-2 text-xs' : 'px-2 py-1.5 sm:px-2.5 text-[11px] sm:text-xs'
                }`}
              >
                {offlineQualityLabel ? (
                  <>
                    <HardDrive className="h-4 w-4 text-emerald-400" />
                    <span className="max-w-[96px] truncate sm:max-w-none">
                      Offline · {offlineQualityLabel}
                    </span>
                  </>
                ) : (
                  <>
                    <Settings className="h-4 w-4 text-violet-300" />
                    <span className="max-w-[92px] truncate sm:max-w-none">
                      {autoStability
                        ? `${isTv ? 'Quality: ' : ''}Auto · ${activeQualityLabel.replace(' HD', '').replace(' SD', '')}`
                        : `${isTv ? 'Quality: ' : ''}${activeQualityLabel}`}
                    </span>
                  </>
                )}
              </button>
              {showQualityMenu && (
                <div
                  data-tv-player-menu="true"
                  className={`fixed inset-x-3 bottom-20 z-40 max-h-[68dvh] overflow-y-auto rounded-2xl border border-white/20 bg-surface/95 p-2.5 shadow-2xl backdrop-blur-xl sm:absolute sm:inset-x-auto sm:bottom-16 sm:right-0 sm:rounded-2xl ${
                    isTv ? 'sm:w-96 p-3' : 'sm:w-72'
                  }`}
                >
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                      Stream Quality
                    </span>
                    {isTv ? (
                      <span className="text-[10px] font-medium text-zinc-400">↩ Back to close</span>
                    ) : (
                      <button
                        onClick={() => setShowQualityMenu(false)}
                        className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white sm:hidden"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Live Network & Buffer Health Strip */}
                  <div className="mx-1 mb-1.5 flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-zinc-300">
                    <span className="flex items-center gap-1.5 truncate">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          buffering
                            ? 'bg-amber-400 animate-pulse'
                            : bufferAheadSec >= 8
                            ? 'bg-emerald-400'
                            : 'bg-violet-400'
                        }`}
                      />
                      {networkLabel}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400">
                      {bufferAheadSec > 0 ? `${bufferAheadSec}s buffer` : loading ? 'Loading...' : 'Live'}
                    </span>
                  </div>

                  {/* Auto (Stability First) Mode */}
                  <button
                    onClick={handleEnableAutoStability}
                    className={`mb-1 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                      autoStability
                        ? 'bg-violet-600 text-white'
                        : 'text-zinc-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold">Auto (Stability First)</div>
                      <div className="text-[11px] opacity-85">
                        Auto-lowers quality until buffering stops ({activeQualityLabel})
                      </div>
                    </div>
                    {autoStability && <Check className="h-4 w-4 flex-shrink-0" />}
                  </button>

                  <div className="my-1 border-t border-white/10" />

                  {QUALITY_OPTIONS.map((opt) => {
                    const isSelectedManual = !autoStability && quality === opt.id;
                    const isActiveAuto = autoStability && quality === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleQualityChange(opt.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition ${
                          isSelectedManual
                            ? 'bg-violet-600 text-white'
                            : isActiveAuto
                            ? 'bg-white/10 text-white'
                            : 'text-zinc-200 hover:bg-white/10'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold">{opt.label}</div>
                          <div className="text-[11px] opacity-80">{opt.description}</div>
                        </div>
                        {isSelectedManual && <Check className="h-4 w-4 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Audio & Subtitles */}
            {hasAudioOrSubs && playback && (
              <div className="relative">
                <button
                  ref={subBtnRef}
                  onClick={() => {
                    setShowSubMenu(!showSubMenu);
                    setShowQualityMenu(false);
                    bumpControls();
                  }}
                  title="Audio & Subtitles"
                  className={`flex items-center gap-1.5 rounded-xl transition hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-violet-400 ${
                    isTv
                      ? 'bg-white/15 px-3.5 py-2 text-xs font-semibold'
                      : 'p-1.5 sm:p-2 hover:bg-white/10'
                  } ${activeSubtitleIndex !== null ? 'text-violet-300' : 'text-white'}`}
                >
                  <Subtitles className="h-4 w-4 sm:h-5 sm:w-5" />
                  {isTv && <span>Audio &amp; Subtitles</span>}
                </button>
                {showSubMenu && (
                  <div
                    data-tv-player-menu="true"
                    className={`fixed inset-x-3 bottom-20 z-40 max-h-[68dvh] overflow-y-auto rounded-2xl border border-white/20 bg-surface/95 p-3 shadow-2xl backdrop-blur-xl sm:absolute sm:inset-x-auto sm:bottom-16 sm:right-0 sm:max-h-[70vh] sm:rounded-2xl sm:p-3 ${
                      playback.audioTracks.length > 0 && playback.subtitles.length > 0
                        ? 'grid grid-cols-1 gap-3 sm:w-[36rem] sm:max-w-[calc(100vw-2rem)] sm:grid-cols-2'
                        : 'sm:w-80'
                    }`}
                  >
                    {/* Mobile sheet header */}
                    <div className="flex items-center justify-between border-b border-white/10 pb-2 sm:hidden">
                      <span className="text-xs font-bold text-white">Audio & Subtitles</span>
                      <button
                        onClick={() => setShowSubMenu(false)}
                        className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Audio Tracks Column */}
                    {playback.audioTracks.length > 0 && (
                      <div className="flex flex-col min-w-0">
                        <div className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Audio
                        </div>
                        <div className="max-h-44 sm:max-h-60 space-y-0.5 overflow-y-auto pr-0.5">
                          {playback.audioTracks.map((track) => {
                            const isSelected = effectiveAudioIndex === track.index;
                            return (
                              <button
                                key={track.index}
                                onClick={() => handleAudioSelect(track.index)}
                                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition ${
                                  isSelected
                                    ? 'bg-violet-600 text-white'
                                    : 'text-zinc-200 hover:bg-white/10'
                                }`}
                              >
                                <span className="truncate">{track.label}</span>
                                {isSelected && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Subtitles Column */}
                    {playback.subtitles.length > 0 && (
                      <div className="flex flex-col min-w-0">
                        <div className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Subtitles
                        </div>
                        <div className="max-h-48 sm:max-h-60 space-y-0.5 overflow-y-auto pr-0.5">
                          <button
                            onClick={() => handleSubtitleSelect(null)}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition ${
                              activeSubtitleIndex === null
                                ? 'bg-violet-600 text-white'
                                : 'text-zinc-300 hover:bg-white/10'
                            }`}
                          >
                            <span>Off</span>
                            {activeSubtitleIndex === null && (
                              <Check className="h-3.5 w-3.5 flex-shrink-0" />
                            )}
                          </button>
                          {playback.subtitles.map((sub) => {
                            const isSelected = activeSubtitleIndex === sub.index;
                            return (
                              <button
                                key={sub.index}
                                onClick={() => handleSubtitleSelect(sub)}
                                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition ${
                                  isSelected
                                    ? 'bg-violet-600 text-white'
                                    : 'text-zinc-200 hover:bg-white/10'
                                }`}
                              >
                                <span className="truncate">{sub.label}</span>
                                <span className="flex flex-shrink-0 items-center gap-1.5">
                                  {!sub.isText && (
                                    <span
                                      className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                                        isSelected
                                          ? 'bg-white/20 text-white'
                                          : 'bg-white/10 text-zinc-400'
                                      }`}
                                    >
                                      {sub.codec ? sub.codec.replace('sub', '').toUpperCase() : 'IMG'}
                                    </span>
                                  )}
                                  {isSelected && <Check className="h-3.5 w-3.5" />}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Chromecast / AirPlay & Fullscreen Buttons (hidden on Samsung TV which is already native fullscreen) */}
            {!isTv && (
              <>
                <button
                  onClick={handleCastClick}
                  title={
                    castDeviceName
                      ? `Casting to ${castDeviceName} (click to stop)`
                      : castAvailable
                      ? 'Cast to Chromecast / TV'
                      : 'Cast to TV (Chrome / Edge / Safari AirPlay)'
                  }
                  className={`rounded-lg p-1.5 sm:p-2 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400 ${
                    castDeviceName ? 'text-violet-400 bg-violet-500/20' : 'text-zinc-200'
                  }`}
                >
                  <Cast className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>

                <button
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  className="rounded-lg p-1.5 sm:p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  {isFullscreen ? (
                    <Minimize className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : (
                    <Maximize className="h-4 w-4 sm:h-5 sm:w-5" />
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
