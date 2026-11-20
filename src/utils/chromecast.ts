// Google Cast (Chromecast) Web Sender SDK + Safari AirPlay helper

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

export interface CastMediaPayload {
  streamUrl: string;
  isHls: boolean;
  title: string;
  subtitle?: string;
  posterUrl?: string;
  currentTime?: number;
}

let initialized = false;
let sdkAvailable = false;
const listeners = new Set<(available: boolean) => void>();

function notify() {
  listeners.forEach((cb) => cb(sdkAvailable));
}

function setupCastContext() {
  if (initialized || !window.cast?.framework || !window.chrome?.cast) return;
  try {
    const context = window.cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    initialized = true;
    sdkAvailable = true;
    notify();
  } catch {
    // Ignore if browser blocks Cast SDK
  }
}

export function initCastSdk(onAvailabilityChange: (available: boolean) => void): () => void {
  listeners.add(onAvailabilityChange);

  if (window.cast?.framework && window.chrome?.cast) {
    setupCastContext();
  } else {
    const prev = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (prev) prev(isAvailable);
      if (isAvailable) setupCastContext();
      else {
        sdkAvailable = false;
        notify();
      }
    };
  }

  onAvailabilityChange(sdkAvailable);
  return () => {
    listeners.delete(onAvailabilityChange);
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

  const metadata = new window.chrome.cast.media.GenericMediaMetadata();
  metadata.title = payload.title;
  if (payload.subtitle) metadata.subtitle = payload.subtitle;
  if (payload.posterUrl) {
    metadata.images = [new window.chrome.cast.Image(payload.posterUrl)];
  }
  mediaInfo.metadata = metadata;

  const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
  request.autoplay = true;
  if (payload.currentTime && payload.currentTime > 1) {
    request.currentTime = payload.currentTime;
  }

  await session.loadMedia(request);
  return session.getCastDevice()?.friendlyName || 'Chromecast';
}

export function stopChromecast(): void {
  try {
    const context = window.cast?.framework?.CastContext?.getInstance();
    const session = context?.getCurrentSession();
    if (session) {
      session.endSession(true);
    }
  } catch {
    // Ignore
  }
}

export function toggleChromecastPlayPause(): boolean {
  try {
    const player = new window.cast.framework.RemotePlayer();
    const controller = new window.cast.framework.RemotePlayerController(player);
    controller.playOrPause();
    return !player.isPaused;
  } catch {
    return false;
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
