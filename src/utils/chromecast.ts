// Google Cast (Chromecast) Web Sender SDK + Safari AirPlay helper

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

export interface CastSubtitlePayload {
  id: number;
  label: string;
  language: string;
  url: string;
}

export interface CastMediaPayload {
  streamUrl: string;
  isHls: boolean;
  title: string;
  subtitle?: string;
  posterUrl?: string;
  currentTime?: number;
  subtitles?: CastSubtitlePayload[];
  activeSubtitleId?: number | null;
}

export interface CastState {
  isConnected: boolean;
  deviceName: string | null;
  isPaused: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volumeLevel: number;
  isMuted: boolean;
}

let initialized = false;
let sdkAvailable = false;
let remotePlayer: any = null;
let remoteController: any = null;

const availabilityListeners = new Set<(available: boolean) => void>();
const stateListeners = new Set<(state: CastState) => void>();

function notifyAvailability() {
  availabilityListeners.forEach((cb) => cb(sdkAvailable));
}

function getCurrentCastState(): CastState {
  try {
    const context = window.cast?.framework?.CastContext?.getInstance?.();
    const session = context?.getCurrentSession?.();
    const isConnected = Boolean(session && remotePlayer?.isConnected);
    const playerState = remotePlayer?.playerState;
    return {
      isConnected,
      deviceName: isConnected ? session?.getCastDevice?.()?.friendlyName || 'Chromecast' : null,
      isPaused: Boolean(remotePlayer?.isPaused),
      isBuffering: playerState === 'BUFFERING',
      currentTime: Number(remotePlayer?.currentTime) || 0,
      duration: Number(remotePlayer?.duration) || 0,
      volumeLevel: typeof remotePlayer?.volumeLevel === 'number' ? remotePlayer.volumeLevel : 1,
      isMuted: Boolean(remotePlayer?.isMuted),
    };
  } catch {
    return {
      isConnected: false,
      deviceName: null,
      isPaused: false,
      isBuffering: false,
      currentTime: 0,
      duration: 0,
      volumeLevel: 1,
      isMuted: false,
    };
  }
}

function notifyState() {
  const snapshot = getCurrentCastState();
  stateListeners.forEach((cb) => cb(snapshot));
}

function setupCastContext() {
  if (initialized || !window.cast?.framework || !window.chrome?.cast) return;
  try {
    const context = window.cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });

    remotePlayer = new window.cast.framework.RemotePlayer();
    remoteController = new window.cast.framework.RemotePlayerController(remotePlayer);
    remoteController.addEventListener(
      window.cast.framework.RemotePlayerEventType.ANY_CHANGE,
      notifyState
    );

    initialized = true;
    sdkAvailable = true;
    notifyAvailability();
    notifyState();
  } catch {
    // Ignore if browser blocks Cast SDK
  }
}

export function initCastSdk(
  onAvailabilityChange: (available: boolean) => void,
  onStateChange?: (state: CastState) => void
): () => void {
  availabilityListeners.add(onAvailabilityChange);
  if (onStateChange) stateListeners.add(onStateChange);

  if (window.cast?.framework && window.chrome?.cast) {
    setupCastContext();
  } else {
    const prev = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (prev) prev(isAvailable);
      if (isAvailable) setupCastContext();
      else {
        sdkAvailable = false;
        notifyAvailability();
      }
    };
  }

  onAvailabilityChange(sdkAvailable);
  if (onStateChange) onStateChange(getCurrentCastState());

  return () => {
    availabilityListeners.delete(onAvailabilityChange);
    if (onStateChange) stateListeners.delete(onStateChange);
  };
}

export async function startChromecast(payload: CastMediaPayload): Promise<string | null> {
  if (!window.cast?.framework || !window.chrome?.cast) {
    throw new Error('Chromecast is supported in Google Chrome and Microsoft Edge.');
  }

  setupCastContext();
  const context = window.cast.framework.CastContext.getInstance();
  let session = context.getCurrentSession();

  if (!session) {
    await context.requestSession();
    session = context.getCurrentSession();
  }

  if (!session) return null;

  const contentType = payload.isHls ? 'application/x-mpegURL' : 'video/mp4';
  const mediaInfo = new window.chrome.cast.media.MediaInfo(payload.streamUrl, contentType);
  mediaInfo.streamType = window.chrome.cast.media.StreamType.BUFFERED;

  // Explicitly declare MPEG-TS HLS format so Chromecast Shaka receiver doesn't stall every ~30s
  if (payload.isHls) {
    if (window.chrome.cast.media.HlsSegmentFormat?.TS) {
      mediaInfo.hlsSegmentFormat = window.chrome.cast.media.HlsSegmentFormat.TS;
    }
    if (window.chrome.cast.media.HlsVideoSegmentFormat?.MPEG2_TS) {
      mediaInfo.hlsVideoSegmentFormat = window.chrome.cast.media.HlsVideoSegmentFormat.MPEG2_TS;
    }
  }

  const metadata = new window.chrome.cast.media.GenericMediaMetadata();
  metadata.title = payload.title;
  if (payload.subtitle) metadata.subtitle = payload.subtitle;
  if (payload.posterUrl) {
    metadata.images = [new window.chrome.cast.Image(payload.posterUrl)];
  }
  mediaInfo.metadata = metadata;

  // Attach WebVTT text subtitles natively for Chromecast
  const activeTrackIds: number[] = [];
  if (payload.subtitles && payload.subtitles.length > 0) {
    mediaInfo.tracks = payload.subtitles.map((sub) => {
      const track = new window.chrome.cast.media.Track(
        sub.id,
        window.chrome.cast.media.TrackType.TEXT
      );
      track.trackContentId = sub.url;
      track.trackContentType = 'text/vtt';
      track.subtype = window.chrome.cast.media.TextTrackType.SUBTITLES;
      track.name = sub.label;
      track.language = sub.language;
      if (payload.activeSubtitleId === sub.id) {
        activeTrackIds.push(sub.id);
      }
      return track;
    });
  }

  const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
  request.autoplay = true;
  if (activeTrackIds.length > 0) {
    request.activeTrackIds = activeTrackIds;
  }
  if (payload.currentTime && payload.currentTime > 1) {
    request.currentTime = payload.currentTime;
  }

  await session.loadMedia(request);
  notifyState();
  return session.getCastDevice()?.friendlyName || 'Chromecast';
}

export function stopChromecast(): void {
  try {
    const context = window.cast?.framework?.CastContext?.getInstance?.();
    const session = context?.getCurrentSession?.();
    if (session) {
      session.endSession(true);
    }
    notifyState();
  } catch {
    // Ignore
  }
}

export function toggleChromecastPlayPause(): void {
  try {
    if (remoteController && remotePlayer?.canPause) {
      remoteController.playOrPause();
    } else if (remoteController) {
      remoteController.playOrPause();
    }
  } catch {
    // Ignore
  }
}

export function seekChromecast(seconds: number): void {
  try {
    if (!remoteController || !remotePlayer) return;
    remotePlayer.currentTime = Math.max(0, seconds);
    remoteController.seek();
    notifyState();
  } catch {
    // Ignore
  }
}

export function setChromecastVolume(level: number): void {
  try {
    if (!remoteController || !remotePlayer) return;
    remotePlayer.volumeLevel = Math.max(0, Math.min(1, level));
    remoteController.setVolumeLevel();
  } catch {
    // Ignore
  }
}

export function toggleChromecastMute(): void {
  try {
    if (!remoteController) return;
    remoteController.muteOrUnmute();
  } catch {
    // Ignore
  }
}

export function setChromecastActiveSubtitle(trackId: number | null): void {
  try {
    const context = window.cast?.framework?.CastContext?.getInstance?.();
    const session = context?.getCurrentSession?.();
    const media = session?.getMediaSession?.();
    if (!media || !window.chrome?.cast?.media?.EditTracksInfoRequest) return;
    const req = new window.chrome.cast.media.EditTracksInfoRequest(
      trackId !== null ? [trackId] : []
    );
    media.editTracksInfo(req, () => {}, () => {});
  } catch {
    // Ignore
  }
}

export function supportsAirPlay(video: HTMLVideoElement | null): boolean {
  return Boolean(video && typeof (video as any).webkitShowPlaybackTargetPicker === 'function');
}

export function showAirPlayPicker(video: HTMLVideoElement | null): void {
  if (video && typeof (video as any).webkitShowPlaybackTargetPicker === 'function') {
    (video as any).webkitShowPlaybackTargetPicker();
  }
}
