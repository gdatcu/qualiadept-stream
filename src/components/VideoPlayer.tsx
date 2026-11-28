import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  Cast,
  Check,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Heart,
  Info,
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCw,
  Settings,
  SkipBack,
  SkipForward,
  Subtitles,
  Sun,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  fetchItemDetails,
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
  type ChapterItem,
  type MediaItem,
  type PlaybackInfo,
  type PlaybackStartOptions,
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
  formatResolutionBadge,
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
  loadSubtitlePreferences,
  saveSubtitlePreferences,
  type SubtitleCue,
  type SubtitlePreferences,
  type SubtitleSize,
  type SubtitleStyle,
} from '../utils/subtitles';
import { localizeTrackLabel, useI18n } from '../i18n';
import { isTizenTv } from '../utils/tvNavigation';

type AspectRatioMode = 'auto' | 'cover' | 'zoom' | 'fill';
type RepeatMode = 'none' | 'one';
type SettingsSubPanel = 'root' | 'quality' | 'aspect' | 'speed' | 'repeat';

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface VideoPlayerProps {
  session: AuthSession;
  item: MediaItem;
  startOptions?: PlaybackStartOptions;
  onClose: () => void;
  onPlayNext?: (nextItem: MediaItem) => void;
  onToggleFavorite?: (item: MediaItem) => void;
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
  startOptions,
  onClose,
  onPlayNext,
  onToggleFavorite,
}) => {
  const { lang, t } = useI18n();
  const aspectRatioOptions: Array<{ id: AspectRatioMode; label: string; description: string }> = [
    { id: 'auto', label: t.aspectAuto, description: t.aspectAutoDesc },
    { id: 'cover', label: t.aspectCover, description: t.aspectCoverDesc },
    { id: 'zoom', label: t.aspectZoom, description: t.aspectZoomDesc },
    { id: 'fill', label: t.aspectFill, description: t.aspectFillDesc },
  ];
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const brightnessTrackRef = useRef<HTMLDivElement>(null);
  const centerPlayBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const qualityBtnRef = useRef<HTMLButtonElement>(null);
  const subBtnRef = useRef<HTMLButtonElement>(null);
  const isTv = isTizenTv();
  const resumeOverrideRef = useRef<number | null>(
    typeof startOptions?.startAtSeconds === 'number'
      ? startOptions.startAtSeconds
      : startOptions?.startFromBeginning
      ? 0
      : null
  );
  const appliedStartSubItemIdRef = useRef<string | null>(null);
  const swipeStartRef = useRef<{ y: number; startBrightness: number; moved: boolean } | null>(null);
  const brightnessHudTimerRef = useRef<number | null>(null);
  const adaptiveNoticeTimerRef = useRef<number | null>(null);
  const manualQualityLockedRef = useRef(isTv);
  const openedQualityDirectlyRef = useRef(false);
  const tvDirectQualityBtnRef = useRef<HTMLButtonElement>(null);
  const lastAdaptTsRef = useRef(0);
  const lastSeekTsRef = useRef(0);
  const streamStartedAtRef = useRef(0);
  const stallTimestampsRef = useRef<number[]>([]);
  const hasStartedPlayingRef = useRef(false);
  const userPausedRef = useRef(false);
  const autoReconnectCountRef = useRef(0);
  const nextPrefetchedIdRef = useRef<string | null>(null);
  const offlineRevokeRef = useRef<(() => void) | null>(null);

  const [quality, setQuality] = useState<QualityPreset>(() =>
    isTv ? 'auto' : getRecommendedQuality()
  );
  const [autoStability, setAutoStability] = useState(() => !isTv);
  const [bufferAheadSec, setBufferAheadSec] = useState(0);
  const [bufferedEndSec, setBufferedEndSec] = useState(0);
  const [networkLabel, setNetworkLabel] = useState(() => getNetworkLabel());
  const [offlineQualityLabel, setOfflineQualityLabel] = useState<string | null>(null);
  const [forceHls, setForceHls] = useState(false);
  const [disableHevcFmp4, setDisableHevcFmp4] = useState(false);
  const [useNativeHls, setUseNativeHls] = useState(false);
  const [decodedSize, setDecodedSize] = useState<{ width: number; height: number } | null>(null);
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

  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | null>(
    startOptions?.audioIndex ?? null
  );
  const [activeTextSubIndex, setActiveTextSubIndex] = useState<number | null>(null);
  const [burnInSubIndex, setBurnInSubIndex] = useState<number | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [loadingSubtitles, setLoadingSubtitles] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showChaptersMenu, setShowChaptersMenu] = useState(false);

  // Subtitle appearance, sync offset, and remembered preferred language
  const [subtitlePrefs, setSubtitlePrefs] = useState<SubtitlePreferences>(() =>
    loadSubtitlePreferences()
  );
  const [subtitleOffsetSec, setSubtitleOffsetSec] = useState(0);

  const updateSubtitlePrefs = useCallback(
    (patch: Partial<SubtitlePreferences>) => {
      setSubtitlePrefs((prev) => {
        const next: SubtitlePreferences = { ...prev, ...patch };
        if (!session.isHidden) {
          saveSubtitlePreferences(next);
        }
        return next;
      });
    },
    [session.isHidden]
  );

  // Pro Cinema Player settings (Aspect Ratio, Speed, Repeat, Chapters, Playback Info)
  const [settingsPanel, setSettingsPanel] = useState<SettingsSubPanel>('root');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioMode>('auto');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [showPlaybackInfo, setShowPlaybackInfo] = useState(false);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);

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
        targetOverride ??
        getNextLowerQuality(
          currentQ,
          playbackRef.current?.sourceBitrate,
          playbackRef.current?.sourceWidth
        );
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
    setSelectedAudioIndex(startOptions?.audioIndex ?? null);
    setActiveTextSubIndex(null);
    setBurnInSubIndex(null);
    setSubtitleCues([]);
    setLoadingSubtitles(false);
    setForceHls(false);
    setDisableHevcFmp4(false);
    setUseNativeHls(false);
    setDecodedSize(null);
    setChapters([]);
    setShowChaptersMenu(false);
    setSubtitleOffsetSec(0);
    setStreamStatus('Preparing stream...');
    resumeOverrideRef.current =
      typeof startOptions?.startAtSeconds === 'number'
        ? startOptions.startAtSeconds
        : startOptions?.startFromBeginning
        ? 0
        : null;
    appliedStartSubItemIdRef.current = null;
    stallTimestampsRef.current = [];
    hasStartedPlayingRef.current = false;
    userPausedRef.current = false;
    nextPrefetchedIdRef.current = null;
    if (!manualQualityLockedRef.current) {
      setQuality(getRecommendedQuality());
    }

    fetchItemDetails(session, item.id).then((d) => {
      if (active && d?.chapters?.length) {
        setChapters(d.chapters);
      }
    });

    if (item.type === 'Episode') {
      fetchNextEpisode(session, item).then((ep) => {
        if (active) setNextEpisode(ep);
      });
    }
    return () => {
      active = false;
    };
  }, [session, item, startOptions]);

  // Apply pre-selected subtitle from DetailModal OR remembered preferred language once tracks arrive
  useEffect(() => {
    if (!playback) return;
    if (appliedStartSubItemIdRef.current === item.id) return;
    appliedStartSubItemIdRef.current = item.id;
    const desired = startOptions?.subtitleIndex;
    if (desired === null) return; // explicitly Off from DetailModal

    let match: SubtitleTrack | undefined;
    if (typeof desired === 'number') {
      match = playback.subtitles.find((s) => s.index === desired);
    } else if (subtitlePrefs.preferredLanguage) {
      const pref = subtitlePrefs.preferredLanguage.toLowerCase();
      // Prefer text subtitle matching saved language so playback doesn't need HLS burn-in restart
      match =
        playback.subtitles.find(
          (s) => s.isText && s.language.toLowerCase() === pref && !s.isForced
        ) || playback.subtitles.find((s) => s.isText && s.language.toLowerCase() === pref);
    }

    if (!match) return;
    if (match.isText) {
      setActiveTextSubIndex(match.index);
    } else {
      resumeOverrideRef.current = videoRef.current?.currentTime || item.resumePositionSeconds || 0;
      setBurnInSubIndex(match.index);
    }
  }, [playback, item.id, item.resumePositionSeconds, startOptions, subtitlePrefs.preferredLanguage]);

  // Keep HTML5 video playbackRate synced with selected Playback Speed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, playback]);

  // Reset Settings menu back to root panel whenever closed
  useEffect(() => {
    if (!showQualityMenu) {
      openedQualityDirectlyRef.current = false;
      setSettingsPanel('root');
    }
  }, [showQualityMenu]);

  // Fetch stream URL (preferring local offline OPFS download when available!) whenever item, quality, audio, burn-in, or retry changes
  useEffect(() => {
    let active = true;
    offlineRevokeRef.current?.();
    offlineRevokeRef.current = null;
    setOfflineQualityLabel(null);
    setPlayback(null);
    setDecodedSize(null);
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
        (quality === 'auto' || !manualQualityLockedRef.current) &&
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
        disableHevcFmp4,
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
  }, [session, item, quality, selectedAudioIndex, burnInSubIndex, forceHls, disableHevcFmp4, retryNonce]);

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
        const startLoad = stats.loading?.start || 0;
        const firstByte = stats.loading?.first || 0;
        const endByte = stats.loading?.end || 0;
        const transferMs = endByte - firstByte;
        const totalLoadMs = startLoad > 0 ? endByte - startLoad : transferMs;
        const fragDurationSec = data.frag?.duration || 4;
        // Only sample segments >= 750 KB so small static/cartoon segments never mimic slow 3G/4G pipes
        if (bytes >= 750_000 && firstByte > 0 && transferMs >= 25) {
          const sampleMbps = (bytes * 8) / (transferMs / 1000) / 1_000_000;
          const isRealtimeHealthy =
            fragDurationSec > 0 && totalLoadMs > 0 && (fragDurationSec * 1000) / totalLoadMs >= 1.6;
          recordMeasuredThroughput(sampleMbps, { isRealtimeHealthy });
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
            if (playback.streamUrl.includes('SegmentContainer=mp4') && !hasStartedPlayingRef.current) {
              setStreamStatus('Switching to compatible H.264 stream...');
              setDisableHevcFmp4(true);
              return;
            }
            if (canNativeHls && !hasStartedPlayingRef.current) {
              setStreamStatus('Switching to native hardware player...');
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
              setStreamStatus('Switching to native hardware player...');
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

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && playback.streamUrl.includes('SegmentContainer=mp4')) {
          setStreamStatus('Switching to compatible H.264 stream...');
          setDisableHevcFmp4(true);
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
          mediaRetries += 1;
          setStreamStatus('Recovering media buffer...');
          if (hasStartedPlayingRef.current) setBuffering(true);
          hls?.recoverMediaError();
          return;
        }

        // Last-resort automatic fallback to native hardware HLS before showing error screen
        if (canNativeHls && !useNativeHls) {
          setStreamStatus('Switching to native hardware player...');
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
      setBufferedEndSec(0);
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
      setBufferedEndSec((video.currentTime || 0) + ahead);

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
      loading ? (isTv || quality === 'auto' ? 12_000 : 7000) : 3500
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

    // Automatic stuck-segment recovery (e.g. wedged FFmpeg or transient Wi-Fi/Google Drive hiccup):
    // After 18s stuck in loading/buffering with < 0.5s forward buffer, automatically issue a fresh PlaySessionId!
    const autoReconnectTimer =
      (loading || buffering) &&
      !userPausedRef.current &&
      playback &&
      !playback.mediaSourceId.startsWith('offline-') &&
      autoReconnectCountRef.current < 3
        ? window.setTimeout(() => {
            if (navigator.onLine === false || userPausedRef.current) return;
            const video = videoRef.current;
            const ahead = video ? getBufferAheadSeconds(video) : 0;
            if (ahead >= 1.5 && hasStartedPlayingRef.current) return;

            autoReconnectCountRef.current += 1;
            const attempt = autoReconnectCountRef.current;
            const cur = video?.currentTime || 0;
            resumeOverrideRef.current =
              cur > 1
                ? cur
                : item.resumePositionSeconds && item.resumePositionSeconds > 5
                ? item.resumePositionSeconds
                : 0;
            setUseNativeHls(false);
            setError(null);
            setStreamStatus(`Auto-reconnecting (${attempt}/3)...`);
            flashAdaptiveNotice(`Connection stalled · auto-reconnecting (${attempt}/3)`);
            setRetryNonce((n) => n + 1);
          }, 18_000)
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
        }, 45_000)
      : null;

    return () => {
      window.clearTimeout(nudgeTimer);
      if (startupFallbackTimer) window.clearTimeout(startupFallbackTimer);
      if (autoReconnectTimer) window.clearTimeout(autoReconnectTimer);
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

  // Instant automatic recovery when internet returns or after a transient connection drop
  useEffect(() => {
    const triggerReconnect = (notice: string) => {
      if (playbackRef.current?.mediaSourceId.startsWith('offline-')) return;
      const cur = videoRef.current?.currentTime || 0;
      resumeOverrideRef.current =
        cur > 1
          ? cur
          : item.resumePositionSeconds && item.resumePositionSeconds > 5
          ? item.resumePositionSeconds
          : 0;
      setUseNativeHls(false);
      setError(null);
      setStreamStatus('Reconnecting stream...');
      flashAdaptiveNotice(notice);
      setRetryNonce((n) => n + 1);
    };

    const onOnline = () => {
      if (error || loading || buffering) {
        autoReconnectCountRef.current = 0;
        triggerReconnect('Connection restored · resuming playback');
      }
    };

    window.addEventListener('online', onOnline);

    // If an error occurred while online, automatically retry once after 6 seconds before leaving user stuck
    const errorAutoRetryTimer =
      error && navigator.onLine !== false && autoReconnectCountRef.current < 3
        ? window.setTimeout(() => {
            autoReconnectCountRef.current += 1;
            triggerReconnect(`Reconnecting automatically (${autoReconnectCountRef.current}/3)...`);
          }, 6000)
        : null;

    return () => {
      window.removeEventListener('online', onOnline);
      if (errorAutoRetryTimer) window.clearTimeout(errorAutoRetryTimer);
    };
  }, [error, loading, buffering, item.resumePositionSeconds, flashAdaptiveNotice]);

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

  // Auto-focus inside Quality / Subtitles / Chapters menus (and sub-panels) when opened on TV
  useEffect(() => {
    if (!showSubMenu && !showQualityMenu && !showChaptersMenu) return;
    const raf = window.requestAnimationFrame(() => {
      const firstMenuBtn = document.querySelector(
        '[data-tv-player-menu="true"] button:not([disabled])'
      ) as HTMLElement | null;
      firstMenuBtn?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [showSubMenu, showQualityMenu, showChaptersMenu, settingsPanel]);

  // Auto-focus Play/Pause (or Back while loading) when controls wake on TV
  useEffect(() => {
    if (!isTv || !showControls || showSubMenu || showQualityMenu || showChaptersMenu) return;
    const raf = window.requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      const inPlayer = active && containerRef.current?.contains(active) && active !== containerRef.current;
      if (!inPlayer) {
        (centerPlayBtnRef.current || backBtnRef.current)?.focus();
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isTv, showControls, showSubMenu, showQualityMenu, showChaptersMenu, loading, buffering]);

  // Keyboard & Samsung Smart TV SolarCell remote shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      const isBackKey = e.key === 'Escape' || e.keyCode === 10009 || e.key === 'XF86Back';
      if (isBackKey) {
        e.preventDefault();
        if (showQualityMenu && settingsPanel !== 'root' && !openedQualityDirectlyRef.current) {
          setSettingsPanel('root');
          bumpControls();
          return;
        }
        if (showSubMenu || showQualityMenu || showChaptersMenu) {
          const restoreTarget = showQualityMenu
            ? openedQualityDirectlyRef.current
              ? tvDirectQualityBtnRef.current || qualityBtnRef.current
              : qualityBtnRef.current
            : subBtnRef.current;
          setShowSubMenu(false);
          setShowQualityMenu(false);
          setShowChaptersMenu(false);
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
    showChaptersMenu,
    settingsPanel,
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
    setDisableHevcFmp4(false);
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
    setDisableHevcFmp4(false);
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
    autoReconnectCountRef.current = 0;
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

  // Fetch & parse WebVTT / SRT subtitle cues directly in JS for reliable custom overlay rendering
  // across Mobile Chrome, Android APK, Desktop, and Samsung Tizen TV (cached in memory per track).
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
    flashAdaptiveNotice(`Extracting subtitles: ${selectedSub.label}...`);

    const authHeader =
      !session.isDemo && session.accessToken
        ? `MediaBrowser Client="Qualiadept Stream", Device="Web", DeviceId="qualiadept-web", Version="1.0.0", Token="${session.accessToken}"`
        : undefined;

    fetchSubtitleCues(selectedSub.url, authHeader, controller.signal)
      .then((cues) => {
        if (controller.signal.aborted) return;
        setSubtitleCues(cues);
        setLoadingSubtitles(false);
        flashAdaptiveNotice(`Subtitles ready: ${selectedSub.label} (${cues.length} lines)`);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoadingSubtitles(false);
        setSubtitleCues([]);
        const reason = err instanceof Error && err.message ? ` (${err.message})` : '';
        flashAdaptiveNotice(`Subtitles took too long${reason} · tap Audio & Subtitles to retry`);
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
      updateSubtitlePrefs({ preferredLanguage: null });
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

    if (sub.language && sub.language !== 'und') {
      updateSubtitlePrefs({ preferredLanguage: sub.language.toLowerCase() });
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
    quality === 'auto'
      ? t.originalQuality
      : QUALITY_OPTIONS.find((q) => q.id === quality)?.label || t.originalQuality;

  // Live verified resolution & play method from actual decoded <video> frames + Jellyfin MediaSource
  const syncDecodedVideoSize = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    setDecodedSize((prev) =>
      prev && prev.width === v.videoWidth && prev.height === v.videoHeight
        ? prev
        : { width: v.videoWidth, height: v.videoHeight }
    );
  };

  const sourceResBadge = formatResolutionBadge(playback?.sourceWidth, playback?.sourceHeight);
  const verifiedResBadge = formatResolutionBadge(
    decodedSize?.width || (quality === 'auto' ? playback?.sourceWidth : undefined),
    decodedSize?.height || (quality === 'auto' ? playback?.sourceHeight : undefined)
  );
  const sourceMbpsLabel = playback?.sourceBitrate
    ? `${(playback.sourceBitrate / 1_000_000).toFixed(1)} Mbps`
    : null;
  const playMethodLabel = offlineQualityLabel
    ? 'Offline'
    : !playback
    ? null
    : playback.playMethod === 'DirectPlay' || !playback.isHls
    ? t.directPlay
    : playback.playMethod === 'DirectStream'
    ? t.directRemux
    : t.transcoded;
  const isLosslessVideo = Boolean(
    playback &&
      (!playback.isHls ||
        playback.playMethod === 'DirectPlay' ||
        playback.playMethod === 'DirectStream')
  );

  // Verified concise label for HUD Quality pill (e.g. "Original · 1080p" or "Original · 4K UHD")
  const verifiedQualityPillLabel = (() => {
    if (offlineQualityLabel) return `Offline · ${offlineQualityLabel}`;
    const resSuffix = quality === 'auto' && (verifiedResBadge || sourceResBadge)
      ? ` · ${verifiedResBadge || sourceResBadge}`
      : '';
    const base =
      quality === 'auto'
        ? `${t.originalQuality}${resSuffix}`
        : activeQualityLabel.replace(' HD', '').replace(' SD', '');
    return autoStability ? `Auto · ${base}` : base;
  })();

  // Tailor Quality Options to the actual media source so we never advertise fake higher tiers
  // (e.g. don't offer "1080p HD 8 Mbps" on a 720p episode or a 3.8 Mbps 1080p cartoon where Original is already 1080p!)
  const availableQualityOptions = QUALITY_OPTIONS.filter((opt) => {
    if (opt.id === 'auto' || quality === opt.id) return true;
    if (!playback || (!playback.sourceWidth && !playback.sourceBitrate)) return true;
    const isLowerResolution = Boolean(
      playback.sourceWidth && opt.maxWidth && opt.maxWidth < playback.sourceWidth * 0.92
    );
    const isLowerBitrate = Boolean(
      playback.sourceBitrate && opt.videoBitrate && opt.videoBitrate < playback.sourceBitrate * 0.88
    );
    return isLowerResolution || isLowerBitrate;
  }).map((opt) => {
    if (opt.id !== 'auto') {
      if (lang === 'ro') {
        const roDesc =
          opt.id === '1080p'
            ? '8 Mbps · Înaltă definiție'
            : opt.id === '720p'
            ? '4 Mbps · Ideal pe Wi-Fi și mobil'
            : opt.id === '480p'
            ? '1,5 Mbps · Consum redus de date'
            : '0,7 Mbps · Conexiuni foarte lente';
        return { ...opt, description: roDesc };
      }
      return opt;
    }
    if (!playback) {
      return {
        ...opt,
        label: t.originalQuality,
        description: t.originalUntouchedDesc,
      };
    }
    const specParts: string[] = [];
    if (sourceResBadge) specParts.push(sourceResBadge);
    if (playback.videoCodec) specParts.push(playback.videoCodec);
    if (sourceMbpsLabel) specParts.push(sourceMbpsLabel);
    specParts.push(
      !playback.isHls || playback.playMethod === 'DirectPlay'
        ? t.directPlay
        : playback.playMethod === 'DirectStream' || quality !== 'auto'
        ? t.losslessVideoRemux
        : t.originalQuality
    );
    return {
      ...opt,
      label: sourceResBadge ? `${t.originalQuality} (${sourceResBadge})` : t.originalQuality,
      description: specParts.join(' · '),
    };
  });

  const brightnessPct = Math.round(brightness * 100);
  const brightnessFillPct =
    ((brightness - MIN_BRIGHTNESS) / (MAX_BRIGHTNESS - MIN_BRIGHTNESS)) * 100;
  const safeDuration = displayDuration > 0 ? displayDuration : 100;
  const playedPct = Math.max(0, Math.min(100, (displayCurrentTime / safeDuration) * 100));
  const bufferedPct = Math.max(
    playedPct,
    Math.min(100, (bufferedEndSec / safeDuration) * 100)
  );
  const volumePct = Math.max(0, Math.min(100, (displayMuted ? 0 : displayVolume) * 100));

  const currentChapter = (() => {
    if (chapters.length === 0) return null;
    let active: ChapterItem | null = null;
    for (const ch of chapters) {
      if (ch.startSeconds <= displayCurrentTime + 1) active = ch;
      else break;
    }
    return active;
  })();

  const jumpToChapter = (dir: 'prev' | 'next') => {
    if (chapters.length === 0) return;
    const ct = displayCurrentTime;
    let targetSec: number | null = null;
    if (dir === 'next') {
      const next = chapters.find((ch) => ch.startSeconds > ct + 2);
      if (next) targetSec = next.startSeconds;
    } else {
      for (let i = chapters.length - 1; i >= 0; i--) {
        if (chapters[i].startSeconds < ct - 4) {
          targetSec = chapters[i].startSeconds;
          break;
        }
      }
      if (targetSec === null) targetSec = 0;
    }
    if (targetSec !== null) {
      if (isCasting) {
        seekChromecast(targetSec);
      } else if (videoRef.current) {
        videoRef.current.currentTime = targetSec;
        setCurrentTime(targetSec);
      }
      bumpControls();
    }
  };

  const endsAtLabel = (() => {
    if (displayDuration <= 0) return null;
    const remainingSec = Math.max(0, (displayDuration - displayCurrentTime) / playbackSpeed);
    const endDate = new Date(Date.now() + remainingSec * 1000);
    return endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  })();

  const activeAspectLabel =
    aspectRatioOptions.find((a) => a.id === aspectRatio)?.label || t.aspectAuto;

  const videoAspectClass =
    aspectRatio === 'cover'
      ? 'h-full w-full object-cover'
      : aspectRatio === 'fill'
      ? 'h-full w-full object-fill'
      : aspectRatio === 'zoom'
      ? 'h-full w-full object-contain scale-[1.15]'
      : 'h-full w-full object-contain';

  const videoPlaybackQuality = videoRef.current?.getVideoPlaybackQuality?.();

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
        onLoadedMetadata={syncDecodedVideoSize}
        onResize={syncDecodedVideoSize}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onPlay={() => setPlaying(true)}
        onPlaying={() => {
          syncDecodedVideoSize();
          hasStartedPlayingRef.current = true;
          autoReconnectCountRef.current = 0;
          if (streamStartedAtRef.current === 0) {
            streamStartedAtRef.current = Date.now();
          }
          if (videoRef.current && videoRef.current.playbackRate !== playbackSpeed) {
            videoRef.current.playbackRate = playbackSpeed;
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
          syncDecodedVideoSize();
          setLoading(false);
          setBuffering(false);
          setStreamStatus(null);
        }}
        onPause={() => {
          setPlaying(false);
          setShowControls(true);
        }}
        onEnded={() => {
          if (repeatMode === 'one' && videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(() => {});
            return;
          }
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
        className={`${videoAspectClass} transition-transform duration-200`}
      />

      {/* Playback Info ("Stats for Nerds") Translucent Overlay */}
      {showPlaybackInfo && (
        <div className="pointer-events-auto absolute top-20 left-4 sm:left-6 z-30 w-72 sm:w-80 rounded-2xl border border-white/15 bg-[#0e111d]/95 p-3.5 text-[11px] text-zinc-200 shadow-2xl">
          <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5">
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-violet-300">
              <Info className="h-3.5 w-3.5" />
              {t.playbackInfo}
            </span>
            <button
              onClick={() => setShowPlaybackInfo(false)}
              className="rounded p-0.5 text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-1 font-mono text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-zinc-400">{t.playMethod}</span>
              <span className={`font-semibold ${isLosslessVideo ? 'text-emerald-300' : 'text-amber-300'}`}>
                {offlineQualityLabel
                  ? 'Offline OPFS'
                  : !playback?.isHls || playback?.playMethod === 'DirectPlay'
                  ? `${t.directPlay} (${t.originalQuality})`
                  : playback?.playMethod === 'DirectStream'
                  ? `${t.directRemux} (${t.losslessVideoRemux})`
                  : useNativeHls
                  ? `Native HLS (${t.transcoded})`
                  : `HLS ${t.transcoded}`}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-400">{t.decodedOutput}</span>
              <span>
                {decodedSize
                  ? `${decodedSize.width}×${decodedSize.height}${verifiedResBadge ? ` (${verifiedResBadge})` : ''}`
                  : t.verifyingFrame}
              </span>
            </div>
            {playback?.sourceWidth && playback?.sourceHeight && (
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">{t.sourceFile}</span>
                <span>
                  {playback.sourceWidth}×{playback.sourceHeight}
                  {sourceResBadge ? ` (${sourceResBadge})` : ''}
                </span>
              </div>
            )}
            {playback?.videoCodec && (
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">{t.videoLabel}</span>
                <span>
                  {playback.videoCodec}
                  {playback.videoRange ? ` · ${playback.videoRange}` : ''}
                  {playback.container ? ` (${playback.container})` : ''}
                </span>
              </div>
            )}
            {playback?.audioCodec && (
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">{t.audioLabel}</span>
                <span>
                  {playback.audioCodec}
                  {playback.audioChannels
                    ? ` · ${
                        playback.audioChannels === 6
                          ? '5.1'
                          : playback.audioChannels === 8
                          ? '7.1'
                          : `${playback.audioChannels}ch`
                      }`
                    : ''}
                </span>
              </div>
            )}
            {playback?.sourceBitrate && (
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">{t.sourceBitrate}</span>
                <span>{(playback.sourceBitrate / 1_000_000).toFixed(1)} Mbps</span>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span className="text-zinc-400">{t.networkBuffer}</span>
              <span>
                {networkLabel} · {bufferAheadSec}s
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-400">{t.speedAspect}</span>
              <span>
                {playbackSpeed}x · {activeAspectLabel}
              </span>
            </div>
            {videoPlaybackQuality && (
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">{t.droppedFrames}</span>
                <span>
                  {videoPlaybackQuality.droppedVideoFrames} / {videoPlaybackQuality.totalVideoFrames}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom WebVTT Subtitle Overlay (works identically on Mobile Chrome, Android APK, Desktop & Samsung TV) */}
      {!castDeviceName && !error && (subtitleCues.length > 0 || loadingSubtitles) && (() => {
        const activeLines = getActiveSubtitleLines(
          subtitleCues,
          displayCurrentTime,
          subtitleOffsetSec
        );
        if (activeLines.length === 0 && !loadingSubtitles) return null;
        const sizeClass = isTv
          ? subtitlePrefs.size === 'sm'
            ? 'text-xl px-4 py-1.5'
            : subtitlePrefs.size === 'lg'
            ? 'text-3xl px-6 py-2.5'
            : subtitlePrefs.size === 'xl'
            ? 'text-4xl px-7 py-3'
            : 'text-2xl px-5 py-2'
          : subtitlePrefs.size === 'sm'
          ? 'text-xs sm:text-base px-3 py-1'
          : subtitlePrefs.size === 'lg'
          ? 'text-base sm:text-2xl px-4 py-2'
          : subtitlePrefs.size === 'xl'
          ? 'text-lg sm:text-3xl px-5 py-2.5'
          : 'text-sm sm:text-xl px-3.5 py-1.5';
        const styleClass =
          subtitlePrefs.style === 'outline'
            ? 'bg-transparent [text-shadow:0_2px_4px_#000,0_0_8px_#000,1px_1px_2px_#000,-1px_-1px_2px_#000]'
            : subtitlePrefs.style === 'box'
            ? 'rounded-sm bg-black/95 shadow-xl [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]'
            : 'rounded-lg bg-black/75 shadow-lg backdrop-blur-[2px] [text-shadow:0_2px_6px_rgba(0,0,0,0.95)]';
        return (
          <div
            className={`pointer-events-none absolute inset-x-4 z-20 flex flex-col items-center gap-1 text-center transition-all duration-200 sm:inset-x-12 ${
              showControls ? 'bottom-28 sm:bottom-32' : 'bottom-8 sm:bottom-12'
            }`}
          >
            {loadingSubtitles && activeLines.length === 0 ? (
              <span className="rounded-lg bg-black/70 px-3 py-1 text-xs font-medium text-zinc-200 backdrop-blur-sm">
                {t.loadingSubtitles}
              </span>
            ) : (
              activeLines.map((line, idx) => (
                <span
                  key={idx}
                  className={`max-w-4xl whitespace-pre-line font-semibold leading-snug text-white ${sizeClass} ${styleClass}`}
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
            aria-label="-10s"
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
            aria-label={playing ? t.pause : t.play}
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
            aria-label="+10s"
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
            aria-label={t.brightness}
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
          <span>{t.brightness} {brightnessPct}%</span>
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
            {loading
              ? lang === 'ro'
                ? `Se încarcă fluxul ${activeQualityLabel}...`
                : `Loading ${activeQualityLabel} stream...`
              : t.buffering}
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
                {t.reconnect}
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
                      setStreamStatus(
                        lang === 'ro'
                          ? 'Se trece la playerul nativ...'
                          : 'Switching to native Android player...'
                      );
                      setUseNativeHls(true);
                    }}
                    className="rounded-xl border border-emerald-400/35 bg-emerald-500/20 px-3.5 py-2 text-xs font-bold text-emerald-100 shadow-lg backdrop-blur-md hover:bg-emerald-500/30"
                  >
                    {t.nativePlayer}
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
                  {t.tryOriginal}
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
                  {lang === 'ro' ? 'Treci la 720p' : 'Switch to 720p'}
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
                  {lang === 'ro' ? 'Treci la 480p' : 'Switch to 480p'}
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
                  {lang === 'ro' ? 'Treci la 360p' : 'Switch to 360p'}
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
              {t.retry}
            </button>
            {quality !== 'auto' && (
              <button
                onClick={() => handleQualityChange('auto')}
                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-400"
              >
                {t.tryOriginal}
              </button>
            )}
            {quality !== '720p' ? (
              <button
                onClick={() => handleQualityChange('720p')}
                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-400"
              >
                {lang === 'ro' ? 'Încearcă 720p' : 'Try 720p'}
              </button>
            ) : (
              <button
                onClick={() => handleQualityChange('480p')}
                className="rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-violet-400"
              >
                {lang === 'ro' ? 'Încearcă 480p' : 'Try 480p'}
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-violet-400"
            >
              {t.backToBrowse}
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
                ? `Buffering · ${castDeviceName}`
                : castState.isPaused
                ? `${t.pause} · ${castDeviceName}`
                : `Cast · ${castDeviceName}`}
            </span>
          </div>
          <h3 className="mt-2 text-xl sm:text-2xl font-black text-white">{item.name}</h3>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => seekBy(-10)}
              aria-label="-10s"
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
                  {t.pauseOnTv}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-obsidian" />
                  {t.playOnTv}
                </>
              )}
            </button>
            <button
              onClick={() => seekBy(10)}
              aria-label="+10s"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              <RotateCw className="h-5 w-5" />
            </button>
          </div>
          <button
            onClick={handleCastClick}
            className="mt-4 rounded-xl border border-white/20 bg-white/10 px-5 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/20"
          >
            {t.stopCasting}
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
              {t.upNextIn} {nextCountdown}s
            </span>
            <button
              onClick={() => {
                setNextDismissed(true);
                setNextCountdown(null);
              }}
              aria-label={t.cancel}
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
              {t.playNow}
            </button>
            <button
              onClick={() => {
                setNextDismissed(true);
                setNextCountdown(null);
              }}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/10"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Top Overlay Bar */}
      <div
        data-tv-row="top"
        className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-3 bg-gradient-to-b from-black/90 to-transparent transition-opacity duration-300 ${
          isTv
            ? 'px-[3.8vw] py-6'
            : 'px-3 pt-[max(0.75rem,var(--app-safe-top))] pb-6 sm:px-6 sm:py-5'
        } ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <button
          ref={backBtnRef}
          data-tv-pill={isTv ? 'true' : undefined}
          onClick={onClose}
          className={
            isTv
              ? 'flex flex-shrink-0 items-center gap-2.5 rounded-full border border-white/25 bg-[#141828]/95 px-5 py-2.5 text-sm font-bold text-white shadow-xl'
              : 'flex flex-shrink-0 items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs sm:text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-violet-400'
          }
        >
          <ArrowLeft className={isTv ? 'h-5 w-5' : 'h-4 w-4'} />
          <span>{t.back}</span>
        </button>

        <div className="min-w-0 text-right">
          <h2 className={`truncate font-extrabold text-white ${isTv ? 'text-xl' : 'text-sm sm:text-base font-bold'}`}>
            {item.name}
          </h2>
          {item.seriesName && (
            <p className={`truncate text-zinc-300 ${isTv ? 'text-sm mt-0.5' : 'text-[11px] sm:text-xs text-zinc-400'}`}>
              {item.seriesName} · S{item.seasonNumber}E{item.episodeNumber}
            </p>
          )}
          {playback && !castDeviceName && (
            <div className={`mt-1.5 flex flex-wrap items-center justify-end gap-1.5 ${isTv ? 'text-xs' : 'text-[10px] sm:text-[11px]'}`}>
              {(verifiedResBadge || sourceResBadge) && (
                <span className="rounded-md border border-white/20 bg-[#141828]/90 px-2 py-0.5 font-extrabold tracking-wide text-white">
                  {verifiedResBadge || sourceResBadge}
                </span>
              )}
              {(playback.videoCodec || sourceMbpsLabel) && (
                <span className="hidden sm:inline-flex rounded-md border border-white/15 bg-[#141828]/85 px-2 py-0.5 font-semibold text-zinc-200">
                  {[playback.videoCodec, sourceMbpsLabel].filter(Boolean).join(' · ')}
                </span>
              )}
              {playMethodLabel && (
                <span
                  className={`rounded-md border px-2 py-0.5 font-bold uppercase tracking-wider ${
                    isLosslessVideo
                      ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                      : 'border-amber-400/40 bg-amber-500/20 text-amber-200'
                  }`}
                >
                  {playMethodLabel}
                </span>
              )}
            </div>
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
        className={`absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-black/95 via-black/80 to-transparent transition-opacity duration-300 ${
          isTv
            ? 'px-[3.8vw] pb-8 pt-14'
            : 'px-3 pb-[max(0.75rem,var(--app-safe-bottom))] pt-10 sm:px-6 sm:pb-6 sm:pt-12'
        } ${showControls || isCasting ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        {/* Optional Current Chapter Label */}
        {currentChapter && chapters.length > 1 && (
          <div className={`mb-1.5 flex items-center justify-between px-1 font-semibold text-zinc-300 ${isTv ? 'text-sm' : 'text-[11px]'}`}>
            <span className="truncate max-w-[70%] text-zinc-100">
              {currentChapter.name}
            </span>
            {playbackSpeed !== 1 && (
              <span className="rounded bg-white/15 px-2 py-0.5 font-mono text-xs font-bold text-white">
                {playbackSpeed}x
              </span>
            )}
          </div>
        )}

        {/* 3-Layer Colored Timeline Progress Bar (Elapsed Gradient + Buffered Cushion + Chapter Ticks) */}
        <div data-tv-row="timeline" className={`flex items-center ${isTv ? 'mb-5 gap-4' : 'mb-3 sm:mb-4 gap-2.5 sm:gap-3.5'}`}>
          <span className={`font-mono font-bold text-white tabular-nums ${isTv ? 'w-16 text-sm' : 'w-11 sm:w-14 text-[11px] sm:text-xs text-fuchsia-300'}`}>
            {formatTime(displayCurrentTime)}
          </span>
          <div className="group/timeline relative flex flex-1 items-center py-2">
            {/* Visual 3-layer bar */}
            <div
              className={`relative w-full overflow-hidden rounded-full bg-white/25 transition-all ${
                isTv ? 'h-3' : 'h-1.5 group-hover/timeline:h-2'
              }`}
            >
              {/* Buffered Ahead Range */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/35 transition-all duration-300"
                style={{ width: `${bufferedPct}%` }}
              />
              {/* Elapsed Time Fill */}
              <div
                className={
                  isTv
                    ? 'absolute inset-y-0 left-0 rounded-full bg-white'
                    : 'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-400 shadow-[0_0_12px_rgba(217,70,239,0.75)]'
                }
                style={{ width: `${playedPct}%` }}
              />
              {/* Chapter Marker Ticks */}
              {displayDuration > 0 &&
                chapters.map((ch, idx) => {
                  if (ch.startSeconds <= 0 || ch.startSeconds >= displayDuration) return null;
                  const pct = (ch.startSeconds / safeDuration) * 100;
                  return (
                    <div
                      key={`${ch.startSeconds}-${idx}`}
                      title={ch.name}
                      className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-black/75"
                      style={{ left: `${pct}%` }}
                    />
                  );
                })}
            </div>
            {/* Scrubber Handle */}
            <div
              className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white transition-transform group-hover/timeline:scale-125 ${
                isTv
                  ? 'h-5 w-5 bg-white shadow-lg'
                  : 'h-3.5 w-3.5 bg-fuchsia-400 shadow-[0_0_10px_rgba(217,70,239,0.9)]'
              }`}
              style={{ left: `${playedPct}%` }}
            />
            {/* Native accessible interactive range input overlaid cleanly */}
            <input
              type="range"
              aria-label="Seek timeline"
              min={0}
              max={safeDuration}
              step={1}
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
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0"
            />
          </div>
          <span className={`text-right font-mono text-zinc-300 tabular-nums ${isTv ? 'w-16 text-sm' : 'w-11 sm:w-14 text-[11px] sm:text-xs text-zinc-400'}`}>
            {formatTime(displayDuration)}
          </span>
        </div>

        {/* Control Buttons */}
        <div data-tv-row="bottom" className="flex items-center justify-between gap-2">
          <div className={`flex items-center min-w-0 ${isTv ? 'gap-3' : 'gap-1 sm:gap-2'}`}>
            <button
              type="button"
              data-tv-pill={isTv ? 'true' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              aria-label={displayPlaying ? 'Pause' : 'Play'}
              className={`flex flex-shrink-0 items-center justify-center rounded-full bg-white text-obsidian transition ${
                isTv
                  ? 'h-14 w-14 shadow-2xl'
                  : 'h-9 w-9 sm:h-10 sm:w-10 hover:scale-105 focus:outline-none focus:ring-4 focus:ring-violet-400'
              }`}
            >
              {displayPlaying ? (
                <Pause className={isTv ? 'h-7 w-7 fill-obsidian' : 'h-4 w-4 sm:h-5 sm:w-5 fill-obsidian'} />
              ) : (
                <Play className={isTv ? 'h-7 w-7 fill-obsidian ml-0.5' : 'h-4 w-4 sm:h-5 sm:w-5 fill-obsidian ml-0.5'} />
              )}
            </button>

            {chapters.length > 1 && (
              <button
                data-tv-pill={isTv ? 'true' : undefined}
                onClick={() => jumpToChapter('prev')}
                title="Previous chapter"
                className={
                  isTv
                    ? 'inline-flex rounded-full border border-white/20 bg-[#141828]/95 p-3 text-zinc-100'
                    : 'hidden sm:inline-flex rounded-lg p-1.5 sm:p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400'
                }
              >
                <SkipBack className={isTv ? 'h-6 w-6' : 'h-4 w-4 sm:h-5 sm:w-5'} />
              </button>
            )}

            <button
              data-tv-pill={isTv ? 'true' : undefined}
              onClick={() => seekBy(-10)}
              title="Back 10s"
              className={
                isTv
                  ? 'inline-flex rounded-full border border-white/20 bg-[#141828]/95 p-3 text-zinc-100'
                  : 'hidden xs:inline-flex sm:inline-flex rounded-lg p-1.5 sm:p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400'
              }
            >
              <RotateCcw className={isTv ? 'h-6 w-6' : 'h-4 w-4 sm:h-5 sm:w-5'} />
            </button>

            <button
              data-tv-pill={isTv ? 'true' : undefined}
              onClick={() => seekBy(10)}
              title="Forward 10s"
              className={
                isTv
                  ? 'inline-flex rounded-full border border-white/20 bg-[#141828]/95 p-3 text-zinc-100'
                  : 'hidden xs:inline-flex sm:inline-flex rounded-lg p-1.5 sm:p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400'
              }
            >
              <RotateCw className={isTv ? 'h-6 w-6' : 'h-4 w-4 sm:h-5 sm:w-5'} />
            </button>

            {chapters.length > 1 && (
              <button
                data-tv-pill={isTv ? 'true' : undefined}
                onClick={() => jumpToChapter('next')}
                title="Next chapter"
                className={
                  isTv
                    ? 'inline-flex rounded-full border border-white/20 bg-[#141828]/95 p-3 text-zinc-100'
                    : 'hidden sm:inline-flex rounded-lg p-1.5 sm:p-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400'
                }
              >
                <SkipForward className={isTv ? 'h-6 w-6' : 'h-4 w-4 sm:h-5 sm:w-5'} />
              </button>
            )}

            {nextEpisode && onPlayNext && (
              <button
                data-tv-pill={isTv ? 'true' : undefined}
                onClick={() => onPlayNext(nextEpisode)}
                title={`${t.nextEpisode}: ${nextEpisode.name}`}
                className={
                  isTv
                    ? 'flex items-center gap-2 rounded-full border border-white/25 bg-[#141828]/95 px-5 py-3 text-sm font-bold text-white shadow-xl'
                    : 'flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1.5 sm:px-3 text-xs font-semibold text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-violet-400'
                }
              >
                <SkipForward className={isTv ? 'h-5 w-5' : 'h-4 w-4'} />
                <span className={isTv ? 'inline' : 'hidden sm:inline'}>{t.nextEpisode}</span>
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
                <div className="relative hidden md:flex w-20 items-center py-2">
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                      style={{ width: `${volumePct}%` }}
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-fuchsia-400 shadow"
                    style={{ left: `${volumePct}%` }}
                  />
                  <input
                    type="range"
                    aria-label="Volume"
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
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
              </div>
            )}

            {/* Live Finish-Time Indicator ("Ends at 6:16 PM") */}
            {endsAtLabel && (
              <span className="hidden lg:inline-flex items-center gap-1.5 pl-2 text-xs font-medium text-zinc-300 tabular-nums">
                {t.endsAt} {endsAtLabel}
                {repeatMode === 'one' && (
                  <Repeat className="h-3.5 w-3.5 text-violet-400" />
                )}
              </span>
            )}
          </div>

          <div className={`relative flex items-center flex-shrink-0 ${isTv ? 'gap-3' : 'gap-1.5 sm:gap-2'}`}>
            {/* Visual Chapters Drawer Button */}
            {chapters.length > 1 && (
              <div className="relative">
                <button
                  data-tv-pill={isTv ? 'true' : undefined}
                  onClick={() => {
                    setShowChaptersMenu(!showChaptersMenu);
                    setShowQualityMenu(false);
                    setShowSubMenu(false);
                    bumpControls();
                  }}
                  title={t.chapters}
                  className={
                    isTv
                      ? 'flex items-center gap-2 rounded-full border border-white/20 bg-[#141828]/95 px-5 py-3 text-sm font-bold text-white shadow-xl'
                      : `flex items-center gap-1.5 rounded-xl p-1.5 sm:p-2 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400 ${
                          showChaptersMenu ? 'text-violet-300 bg-white/15' : 'text-zinc-200'
                        }`
                  }
                >
                  <ListVideo className={isTv ? 'h-5 w-5' : 'h-4 w-4 sm:h-5 sm:w-5'} />
                  {isTv && <span>{t.chapters}</span>}
                </button>
                {showChaptersMenu && (
                  <div
                    data-tv-player-menu="true"
                    className={`fixed inset-x-3 bottom-20 z-40 max-h-[68dvh] overflow-y-auto rounded-2xl border border-white/20 p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-16 sm:right-0 sm:w-96 ${
                      isTv ? 'bg-[#0e111d]' : 'bg-surface/95 backdrop-blur-xl'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                        {t.chapters} ({chapters.length})
                      </span>
                      <button
                        onClick={() => setShowChaptersMenu(false)}
                        className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="space-y-1.5 max-h-[54vh] overflow-y-auto pr-0.5">
                      {chapters.map((ch) => {
                        const isActive =
                          currentChapter?.startSeconds === ch.startSeconds &&
                          currentChapter?.name === ch.name;
                        return (
                          <button
                            key={`${ch.index}-${ch.startSeconds}`}
                            onClick={() => {
                              if (isCasting) {
                                seekChromecast(ch.startSeconds);
                              } else if (videoRef.current) {
                                videoRef.current.currentTime = ch.startSeconds;
                                setCurrentTime(ch.startSeconds);
                              }
                              setShowChaptersMenu(false);
                              bumpControls();
                            }}
                            className={`flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition ${
                              isActive
                                ? 'bg-violet-600/35 ring-1 ring-violet-400 text-white'
                                : 'text-zinc-200 hover:bg-white/10'
                            }`}
                          >
                            <div className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-obsidian border border-white/10">
                              {ch.imageUrl ? (
                                <img
                                  src={ch.imageUrl}
                                  alt={ch.name}
                                  loading="lazy"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                  className="h-full w-full object-cover"
                                />
                              ) : item.backdropUrl ? (
                                <img
                                  src={item.backdropUrl}
                                  alt={ch.name}
                                  className="h-full w-full object-cover opacity-50"
                                />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-bold">{ch.name}</div>
                              <div className="mt-0.5 font-mono text-[11px] text-violet-300">
                                {formatTime(ch.startSeconds)}
                              </div>
                            </div>
                            {isActive && (
                              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,0.9)]" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Favorite Heart Toggle */}
            {onToggleFavorite && (
              <button
                data-tv-pill={isTv ? 'true' : undefined}
                onClick={() => {
                  onToggleFavorite(item);
                  bumpControls();
                }}
                title={item.isFavorite ? t.removeFromMyList : t.addToMyList}
                className={
                  isTv
                    ? `rounded-full border border-white/20 bg-[#141828]/95 p-3 shadow-xl ${
                        item.isFavorite ? 'text-rose-400' : 'text-zinc-100'
                      }`
                    : `rounded-lg p-1.5 sm:p-2 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400 ${
                        item.isFavorite ? 'text-rose-400' : 'text-zinc-200'
                      }`
                }
              >
                <Heart
                  className={`${isTv ? 'h-5 w-5' : 'h-4 w-4 sm:h-5 sm:w-5'} ${
                    item.isFavorite ? 'fill-rose-400' : ''
                  }`}
                />
              </button>
            )}

            {/* Dedicated 1-Click Quality Pill on Smart TV */}
            {isTv && !offlineQualityLabel && (
              <button
                ref={tvDirectQualityBtnRef}
                data-tv-pill="true"
                onClick={() => {
                  if (showQualityMenu && settingsPanel === 'quality' && openedQualityDirectlyRef.current) {
                    setShowQualityMenu(false);
                  } else {
                    openedQualityDirectlyRef.current = true;
                    setSettingsPanel('quality');
                    setShowQualityMenu(true);
                    setShowSubMenu(false);
                    setShowChaptersMenu(false);
                  }
                  bumpControls();
                }}
                title={t.streamQuality}
                className="flex items-center gap-2 rounded-full border border-white/25 bg-[#141828]/95 px-5 py-3 text-sm font-bold text-white shadow-xl"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    isLosslessVideo ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <span>{verifiedQualityPillLabel}</span>
              </button>
            )}

            {/* Unified Settings Menu (Quality, Aspect Ratio, Playback Speed, Repeat Mode, Playback Info) */}
            <div className="relative">
              <button
                ref={qualityBtnRef}
                data-tv-pill={isTv ? 'true' : undefined}
                onClick={() => {
                  if (showQualityMenu && (!openedQualityDirectlyRef.current || !isTv)) {
                    setShowQualityMenu(false);
                  } else {
                    openedQualityDirectlyRef.current = false;
                    setSettingsPanel('root');
                    setShowQualityMenu(true);
                    setShowSubMenu(false);
                    setShowChaptersMenu(false);
                  }
                  bumpControls();
                }}
                title={t.playbackSettings}
                className={
                  isTv
                    ? 'flex items-center gap-2 rounded-full border border-white/20 bg-[#141828]/95 px-5 py-3 text-sm font-bold text-white shadow-xl'
                    : 'flex items-center gap-1.5 rounded-xl bg-white/15 px-2 py-1.5 sm:px-2.5 text-[11px] sm:text-xs font-semibold text-white transition hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-violet-400'
                }
              >
                {offlineQualityLabel ? (
                  <>
                    <HardDrive className={isTv ? 'h-5 w-5 text-emerald-400' : 'h-4 w-4 text-emerald-400'} />
                    <span className="max-w-[96px] truncate sm:max-w-none">
                      Offline · {offlineQualityLabel}
                    </span>
                  </>
                ) : (
                  <>
                    <Settings className={isTv ? 'h-5 w-5' : 'h-4 w-4 text-violet-300'} />
                    <span className="max-w-[112px] truncate sm:max-w-none">
                      {isTv ? t.settings : verifiedQualityPillLabel}
                    </span>
                  </>
                )}
              </button>
              {showQualityMenu && (
                <div
                  data-tv-player-menu="true"
                  className={`fixed inset-x-3 bottom-20 z-40 max-h-[68dvh] overflow-y-auto rounded-2xl border border-white/20 p-2.5 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-16 sm:right-0 sm:rounded-2xl ${
                    isTv ? 'sm:w-[26rem] bg-[#0e111d] p-4' : 'sm:w-80 bg-surface/95 backdrop-blur-xl'
                  }`}
                >
                  {settingsPanel === 'root' && (
                    <>
                      <div className="flex items-center justify-between px-3 py-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                          {t.playbackSettings}
                        </span>
                        {isTv ? (
                          <span className="text-[10px] font-medium text-zinc-400">{t.backToClose}</span>
                        ) : (
                          <button
                            onClick={() => setShowQualityMenu(false)}
                            className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white sm:hidden"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        <button
                          onClick={() => setSettingsPanel('quality')}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs text-white transition hover:bg-white/10"
                        >
                          <span className="font-semibold">{t.streamQuality}</span>
                          <span className="flex items-center gap-1 text-zinc-300">
                            {verifiedQualityPillLabel}
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </button>

                        <button
                          onClick={() => setSettingsPanel('aspect')}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs text-white transition hover:bg-white/10"
                        >
                          <span className="font-semibold">{t.aspectRatio}</span>
                          <span className="flex items-center gap-1 text-zinc-400">
                            {activeAspectLabel}
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </button>

                        <button
                          onClick={() => setSettingsPanel('speed')}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs text-white transition hover:bg-white/10"
                        >
                          <span className="font-semibold">{t.playbackSpeed}</span>
                          <span className="flex items-center gap-1 text-zinc-400">
                            {playbackSpeed}x
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </button>

                        <button
                          onClick={() => setSettingsPanel('repeat')}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs text-white transition hover:bg-white/10"
                        >
                          <span className="font-semibold">{t.repeatMode}</span>
                          <span className="flex items-center gap-1 text-zinc-400">
                            {repeatMode === 'one' ? t.repeatOne : t.repeatNone}
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </button>

                        <div className="my-1 border-t border-white/10" />

                        <button
                          onClick={() => {
                            setShowPlaybackInfo(!showPlaybackInfo);
                            setShowQualityMenu(false);
                          }}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs text-white transition hover:bg-white/10"
                        >
                          <span className="flex items-center gap-2 font-semibold">
                            <Info className="h-3.5 w-3.5 text-violet-300" />
                            {t.playbackInfo}
                          </span>
                          <span className={showPlaybackInfo ? 'font-bold text-violet-300' : 'text-zinc-400'}>
                            {showPlaybackInfo ? t.on : t.off}
                          </span>
                        </button>
                      </div>
                    </>
                  )}

                  {settingsPanel === 'aspect' && (
                    <>
                      <button
                        onClick={() => setSettingsPanel('root')}
                        className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-white/10"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        {t.aspectRatio}
                      </button>
                      {aspectRatioOptions.map((opt) => {
                        const selected = aspectRatio === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => {
                              setAspectRatio(opt.id);
                              setShowQualityMenu(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition ${
                              selected ? 'bg-violet-600 text-white' : 'text-zinc-200 hover:bg-white/10'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold">{opt.label}</div>
                              <div className="text-[11px] opacity-80">{opt.description}</div>
                            </div>
                            {selected && <Check className="h-4 w-4 flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </>
                  )}

                  {settingsPanel === 'speed' && (
                    <>
                      <button
                        onClick={() => setSettingsPanel('root')}
                        className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-white/10"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        {t.playbackSpeed}
                      </button>
                      {PLAYBACK_SPEEDS.map((spd) => {
                        const selected = playbackSpeed === spd;
                        return (
                          <button
                            key={spd}
                            onClick={() => {
                              setPlaybackSpeed(spd);
                              setShowQualityMenu(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition ${
                              selected ? 'bg-violet-600 text-white' : 'text-zinc-200 hover:bg-white/10'
                            }`}
                          >
                            <span>{spd === 1 ? t.normalSpeed : `${spd}x`}</span>
                            {selected && <Check className="h-4 w-4 flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </>
                  )}

                  {settingsPanel === 'repeat' && (
                    <>
                      <button
                        onClick={() => setSettingsPanel('root')}
                        className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-white/10"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        {t.repeatMode}
                      </button>
                      {(
                        [
                          { id: 'none', label: t.repeatNone, desc: t.repeatNoneDesc },
                          { id: 'one', label: t.repeatOne, desc: t.repeatOneDesc },
                        ] as const
                      ).map((opt) => {
                        const selected = repeatMode === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => {
                              setRepeatMode(opt.id);
                              setShowQualityMenu(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition ${
                              selected ? 'bg-violet-600 text-white' : 'text-zinc-200 hover:bg-white/10'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold">{opt.label}</div>
                              <div className="text-[11px] opacity-80">{opt.desc}</div>
                            </div>
                            {selected && <Check className="h-4 w-4 flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </>
                  )}

                  {settingsPanel === 'quality' && (
                    <>
                      {openedQualityDirectlyRef.current ? (
                        <div className="mb-1.5 flex items-center justify-between px-2 py-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                            {t.streamQuality}
                          </span>
                          <span className="text-[10px] font-medium text-zinc-400">{t.backToClose}</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSettingsPanel('root')}
                          className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-white/10"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                          {t.streamQuality}
                        </button>
                      )}

                      {/* Verified Source & Live Network Diagnostics Strip */}
                      <div className="mx-1 mb-2 space-y-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-zinc-300">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-semibold text-white truncate">
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
                            {bufferAheadSec > 0 ? `${bufferAheadSec}s buffer` : loading ? t.buffering : 'Live'}
                          </span>
                        </div>
                        {playback && (
                          <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                            <span className="truncate">
                              {decodedSize
                                ? `${t.decodedOutput}: ${decodedSize.width}×${decodedSize.height}`
                                : playback.sourceWidth && playback.sourceHeight
                                ? `${t.sourceFile}: ${playback.sourceWidth}×${playback.sourceHeight}`
                                : t.verifyingFrame}
                              {sourceMbpsLabel ? ` · ${sourceMbpsLabel}` : ''}
                            </span>
                            {playMethodLabel && (
                              <span
                                className={`font-bold ${
                                  isLosslessVideo ? 'text-emerald-300' : 'text-amber-300'
                                }`}
                              >
                                {playMethodLabel}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* On Mobile/Web, show Auto (Stability First) above manual presets */}
                      {!isTv && (
                        <>
                          <button
                            onClick={handleEnableAutoStability}
                            className={`mb-1 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                              autoStability
                                ? 'bg-violet-600 text-white'
                                : 'text-zinc-200 hover:bg-white/10'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold">{t.autoStabilityTitle}</div>
                              <div className="text-[11px] opacity-85">
                                {t.autoStabilityDesc} ({activeQualityLabel})
                              </div>
                            </div>
                            {autoStability && <Check className="h-4 w-4 flex-shrink-0" />}
                          </button>
                          <div className="my-1 border-t border-white/10" />
                        </>
                      )}

                      {availableQualityOptions.map((opt) => {
                        const isSelectedManual = !autoStability && quality === opt.id;
                        const isActiveAuto = autoStability && quality === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => handleQualityChange(opt.id)}
                            className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                              isSelectedManual
                                ? 'bg-violet-600 text-white'
                                : isActiveAuto
                                ? 'bg-white/10 text-white'
                                : 'text-zinc-200 hover:bg-white/10'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold">{opt.label}</div>
                              <div className="text-[11px] opacity-85">{opt.description}</div>
                            </div>
                            {isSelectedManual && <Check className="h-4 w-4 flex-shrink-0" />}
                          </button>
                        );
                      })}

                      {/* On Smart TV, Original is #1 default; Auto Adaptive sits below as an optional fallback */}
                      {isTv && (
                        <>
                          <div className="my-1.5 border-t border-white/10" />
                          <button
                            onClick={handleEnableAutoStability}
                            className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                              autoStability
                                ? 'bg-violet-600 text-white'
                                : 'text-zinc-200 hover:bg-white/10'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold">{t.autoTvHotspotTitle}</div>
                              <div className="text-[11px] opacity-85">
                                {t.autoTvHotspotDesc}
                              </div>
                            </div>
                            {autoStability && <Check className="h-4 w-4 flex-shrink-0" />}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Audio & Subtitles */}
            {hasAudioOrSubs && playback && (
              <div className="relative">
                <button
                  ref={subBtnRef}
                  data-tv-pill={isTv ? 'true' : undefined}
                  onClick={() => {
                    setShowSubMenu(!showSubMenu);
                    setShowQualityMenu(false);
                    bumpControls();
                  }}
                  title={t.audioAndSubtitles}
                  className={
                    isTv
                      ? 'flex items-center gap-2 rounded-full border border-white/20 bg-[#141828]/95 px-5 py-3 text-sm font-bold text-white shadow-xl'
                      : `flex items-center gap-1.5 rounded-xl p-1.5 sm:p-2 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-400 ${
                          activeSubtitleIndex !== null ? 'text-violet-300' : 'text-white'
                        }`
                  }
                >
                  <Subtitles className={isTv ? 'h-5 w-5' : 'h-4 w-4 sm:h-5 sm:w-5'} />
                  {isTv && <span>{t.audioAndSubtitles}</span>}
                </button>
                {showSubMenu && (
                  <div
                    data-tv-player-menu="true"
                    className={`fixed inset-x-3 bottom-20 z-40 max-h-[68dvh] overflow-y-auto rounded-2xl border border-white/20 p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-16 sm:right-0 sm:max-h-[70vh] sm:rounded-2xl sm:p-3 ${
                      isTv ? 'bg-[#0e111d]' : 'bg-surface/95 backdrop-blur-xl'
                    } ${
                      playback.audioTracks.length > 0 && playback.subtitles.length > 0
                        ? 'grid grid-cols-1 gap-3 sm:w-[36rem] sm:max-w-[calc(100vw-2rem)] sm:grid-cols-2'
                        : 'sm:w-80'
                    }`}
                  >
                    {/* Mobile sheet header */}
                    <div className="flex items-center justify-between border-b border-white/10 pb-2 sm:hidden">
                      <span className="text-xs font-bold text-white">{t.audioAndSubtitles}</span>
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
                          {t.audioLabel}
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
                                <span className="truncate">
                                  {localizeTrackLabel(track.label, track.language, lang)}
                                </span>
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
                          {t.subtitlesLabel}
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
                            <span>{t.off}</span>
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
                                <span className="truncate">
                                  {localizeTrackLabel(sub.label, sub.language, lang)}
                                </span>
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

                    {/* Subtitle Appearance & Timing Sync Strip (Size · Style · Offset) */}
                    {playback.subtitles.length > 0 && (
                      <div className="col-span-full mt-1 border-t border-white/10 pt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-1">
                          <span className="mr-1 font-bold uppercase tracking-wider text-zinc-400">
                            {t.sizeLabel}
                          </span>
                          {(
                            [
                              { id: 'sm', label: 'S' },
                              { id: 'md', label: 'M' },
                              { id: 'lg', label: 'L' },
                              { id: 'xl', label: 'XL' },
                            ] as Array<{ id: SubtitleSize; label: string }>
                          ).map((sz) => (
                            <button
                              key={sz.id}
                              onClick={() => updateSubtitlePrefs({ size: sz.id })}
                              className={`rounded-md px-2 py-1 font-bold transition ${
                                subtitlePrefs.size === sz.id
                                  ? 'bg-violet-600 text-white'
                                  : 'bg-white/5 text-zinc-300 hover:bg-white/15'
                              }`}
                            >
                              {sz.label}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-1">
                          <span className="mr-1 font-bold uppercase tracking-wider text-zinc-400">
                            {t.styleLabel}
                          </span>
                          {(
                            [
                              { id: 'pill', label: t.stylePill },
                              { id: 'outline', label: t.styleOutline },
                              { id: 'box', label: t.styleBox },
                            ] as Array<{ id: SubtitleStyle; label: string }>
                          ).map((st) => (
                            <button
                              key={st.id}
                              onClick={() => updateSubtitlePrefs({ style: st.id })}
                              className={`rounded-md px-2 py-1 font-semibold transition ${
                                subtitlePrefs.style === st.id
                                  ? 'bg-violet-600 text-white'
                                  : 'bg-white/5 text-zinc-300 hover:bg-white/15'
                              }`}
                            >
                              {st.label}
                            </button>
                          ))}
                        </div>

                        {activeTextSubIndex !== null && (
                          <div className="flex items-center gap-1">
                            <span className="mr-1 font-bold uppercase tracking-wider text-zinc-400">
                              {t.syncLabel}
                            </span>
                            <button
                              onClick={() =>
                                setSubtitleOffsetSec((v) =>
                                  Math.max(-5, Math.round((v - 0.25) * 100) / 100)
                                )
                              }
                              className="rounded-md bg-white/5 px-2 py-1 font-mono font-bold text-zinc-200 hover:bg-white/15"
                            >
                              -0.25s
                            </button>
                            <button
                              onClick={() => setSubtitleOffsetSec(0)}
                              title="Reset sync offset"
                              className={`rounded-md px-2 py-1 font-mono font-bold transition ${
                                subtitleOffsetSec !== 0
                                  ? 'bg-violet-600/30 text-violet-200'
                                  : 'bg-white/5 text-zinc-300'
                              }`}
                            >
                              {subtitleOffsetSec > 0
                                ? `+${subtitleOffsetSec.toFixed(2)}s`
                                : `${subtitleOffsetSec.toFixed(2)}s`}
                            </button>
                            <button
                              onClick={() =>
                                setSubtitleOffsetSec((v) =>
                                  Math.min(5, Math.round((v + 0.25) * 100) / 100)
                                )
                              }
                              className="rounded-md bg-white/5 px-2 py-1 font-mono font-bold text-zinc-200 hover:bg-white/15"
                            >
                              +0.25s
                            </button>
                          </div>
                        )}
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
