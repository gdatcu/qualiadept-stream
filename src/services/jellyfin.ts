import { DEMO_EPISODES, DEMO_ITEMS, DEMO_SEASONS } from '../data/demoCatalog';
import {
  QUALITY_OPTIONS,
  type ActiveStreamSession,
  type AudioTrack,
  type AuthSession,
  type FamilyUser,
  type MediaItem,
  type MediaType,
  type ParentalTier,
  type PlaybackInfo,
  type PublicUserProfile,
  type QualityPreset,
  type SeasonItem,
  type SubtitleTrack,
} from '../types/media';
import { getDirectPlayVideoCodecs } from '../utils/network';

const SESSION_STORAGE_KEY = 'qualiadept_stream_session_v1';
const SAVED_PROFILES_KEY = 'qualiadept_stream_profiles_v1';
const LIBRARY_CACHE_PREFIX = 'qualiadept_library_cache_v1_';
const DEVICE_ID_KEY = 'qualiadept_stream_device_id';
const DEMO_FAVORITES_KEY = 'qualiadept_demo_favorites';

export class SessionExpiredError extends Error {
  constructor(message = 'Your session expired. Please sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Resilient fetch with an AbortController timeout (safe on all Android WebViews)
 * and automatic 1x retry on dropped mobile packets or transient 502/503/504 errors.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxRetries = options.retries ?? 1;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      window.clearTimeout(timer);
      if (attempt < maxRetries && (res.status === 502 || res.status === 503 || res.status === 504)) {
        await new Promise((r) => window.setTimeout(r, 700));
        continue;
      }
      return res;
    } catch (err) {
      window.clearTimeout(timer);
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => window.setTimeout(r, 700));
        continue;
      }
    }
  }
  if (lastError instanceof DOMException && lastError.name === 'AbortError') {
    throw new Error('Request timed out on this connection. Check signal and tap Retry.');
  }
  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

export function loadCachedLibrary(
  userId: string
): { items: MediaItem[]; resumeItems: MediaItem[] } | null {
  try {
    const raw = localStorage.getItem(`${LIBRARY_CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      items?: MediaItem[];
      resumeItems?: MediaItem[];
      ts?: number;
    };
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return {
      items: parsed.items,
      resumeItems: Array.isArray(parsed.resumeItems) ? parsed.resumeItems : [],
    };
  } catch {
    return null;
  }
}

export function saveCachedLibrary(
  userId: string,
  items: MediaItem[],
  resumeItems: MediaItem[]
): void {
  try {
    localStorage.setItem(
      `${LIBRARY_CACHE_PREFIX}${userId}`,
      JSON.stringify({
        items: items.slice(0, 250),
        resumeItems: resumeItems.slice(0, 20),
        ts: Date.now(),
      })
    );
  } catch {
    // Ignore quota errors on tight storage devices
  }
}

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function buildAuthHeader(token?: string): string {
  const base = `MediaBrowser Client="QualiadeptStream", Device="Web Browser", DeviceId="${getDeviceId()}", Version="1.0.0"`;
  return token ? `${base}, Token="${token}"` : base;
}

export function normalizeServerUrl(url: string): string {
  let clean = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }
  return clean;
}

export function loadSavedProfiles(): AuthSession[] {
  try {
    const raw = localStorage.getItem(SAVED_PROFILES_KEY);
    const list = raw ? (JSON.parse(raw) as AuthSession[]) : [];
    // Security: NEVER keep administrator tokens in the 1-tap device switcher vault.
    // Non-admin family members can switch between their own profiles on a shared TV/tablet,
    // while switching into an admin account always requires entering the admin password.
    const safeNonAdmin = list.filter(
      (p) => !p.isDemo && !p.isAdmin && Boolean(p.accessToken) && Boolean(p.userId)
    );
    if (safeNonAdmin.length !== list.length) {
      localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify(safeNonAdmin));
    }
    const current = loadSavedSession();
    if (
      current &&
      !current.isDemo &&
      !current.isAdmin &&
      !safeNonAdmin.some((p) => p.userId === current.userId)
    ) {
      const merged = [current, ...safeNonAdmin];
      localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify(merged));
      return merged;
    }
    return safeNonAdmin;
  } catch {
    return [];
  }
}

export function upsertSavedProfile(session: AuthSession): void {
  if (session.isDemo) return;
  try {
    const existing = loadSavedProfiles().filter((p) => p.userId !== session.userId);
    // Never cache administrator sessions in the 1-tap switcher
    if (session.isAdmin) {
      localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify(existing));
      return;
    }
    localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify([session, ...existing]));
  } catch {
    // Ignore storage errors
  }
}

export function removeSavedProfile(userId: string): void {
  try {
    const remaining = loadSavedProfiles().filter((p) => p.userId !== userId);
    localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify(remaining));
  } catch {
    // Ignore storage errors
  }
}

export function loadSavedSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  if (!session.isDemo) {
    upsertSavedProfile(session);
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function createDemoSession(): AuthSession {
  const session: AuthSession = {
    serverUrl: 'https://media.qualiadept.eu',
    accessToken: 'demo-token',
    userId: 'demo-user',
    username: 'Guest Preview',
    isDemo: true,
    isAdmin: false,
  };
  saveSession(session);
  return session;
}

export async function authenticateJellyfin(
  serverUrl: string,
  username: string,
  password: string
): Promise<AuthSession> {
  const cleanUrl = normalizeServerUrl(serverUrl);
  const res = await fetchWithRetry(
    `${cleanUrl}/Users/AuthenticateByName`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildAuthHeader(),
      },
      body: JSON.stringify({
        Username: username.trim(),
        Pw: password,
      }),
    },
    { timeoutMs: 12_000, retries: 1 }
  );

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Invalid username or password.');
    }
    if (res.status === 403) {
      throw new Error(
        'Access denied (HTTP 403). Make sure this account is active and has Remote Access enabled.'
      );
    }
    if (res.status >= 500) {
      throw new Error(
        `Media server error (HTTP ${res.status}). Jellyfin may be restarting or out of cache space — wait 30s and retry.`
      );
    }
    throw new Error(`Could not connect to ${cleanUrl} (HTTP ${res.status}).`);
  }

  const data = await res.json();
  const session: AuthSession = {
    serverUrl: cleanUrl,
    accessToken: data.AccessToken,
    userId: data.User.Id,
    username: data.User.Name,
    isDemo: false,
    isAdmin: Boolean(data.User?.Policy?.IsAdministrator),
  };
  saveSession(session);
  return session;
}

/**
 * Refreshes user metadata (including IsAdministrator) from Jellyfin so already-signed-in
 * admin sessions automatically unlock the Family Manager without re-entering credentials.
 */
export async function refreshSessionProfile(session: AuthSession): Promise<AuthSession> {
  if (session.isDemo) return session;
  try {
    const res = await fetch(`${session.serverUrl}/Users/Me`, {
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    });
    if (!res.ok) return session;
    const data = await res.json();
    const updated: AuthSession = {
      ...session,
      username: data.Name || session.username,
      isAdmin: Boolean(data.Policy?.IsAdministrator),
    };
    saveSession(updated);
    return updated;
  } catch {
    return session;
  }
}

export async function fetchPublicUsers(serverUrl: string): Promise<PublicUserProfile[]> {
  try {
    const cleanUrl = normalizeServerUrl(serverUrl);
    const res = await fetch(`${cleanUrl}/Users/Public`);
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      Id: string;
      Name: string;
      HasPassword?: boolean;
      PrimaryImageTag?: string;
    }>;
    return data.map((u) => ({
      id: u.Id,
      name: u.Name,
      hasPassword: Boolean(u.HasPassword),
      avatarUrl: u.PrimaryImageTag
        ? `${cleanUrl}/Users/${u.Id}/Images/Primary?tag=${encodeURIComponent(u.PrimaryImageTag)}&quality=85`
        : undefined,
    }));
  } catch {
    return [];
  }
}

interface RawJellyfinItem {
  Id: string;
  Name: string;
  Type: string;
  Overview?: string;
  ProductionYear?: number;
  CommunityRating?: number;
  OfficialRating?: string;
  RunTimeTicks?: number;
  Genres?: string[];
  SeriesId?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ImageTags?: { Primary?: string };
  BackdropImageTags?: string[];
  ParentBackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  UserData?: {
    IsFavorite?: boolean;
    PlayedPercentage?: number;
    PlaybackPositionTicks?: number;
  };
}

function mapJellyfinItem(raw: RawJellyfinItem, session: AuthSession): MediaItem {
  const base = session.serverUrl;
  const token = encodeURIComponent(session.accessToken);

  const hasPrimary = Boolean(raw.ImageTags?.Primary);
  const hasBackdrop = Boolean(raw.BackdropImageTags && raw.BackdropImageTags.length > 0);
  const hasParentBackdrop = Boolean(
    raw.ParentBackdropItemId && raw.ParentBackdropImageTags?.length
  );

  const posterUrl = hasPrimary
    ? `${base}/Items/${raw.Id}/Images/Primary?fillHeight=600&fillWidth=400&quality=90&api_key=${token}`
    : hasBackdrop
    ? `${base}/Items/${raw.Id}/Images/Backdrop/0?fillHeight=600&fillWidth=400&quality=85&api_key=${token}`
    : '';

  let backdropUrl = posterUrl;
  if (hasBackdrop) {
    backdropUrl = `${base}/Items/${raw.Id}/Images/Backdrop/0?maxWidth=1920&quality=88&api_key=${token}`;
  } else if (hasParentBackdrop) {
    backdropUrl = `${base}/Items/${raw.ParentBackdropItemId}/Images/Backdrop/0?maxWidth=1920&quality=88&api_key=${token}`;
  }

  const runtimeMinutes = raw.RunTimeTicks
    ? Math.round(raw.RunTimeTicks / 10_000_000 / 60)
    : undefined;

  const resumePositionSeconds = raw.UserData?.PlaybackPositionTicks
    ? Math.floor(raw.UserData.PlaybackPositionTicks / 10_000_000)
    : undefined;

  return {
    id: raw.Id,
    name: raw.Name,
    type: (raw.Type as MediaType) || 'Movie',
    overview: raw.Overview || 'No description available.',
    year: raw.ProductionYear,
    rating: raw.CommunityRating ? Number(raw.CommunityRating.toFixed(1)) : undefined,
    officialRating: raw.OfficialRating,
    runtimeMinutes,
    runtimeTicks: raw.RunTimeTicks,
    genres: raw.Genres || [],
    posterUrl,
    backdropUrl,
    isFavorite: raw.UserData?.IsFavorite ?? false,
    playedPercentage: raw.UserData?.PlayedPercentage,
    resumePositionSeconds,
    seriesId: raw.SeriesId,
    seriesName: raw.SeriesName,
    seasonNumber: raw.ParentIndexNumber,
    episodeNumber: raw.IndexNumber,
  };
}

function getDemoFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(DEMO_FAVORITES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export async function fetchLibraryItems(session: AuthSession): Promise<MediaItem[]> {
  if (session.isDemo) {
    const favs = getDemoFavorites();
    return DEMO_ITEMS.map((item) => ({ ...item, isFavorite: favs.has(item.id) }));
  }

  const params = new URLSearchParams({
    IncludeItemTypes: 'Movie,Series',
    Recursive: 'true',
    SortBy: 'DateCreated,SortName',
    SortOrder: 'Descending',
    Fields: 'Overview,Genres,RunTimeTicks,OfficialRating,CommunityRating,UserData',
    Limit: '1000',
  });

  const res = await fetchWithRetry(
    `${session.serverUrl}/Users/${session.userId}/Items?${params.toString()}`,
    {
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    }
  );

  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) throw new Error(`Failed to fetch library (HTTP ${res.status})`);
  const data = await res.json();
  return (data.Items as RawJellyfinItem[]).map((raw) => mapJellyfinItem(raw, session));
}

export async function fetchResumeItems(session: AuthSession): Promise<MediaItem[]> {
  if (session.isDemo) {
    return DEMO_ITEMS.filter((i) => (i.playedPercentage ?? 0) > 0);
  }

  const params = new URLSearchParams({
    MediaTypes: 'Video',
    Limit: '20',
    Fields: 'Overview,Genres,RunTimeTicks,UserData',
  });

  const res = await fetchWithRetry(
    `${session.serverUrl}/Users/${session.userId}/Items/Resume?${params.toString()}`,
    {
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    }
  );

  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) return [];
  const data = await res.json();
  return (data.Items as RawJellyfinItem[]).map((raw) => mapJellyfinItem(raw, session));
}

export async function fetchSeasons(
  session: AuthSession,
  seriesId: string
): Promise<SeasonItem[]> {
  if (session.isDemo) {
    return DEMO_SEASONS[seriesId] || [];
  }

  const res = await fetchWithRetry(
    `${session.serverUrl}/Shows/${seriesId}/Seasons?userId=${session.userId}`,
    {
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    }
  );

  if (!res.ok) return [];
  const data = await res.json();
  return (data.Items || []).map((s: { Id: string; Name: string; IndexNumber?: number }) => ({
    id: s.Id,
    name: s.Name,
    seasonNumber: s.IndexNumber ?? 1,
  }));
}

export async function fetchEpisodes(
  session: AuthSession,
  seriesId: string,
  seasonId: string
): Promise<MediaItem[]> {
  if (session.isDemo) {
    return DEMO_EPISODES[seasonId] || [];
  }

  const params = new URLSearchParams({
    seasonId,
    userId: session.userId,
    Fields: 'Overview,RunTimeTicks,UserData',
  });

  const res = await fetchWithRetry(
    `${session.serverUrl}/Shows/${seriesId}/Episodes?${params.toString()}`,
    {
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    }
  );

  if (!res.ok) return [];
  const data = await res.json();
  return (data.Items as RawJellyfinItem[]).map((raw) => mapJellyfinItem(raw, session));
}

export async function toggleFavorite(
  session: AuthSession,
  itemId: string,
  currentlyFavorite: boolean
): Promise<boolean> {
  if (session.isDemo) {
    const favs = getDemoFavorites();
    if (currentlyFavorite) favs.delete(itemId);
    else favs.add(itemId);
    localStorage.setItem(DEMO_FAVORITES_KEY, JSON.stringify([...favs]));
    return !currentlyFavorite;
  }

  const method = currentlyFavorite ? 'DELETE' : 'POST';
  const res = await fetch(
    `${session.serverUrl}/Users/${session.userId}/FavoriteItems/${itemId}`,
    {
      method,
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    }
  );

  if (!res.ok) throw new Error('Failed to update My List');
  return !currentlyFavorite;
}

export async function fetchNextEpisode(
  session: AuthSession,
  currentItem: MediaItem
): Promise<MediaItem | null> {
  if (currentItem.type !== 'Episode' || !currentItem.seriesId) return null;

  if (session.isDemo) {
    const allDemoEps = Object.values(DEMO_EPISODES).flat();
    const idx = allDemoEps.findIndex((e) => e.id === currentItem.id);
    if (idx >= 0 && idx + 1 < allDemoEps.length) {
      return allDemoEps[idx + 1];
    }
    return null;
  }

  try {
    const params = new URLSearchParams({
      userId: session.userId,
      Fields: 'Overview,RunTimeTicks,UserData',
    });
    const res = await fetch(
      `${session.serverUrl}/Shows/${currentItem.seriesId}/Episodes?${params.toString()}`,
      {
        headers: { Authorization: buildAuthHeader(session.accessToken) },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const episodes = (data.Items as RawJellyfinItem[]).map((raw) =>
      mapJellyfinItem(raw, session)
    );
    const idx = episodes.findIndex((e) => e.id === currentItem.id);
    if (idx >= 0 && idx + 1 < episodes.length) {
      return episodes[idx + 1];
    }
    return null;
  } catch {
    return null;
  }
}

export interface PlaybackOptions {
  audioStreamIndex?: number | null;
  /** Jellyfin stream index for an image-based subtitle (PGS/VobSub) to burn into the HLS stream */
  burnInSubtitleIndex?: number | null;
  /** Skip prefetch cache (e.g. manual Retry) so a brand new PlaySessionId is issued */
  bypassCache?: boolean;
  /** Force HLS transcoding/remuxing even if source could Direct Play (used when Direct Play stalls on mobile) */
  forceHls?: boolean;
}

interface PrefetchEntry {
  info: PlaybackInfo;
  ts: number;
}

const PREFETCH_TTL_MS = 45_000;
const playbackPrefetchCache = new Map<string, PrefetchEntry>();
const playbackInFlight = new Map<string, Promise<PlaybackInfo>>();

function buildPlaybackCacheKey(
  itemId: string,
  quality: QualityPreset,
  options: PlaybackOptions
): string {
  return `${itemId}:${quality}:${options.audioStreamIndex ?? 'def'}:${options.burnInSubtitleIndex ?? 'none'}:${options.forceHls ? 'hls' : 'any'}`;
}

interface RawMediaStream {
  Type: string;
  Index: number;
  DisplayTitle?: string;
  Language?: string;
  Title?: string;
  Codec?: string;
  Channels?: number;
  Width?: number;
  Height?: number;
  BitRate?: number;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsTextSubtitleStream?: boolean;
}

function formatAudioLabel(s: RawMediaStream): string {
  if (s.DisplayTitle) return s.DisplayTitle;
  const parts: string[] = [];
  if (s.Title) parts.push(s.Title);
  else if (s.Language) parts.push(s.Language.toUpperCase());
  else parts.push(`Track #${s.Index}`);
  if (s.Codec) parts.push(s.Codec.toUpperCase());
  if (s.Channels) parts.push(s.Channels === 6 ? '5.1' : s.Channels === 8 ? '7.1' : `${s.Channels}ch`);
  return parts.join(' · ');
}

function formatSubtitleLabel(s: RawMediaStream): string {
  if (s.DisplayTitle) return s.DisplayTitle;
  const parts: string[] = [];
  if (s.Title) parts.push(s.Title);
  else if (s.Language) parts.push(s.Language.toUpperCase());
  else parts.push(`Subtitle #${s.Index}`);
  if (s.IsForced) parts.push('Forced');
  return parts.join(' · ');
}

async function fetchPlaybackInfoUncached(
  session: AuthSession,
  item: MediaItem,
  quality: QualityPreset,
  options: PlaybackOptions
): Promise<PlaybackInfo> {
  if (session.isDemo) {
    const url = item.demoStreamUrl || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
    return {
      streamUrl: url,
      isHls: url.endsWith('.m3u8'),
      mediaSourceId: item.id,
      playSessionId: `demo-${Date.now()}`,
      audioTracks: [],
      defaultAudioIndex: null,
      subtitles: item.demoSubtitles || [],
    };
  }

  const preset = QUALITY_OPTIONS.find((q) => q.id === quality) || QUALITY_OPTIONS[0];
  const needsBurnIn = options.burnInSubtitleIndex !== undefined && options.burnInSubtitleIndex !== null;
  const hasExplicitAudio = options.audioStreamIndex !== undefined && options.audioStreamIndex !== null;
  const maxBitrate = preset.videoBitrate ?? 40_000_000;
  const allowDirectPlay = !needsBurnIn && !hasExplicitAudio && !options.forceHls;

  const playbackBody: Record<string, unknown> = {
    MaxStreamingBitrate: maxBitrate,
    EnableDirectPlay: allowDirectPlay,
    EnableDirectStream: allowDirectPlay,
    EnableTranscoding: true,
    AllowVideoStreamCopy: true,
    AllowAudioStreamCopy: true,
    DeviceProfile: {
      MaxStreamingBitrate: maxBitrate,
      DirectPlayProfiles: allowDirectPlay
        ? [
            {
              Container: 'mp4,m4v,webm',
              Type: 'Video',
              VideoCodec: getDirectPlayVideoCodecs(),
              AudioCodec: 'aac,mp3,opus',
            },
          ]
        : [],
      CodecProfiles: preset.maxWidth
        ? [
            {
              Type: 'Video',
              Codec: 'h264,hevc,vp9,av1,mpeg4,mpeg2video',
              Conditions: [
                {
                  Condition: 'LessThanEqual',
                  Property: 'Width',
                  Value: String(preset.maxWidth),
                  IsRequired: false,
                },
              ],
            },
          ]
        : [],
      TranscodingProfiles: [
        {
          Container: 'ts',
          Type: 'Video',
          VideoCodec: 'h264',
          AudioCodec: 'aac',
          Protocol: 'hls',
          Context: 'Streaming',
          MaxAudioChannels: '2',
          // Keep segments keyframe-aligned (BreakOnNonKeyFrames: false) so Android MSE never stalls waiting for an IDR frame
          SegmentLength: 4,
          MinSegments: 1,
          BreakOnNonKeyFrames: false,
        },
      ],
      SubtitleProfiles: [
        { Format: 'vtt', Method: 'External' },
        { Format: 'srt', Method: 'External' },
        { Format: 'ass', Method: 'External' },
        { Format: 'ssa', Method: 'External' },
        { Format: 'subrip', Method: 'External' },
        { Format: 'pgssub', Method: 'Encode' },
        { Format: 'dvdsub', Method: 'Encode' },
      ],
    },
  };

  if (hasExplicitAudio) {
    playbackBody.AudioStreamIndex = options.audioStreamIndex;
  }
  // Explicitly set SubtitleStreamIndex: -1 prevents Jellyfin from auto-burning a default PGS subtitle unless chosen
  playbackBody.SubtitleStreamIndex = needsBurnIn ? options.burnInSubtitleIndex : -1;

  const res = await fetchWithRetry(
    `${session.serverUrl}/Items/${item.id}/PlaybackInfo?UserId=${session.userId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildAuthHeader(session.accessToken),
      },
      body: JSON.stringify(playbackBody),
    },
    { timeoutMs: 15_000, retries: 1 }
  );

  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) throw new Error(`Playback info failed (HTTP ${res.status})`);
  const data = await res.json();
  const source = data.MediaSources?.[0];
  if (!source) throw new Error('No playable media source found.');

  const playSessionId: string = data.PlaySessionId || crypto.randomUUID();
  const mediaSourceId: string = source.Id;
  const token = encodeURIComponent(session.accessToken);
  const streams: RawMediaStream[] = source.MediaStreams || [];

  // Extract all Audio tracks
  const audioTracks: AudioTrack[] = streams
    .filter((s) => s.Type === 'Audio')
    .map((s) => ({
      index: s.Index,
      label: formatAudioLabel(s),
      language: s.Language || 'und',
      codec: s.Codec,
      channels: s.Channels,
      isDefault: Boolean(s.IsDefault),
    }));

  const defaultAudioIndex: number | null =
    typeof source.DefaultAudioStreamIndex === 'number'
      ? source.DefaultAudioStreamIndex
      : audioTracks.find((a) => a.isDefault)?.index ?? audioTracks[0]?.index ?? null;

  const effectiveAudioIndex = hasExplicitAudio ? options.audioStreamIndex! : defaultAudioIndex;

  // Extract ALL subtitles: text subtitles via WebVTT, bitmap subtitles (PGS/VobSub) via Jellyfin HLS burn-in
  const subtitles: SubtitleTrack[] = streams
    .filter((s) => s.Type === 'Subtitle')
    .map((s) => {
      const isText = Boolean(s.IsTextSubtitleStream);
      return {
        index: s.Index,
        label: formatSubtitleLabel(s),
        language: s.Language || 'und',
        isText,
        codec: s.Codec,
        isDefault: Boolean(s.IsDefault),
        isForced: Boolean(s.IsForced),
        url: isText
          ? `${session.serverUrl}/Videos/${item.id}/${mediaSourceId}/Subtitles/${s.Index}/0/Stream.vtt?api_key=${token}`
          : undefined,
      };
    });

  // Allow Direct Play whenever the native MP4/WebM source already fits within the selected quality cap
  // (avoids unnecessary ARM64 CPU transcoding on 5G for SD/720p videos while still capping high-bitrate 1080p/4K).
  const videoStream = streams.find((s) => s.Type === 'Video');
  const sourceBitrate: number | undefined =
    typeof source.Bitrate === 'number' ? source.Bitrate : videoStream?.BitRate;
  const sourceWidth: number | undefined = videoStream?.Width;
  const fitsSelectedQuality =
    quality === 'auto' ||
    ((!sourceBitrate || sourceBitrate <= maxBitrate) &&
      (!preset.maxWidth || !sourceWidth || sourceWidth <= preset.maxWidth));

  const isNonDefaultAudio =
    hasExplicitAudio && defaultAudioIndex !== null && options.audioStreamIndex !== defaultAudioIndex;
  const canDirectPlay =
    allowDirectPlay &&
    !isNonDefaultAudio &&
    fitsSelectedQuality &&
    source.SupportsDirectPlay &&
    ['mp4', 'm4v', 'webm'].includes((source.Container || '').toLowerCase());

  if (canDirectPlay) {
    return {
      streamUrl: `${session.serverUrl}/Videos/${item.id}/stream?static=true&mediaSourceId=${mediaSourceId}&api_key=${token}`,
      isHls: false,
      mediaSourceId,
      playSessionId,
      audioTracks,
      defaultAudioIndex,
      subtitles,
      sourceBitrate,
      sourceWidth,
    };
  }

  let hlsUrl: string;
  if (source.TranscodingUrl) {
    // Always prefer Jellyfin's server-negotiated TranscodingUrl (includes SegmentContainer, TranscodeReasons,
    // PlaySessionId, h264 profile/level, and remux/stream-copy decisions when source fits the bitrate/width cap).
    const parsed = new URL(source.TranscodingUrl, session.serverUrl);
    if (effectiveAudioIndex !== null && (hasExplicitAudio || !parsed.searchParams.has('AudioStreamIndex'))) {
      parsed.searchParams.set('AudioStreamIndex', String(effectiveAudioIndex));
    }
    if (needsBurnIn) {
      parsed.searchParams.set('SubtitleStreamIndex', String(options.burnInSubtitleIndex));
      parsed.searchParams.set('SubtitleMethod', 'Encode');
    } else {
      parsed.searchParams.delete('SubtitleStreamIndex');
      parsed.searchParams.delete('SubtitleMethod');
    }
    hlsUrl = parsed.toString();
  } else {
    const audioBitrate = 192_000;
    const videoBitrate = Math.max(400_000, (preset.videoBitrate ?? 12_000_000) - audioBitrate);
    const hlsParams = new URLSearchParams({
      MediaSourceId: mediaSourceId,
      PlaySessionId: playSessionId,
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      AudioBitrate: String(audioBitrate),
      VideoBitrate: String(videoBitrate),
      TranscodingMaxAudioChannels: '2',
      SegmentContainer: 'ts',
      SegmentLength: '4',
      MinSegments: '1',
      BreakOnNonKeyFrames: 'false',
      DeviceId: getDeviceId(),
      api_key: session.accessToken,
    });
    if (preset.maxWidth) {
      hlsParams.set('MaxWidth', String(preset.maxWidth));
    }
    if (effectiveAudioIndex !== null) {
      hlsParams.set('AudioStreamIndex', String(effectiveAudioIndex));
    }
    if (needsBurnIn) {
      hlsParams.set('SubtitleStreamIndex', String(options.burnInSubtitleIndex));
      hlsParams.set('SubtitleMethod', 'Encode');
    }
    hlsUrl = `${session.serverUrl}/Videos/${item.id}/master.m3u8?${hlsParams.toString()}`;
  }

  return {
    streamUrl: hlsUrl,
    isHls: true,
    mediaSourceId,
    playSessionId,
    audioTracks,
    defaultAudioIndex,
    subtitles,
    sourceBitrate,
    sourceWidth,
  };
}

/**
 * Warms Jellyfin PlaybackInfo in the background (while user views DetailModal or nears end of an episode)
 * so tapping Play starts with 0ms PlaybackInfo wait. For Direct Play MP4s, also warms the first 128 KB
 * (moov atom + Google Drive rclone VFS cache) without starting any server transcoding job.
 */
export function prefetchPlaybackInfo(
  session: AuthSession,
  item: MediaItem,
  quality: QualityPreset = 'auto'
): void {
  if (session.isDemo || item.type === 'Series') return;
  const key = buildPlaybackCacheKey(item.id, quality, {});
  const cached = playbackPrefetchCache.get(key);
  if (cached && Date.now() - cached.ts < PREFETCH_TTL_MS) return;
  if (playbackInFlight.has(key)) return;

  const promise = fetchPlaybackInfoUncached(session, item, quality, {})
    .then((info) => {
      playbackPrefetchCache.set(key, { info, ts: Date.now() });
      if (!info.isHls) {
        // Warm TCP/TLS + Google Drive rclone SSD cache with first 128 KB header range
        fetch(info.streamUrl, {
          headers: { Range: 'bytes=0-131071' },
        }).catch(() => {});
      }
      return info;
    })
    .finally(() => {
      playbackInFlight.delete(key);
    });

  playbackInFlight.set(key, promise);
  promise.catch(() => {});
}

export async function getPlaybackInfo(
  session: AuthSession,
  item: MediaItem,
  quality: QualityPreset = 'auto',
  options: PlaybackOptions = {}
): Promise<PlaybackInfo> {
  const key = buildPlaybackCacheKey(item.id, quality, options);

  if (!options.bypassCache) {
    const cached = playbackPrefetchCache.get(key);
    if (cached && Date.now() - cached.ts < PREFETCH_TTL_MS) {
      playbackPrefetchCache.delete(key);
      return cached.info;
    }
    const inFlight = playbackInFlight.get(key);
    if (inFlight) {
      const info = await inFlight;
      playbackPrefetchCache.delete(key);
      return info;
    }
  }

  return fetchPlaybackInfoUncached(session, item, quality, options);
}

/**
 * Requests a dedicated, server-authorized PlaybackInfo + TranscodingUrl specifically for Chromecast
 * so the TV gets its own real PlaySessionId (never conflicting with the paused phone session)
 * and a smooth Chromecast-friendly bitrate cap (8 Mbps default).
 */
export async function getCastPlaybackInfo(
  session: AuthSession,
  item: MediaItem,
  quality: QualityPreset,
  options: PlaybackOptions = {}
): Promise<{ streamUrl: string; isHls: boolean; playSessionId: string; mediaSourceId: string }> {
  if (session.isDemo) {
    const url = item.demoStreamUrl || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
    return {
      streamUrl: url,
      isHls: url.endsWith('.m3u8'),
      playSessionId: `demo-cast-${Date.now()}`,
      mediaSourceId: item.id,
    };
  }

  const preset = QUALITY_OPTIONS.find((q) => q.id === quality) || QUALITY_OPTIONS[0];
  const maxBitrate = preset.videoBitrate ?? 8_000_000;
  const needsBurnIn = options.burnInSubtitleIndex !== undefined && options.burnInSubtitleIndex !== null;
  const hasExplicitAudio = options.audioStreamIndex !== undefined && options.audioStreamIndex !== null;

  const body: Record<string, unknown> = {
    DeviceProfile: {
      MaxStreamingBitrate: maxBitrate,
      DirectPlayProfiles:
        quality !== 'auto' || needsBurnIn || hasExplicitAudio
          ? []
          : [
              {
                Container: 'mp4,m4v,webm',
                Type: 'Video',
                VideoCodec: 'h264,vp9',
                AudioCodec: 'aac,mp3,opus',
              },
            ],
      TranscodingProfiles: [
        {
          Container: 'ts',
          Type: 'Video',
          VideoCodec: 'h264',
          AudioCodec: 'aac',
          Protocol: 'hls',
          Context: 'Streaming',
          MaxAudioChannels: '2',
          SegmentLength: 6,
          MinSegments: 2,
          BreakOnNonKeyFrames: true,
        },
      ],
      SubtitleProfiles: [
        { Format: 'vtt', Method: 'External' },
        { Format: 'srt', Method: 'External' },
        { Format: 'pgssub', Method: 'Encode' },
        { Format: 'dvdsub', Method: 'Encode' },
      ],
    },
    SubtitleStreamIndex: needsBurnIn ? options.burnInSubtitleIndex : -1,
  };

  if (hasExplicitAudio) {
    body.AudioStreamIndex = options.audioStreamIndex;
  }

  const res = await fetch(
    `${session.serverUrl}/Items/${item.id}/PlaybackInfo?UserId=${session.userId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `MediaBrowser Client="QualiadeptCast", Device="Chromecast", DeviceId="${getDeviceId()}-cast", Version="1.0.0", Token="${session.accessToken}"`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) throw new Error(`Cast playback info failed (HTTP ${res.status})`);
  const data = await res.json();
  const source = data.MediaSources?.[0];
  if (!source) throw new Error('No playable media source found for Cast.');

  const playSessionId: string = data.PlaySessionId || crypto.randomUUID();
  const mediaSourceId: string = source.Id;
  const token = encodeURIComponent(session.accessToken);

  const canDirectPlay =
    quality === 'auto' &&
    !needsBurnIn &&
    !hasExplicitAudio &&
    source.SupportsDirectPlay &&
    ['mp4', 'm4v', 'webm'].includes((source.Container || '').toLowerCase());

  if (canDirectPlay) {
    return {
      streamUrl: `${session.serverUrl}/Videos/${item.id}/stream?static=true&mediaSourceId=${mediaSourceId}&api_key=${token}`,
      isHls: false,
      playSessionId,
      mediaSourceId,
    };
  }

  if (source.TranscodingUrl) {
    return {
      streamUrl: new URL(source.TranscodingUrl, session.serverUrl).toString(),
      isHls: true,
      playSessionId,
      mediaSourceId,
    };
  }

  const audioBitrate = 192_000;
  const videoBitrate = Math.max(500_000, maxBitrate - audioBitrate);
  const fallbackParams = new URLSearchParams({
    MediaSourceId: mediaSourceId,
    PlaySessionId: playSessionId,
    VideoCodec: 'h264',
    AudioCodec: 'aac',
    AudioBitrate: String(audioBitrate),
    VideoBitrate: String(videoBitrate),
    TranscodingMaxAudioChannels: '2',
    SegmentContainer: 'ts',
    SegmentLength: '6',
    MinSegments: '2',
    BreakOnNonKeyFrames: 'true',
    DeviceId: `${getDeviceId()}-cast`,
    api_key: session.accessToken,
  });
  if (preset.maxWidth) fallbackParams.set('MaxWidth', String(preset.maxWidth));
  if (hasExplicitAudio) fallbackParams.set('AudioStreamIndex', String(options.audioStreamIndex));
  if (needsBurnIn) {
    fallbackParams.set('SubtitleStreamIndex', String(options.burnInSubtitleIndex));
    fallbackParams.set('SubtitleMethod', 'Encode');
  }

  return {
    streamUrl: `${session.serverUrl}/Videos/${item.id}/master.m3u8?${fallbackParams.toString()}`,
    isHls: true,
    playSessionId,
    mediaSourceId,
  };
}

export async function reportPlaybackProgress(
  session: AuthSession,
  itemId: string,
  mediaSourceId: string,
  playSessionId: string,
  positionSeconds: number,
  isPaused: boolean,
  event: 'start' | 'progress' | 'stop'
): Promise<void> {
  if (session.isDemo) return;

  const endpoint =
    event === 'start'
      ? '/Sessions/Playing'
      : event === 'stop'
      ? '/Sessions/Playing/Stopped'
      : '/Sessions/Playing/Progress';

  const authHeader = buildAuthHeader(session.accessToken);
  const keepalive = event === 'stop';

  try {
    await fetch(`${session.serverUrl}${endpoint}`, {
      method: 'POST',
      keepalive,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        ItemId: itemId,
        MediaSourceId: mediaSourceId,
        PlaySessionId: playSessionId,
        PositionTicks: Math.floor(positionSeconds * 10_000_000),
        IsPaused: isPaused,
        PlayMethod: 'Transcode',
      }),
    });
  } catch {
    // Non-blocking telemetry
  }

  // Immediately terminate any server-side FFmpeg process for this PlaySessionId so rapid quality
  // switches or 10-15 family members browsing never leave zombie transcodes filling CPU or cache.
  if (event === 'stop' && playSessionId) {
    const params = new URLSearchParams({
      deviceId: getDeviceId(),
      playSessionId,
    });
    fetch(`${session.serverUrl}/Videos/ActiveEncodings?${params.toString()}`, {
      method: 'DELETE',
      keepalive: true,
      headers: { Authorization: authHeader },
    }).catch(() => {});
  }
}

export type DownloadPresetId = 'standard' | 'high' | 'saver' | 'original';

export interface DownloadStreamInfo {
  downloadUrl: string;
  playSessionId: string;
  mediaSourceId: string;
  container: string;
  fileSizeBytes?: number;
  estimatedBytes?: number;
  isTranscoded: boolean;
  subtitles: SubtitleTrack[];
}

const DOWNLOAD_BITRATES: Record<DownloadPresetId, { bitrate?: number; maxWidth?: number }> = {
  standard: { bitrate: 2_200_000, maxWidth: 1280 },
  high: { bitrate: 5_000_000, maxWidth: 1920 },
  saver: { bitrate: 1_100_000, maxWidth: 854 },
  original: {},
};

/**
 * Negotiates a progressive MP4 (or direct original) download URL via Jellyfin PlaybackInfo
 * so users can download compact 720p (~1.3 GB) or 1080p (~3 GB) offline copies instead of 10+ GB masters,
 * while still supporting 0%-CPU Direct Download whenever the source already fits the chosen size cap.
 */
export async function getDownloadStreamInfo(
  session: AuthSession,
  item: MediaItem,
  presetId: DownloadPresetId,
  forInAppPlayer = true
): Promise<DownloadStreamInfo> {
  if (session.isDemo) {
    throw new Error('Offline downloads require signing in to your Jellyfin server.');
  }

  const spec = DOWNLOAD_BITRATES[presetId];
  const maxBitrate = spec.bitrate ?? 80_000_000;
  const token = encodeURIComponent(session.accessToken);

  const playbackBody: Record<string, unknown> = {
    MaxStreamingBitrate: maxBitrate,
    EnableDirectPlay: true,
    EnableDirectStream: true,
    EnableTranscoding: true,
    AllowVideoStreamCopy: true,
    AllowAudioStreamCopy: true,
    SubtitleStreamIndex: -1,
    DeviceProfile: {
      MaxStreamingBitrate: maxBitrate,
      DirectPlayProfiles: [
        {
          Container: 'mp4,m4v,webm',
          Type: 'Video',
          VideoCodec: getDirectPlayVideoCodecs(),
          AudioCodec: 'aac,mp3,opus',
        },
      ],
      CodecProfiles: spec.maxWidth
        ? [
            {
              Type: 'Video',
              Codec: 'h264,hevc,vp9,av1,mpeg4,mpeg2video',
              Conditions: [
                {
                  Condition: 'LessThanEqual',
                  Property: 'Width',
                  Value: String(spec.maxWidth),
                  IsRequired: false,
                },
              ],
            },
          ]
        : [],
      TranscodingProfiles: [
        {
          Container: 'mp4',
          Type: 'Video',
          VideoCodec: 'h264',
          AudioCodec: 'aac',
          Protocol: 'http',
          Context: 'Static',
          MaxAudioChannels: '2',
        },
      ],
      SubtitleProfiles: [
        { Format: 'vtt', Method: 'External' },
        { Format: 'srt', Method: 'External' },
        { Format: 'ass', Method: 'External' },
        { Format: 'ssa', Method: 'External' },
        { Format: 'subrip', Method: 'External' },
      ],
    },
  };

  const res = await fetch(
    `${session.serverUrl}/Items/${item.id}/PlaybackInfo?UserId=${session.userId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildAuthHeader(session.accessToken),
      },
      body: JSON.stringify(playbackBody),
    }
  );

  if (!res.ok) throw new Error(`Failed to prepare download (HTTP ${res.status})`);
  const data = await res.json();
  const source = data.MediaSources?.[0];
  if (!source) throw new Error('No downloadable media source found.');

  const playSessionId: string = data.PlaySessionId || crypto.randomUUID();
  const mediaSourceId: string = source.Id;
  const streams: RawMediaStream[] = source.MediaStreams || [];
  const sourceContainer = (source.Container || 'mp4').toLowerCase();
  const sourceSize: number | undefined = typeof source.Size === 'number' ? source.Size : undefined;
  const videoStream = streams.find((s) => s.Type === 'Video');
  const sourceBitrate: number | undefined =
    typeof source.Bitrate === 'number' ? source.Bitrate : videoStream?.BitRate;
  const sourceWidth: number | undefined = videoStream?.Width;

  const subtitles: SubtitleTrack[] = streams
    .filter((s) => s.Type === 'Subtitle' && Boolean(s.IsTextSubtitleStream))
    .map((s) => ({
      index: s.Index,
      label: formatSubtitleLabel(s),
      language: s.Language || 'und',
      isText: true,
      codec: s.Codec,
      isDefault: Boolean(s.IsDefault),
      isForced: Boolean(s.IsForced),
      url: `${session.serverUrl}/Videos/${item.id}/${mediaSourceId}/Subtitles/${s.Index}/0/Stream.vtt?api_key=${token}`,
    }));

  // Direct device save of raw Original file
  if (presetId === 'original' && !forInAppPlayer) {
    return {
      downloadUrl: `${session.serverUrl}/Items/${item.id}/Download?api_key=${token}`,
      playSessionId,
      mediaSourceId,
      container: sourceContainer,
      fileSizeBytes: sourceSize,
      estimatedBytes: sourceSize,
      isTranscoded: false,
      subtitles,
    };
  }

  const fitsPreset =
    presetId === 'original' ||
    ((!sourceBitrate || sourceBitrate <= maxBitrate * 1.15) &&
      (!spec.maxWidth || !sourceWidth || sourceWidth <= spec.maxWidth));

  const isBrowserPlayableContainer = ['mp4', 'm4v', 'webm'].includes(sourceContainer);

  if (fitsPreset && source.SupportsDirectPlay && isBrowserPlayableContainer) {
    return {
      downloadUrl: `${session.serverUrl}/Videos/${item.id}/stream.${sourceContainer}?static=true&mediaSourceId=${mediaSourceId}&api_key=${token}`,
      playSessionId,
      mediaSourceId,
      container: sourceContainer,
      fileSizeBytes: sourceSize,
      estimatedBytes: sourceSize,
      isTranscoded: false,
      subtitles,
    };
  }

  const runtimeSec = item.runtimeTicks
    ? item.runtimeTicks / 10_000_000
    : (item.runtimeMinutes || 60) * 60;
  const estimatedBytes = spec.bitrate
    ? Math.round((runtimeSec * (spec.bitrate + 160_000)) / 8)
    : sourceSize;

  let downloadUrl: string;
  if (source.TranscodingUrl && !source.TranscodingUrl.includes('.m3u8')) {
    const parsed = new URL(source.TranscodingUrl, session.serverUrl);
    parsed.searchParams.delete('SubtitleStreamIndex');
    parsed.searchParams.delete('SubtitleMethod');
    downloadUrl = parsed.toString();
  } else {
    const audioBitrate = 160_000;
    const videoBitrate = Math.max(450_000, (spec.bitrate ?? 8_000_000) - audioBitrate);
    const params = new URLSearchParams({
      MediaSourceId: mediaSourceId,
      PlaySessionId: playSessionId,
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      AudioBitrate: String(audioBitrate),
      VideoBitrate: String(videoBitrate),
      TranscodingMaxAudioChannels: '2',
      DeviceId: `${getDeviceId()}-dl`,
      api_key: session.accessToken,
    });
    if (spec.maxWidth) {
      params.set('MaxWidth', String(spec.maxWidth));
    }
    if (typeof source.DefaultAudioStreamIndex === 'number') {
      params.set('AudioStreamIndex', String(source.DefaultAudioStreamIndex));
    }
    downloadUrl = `${session.serverUrl}/Videos/${item.id}/stream.mp4?${params.toString()}`;
  }

  return {
    downloadUrl,
    playSessionId,
    mediaSourceId,
    container: 'mp4',
    estimatedBytes,
    isTranscoded: true,
    subtitles,
  };
}

// ============================================================================
// Admin-Only Family Account Management (requires session.isAdmin === true)
// ============================================================================

interface RawJellyfinUserPolicy {
  IsAdministrator?: boolean;
  IsHidden?: boolean;
  IsDisabled?: boolean;
  MaxParentalRating?: number | null;
  EnableMediaPlayback?: boolean;
  EnableAudioPlaybackTranscoding?: boolean;
  EnableVideoPlaybackTranscoding?: boolean;
  EnablePlaybackRemuxing?: boolean;
  EnableContentDeletion?: boolean;
  EnableAllFolders?: boolean;
  MaxActiveSessions?: number;
  AuthenticationProviderId?: string;
  PasswordResetProviderId?: string;
  [key: string]: unknown;
}

interface RawJellyfinUser {
  Id: string;
  Name: string;
  LastActivityDate?: string;
  Policy?: RawJellyfinUserPolicy;
}

function ratingToParentalTier(maxRating?: number | null): ParentalTier {
  if (typeof maxRating !== 'number') return 'adult';
  if (maxRating <= 5) return 'kids';
  if (maxRating <= 7) return 'teen';
  return 'adult';
}

function parentalTierToRating(tier: ParentalTier): number | null {
  if (tier === 'kids') return 5; // PG & below
  if (tier === 'teen') return 7; // PG-13 & below
  return null; // Unrestricted
}

function mapFamilyUser(raw: RawJellyfinUser): FamilyUser {
  const p = raw.Policy || {};
  const maxRating = typeof p.MaxParentalRating === 'number' ? p.MaxParentalRating : null;
  return {
    id: raw.Id,
    name: raw.Name,
    isAdmin: Boolean(p.IsAdministrator),
    isDisabled: Boolean(p.IsDisabled),
    isHidden: Boolean(p.IsHidden),
    parentalTier: ratingToParentalTier(maxRating),
    maxParentalRating: maxRating,
    allowTranscoding: p.EnableVideoPlaybackTranscoding !== false,
    maxActiveSessions: typeof p.MaxActiveSessions === 'number' ? p.MaxActiveSessions : 0,
    lastActivityDate: raw.LastActivityDate,
  };
}

export async function fetchAllFamilyUsers(session: AuthSession): Promise<FamilyUser[]> {
  if (session.isDemo || !session.isAdmin) return [];
  const res = await fetch(`${session.serverUrl}/Users`, {
    headers: { Authorization: buildAuthHeader(session.accessToken) },
  });
  if (!res.ok) throw new Error(`Could not load family accounts (HTTP ${res.status})`);
  const data = (await res.json()) as RawJellyfinUser[];
  return data
    .map(mapFamilyUser)
    .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.name.localeCompare(b.name));
}

export async function fetchActiveStreams(session: AuthSession): Promise<ActiveStreamSession[]> {
  if (session.isDemo || !session.isAdmin) return [];
  try {
    const res = await fetch(`${session.serverUrl}/Sessions`, {
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      Id: string;
      UserId?: string;
      UserName?: string;
      DeviceName?: string;
      Client?: string;
      NowPlayingItem?: {
        Name?: string;
        SeriesName?: string;
        ParentIndexNumber?: number;
        IndexNumber?: number;
      };
      PlayState?: {
        PlayMethod?: string;
        IsPaused?: boolean;
      };
    }>;
    return data
      .filter((s) => Boolean(s.NowPlayingItem?.Name))
      .map((s) => {
        const item = s.NowPlayingItem!;
        const title = item.SeriesName
          ? `${item.SeriesName} · S${item.ParentIndexNumber ?? 1}E${item.IndexNumber ?? 1} · ${item.Name}`
          : item.Name || 'Playing';
        return {
          id: s.Id,
          userId: s.UserId || '',
          username: s.UserName || 'Unknown',
          deviceName: s.DeviceName || 'Device',
          client: s.Client || 'Player',
          nowPlayingTitle: title,
          playMethod: s.PlayState?.PlayMethod || 'DirectPlay',
          isPaused: Boolean(s.PlayState?.IsPaused),
        };
      });
  } catch {
    return [];
  }
}

export interface CreateFamilyUserInput {
  name: string;
  password: string;
  parentalTier: ParentalTier;
  allowTranscoding: boolean;
  maxActiveSessions: number;
  showOnSharedLogin: boolean;
}

/**
 * Creates a strictly non-admin Jellyfin user with isolated watch history, My List,
 * parental rating cap, and safe stream limits so only the owner account remains administrator.
 */
export async function createFamilyUser(
  session: AuthSession,
  input: CreateFamilyUserInput
): Promise<FamilyUser> {
  if (!session.isAdmin || session.isDemo) {
    throw new Error('Only the administrator can create family accounts.');
  }
  const cleanName = input.name.trim();
  if (!cleanName) throw new Error('Please enter a username.');
  if (input.password.length < 4) {
    throw new Error('Please use a password with at least 4 characters.');
  }

  const createRes = await fetch(`${session.serverUrl}/Users/New`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: buildAuthHeader(session.accessToken),
    },
    body: JSON.stringify({
      Name: cleanName,
      Password: input.password,
    }),
  });

  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => '');
    throw new Error(detail.trim() || `Could not create user (HTTP ${createRes.status})`);
  }

  const created = (await createRes.json()) as RawJellyfinUser;
  let basePolicy: RawJellyfinUserPolicy = created.Policy || {};
  try {
    const fullRes = await fetchWithRetry(`${session.serverUrl}/Users/${created.Id}`, {
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    });
    if (fullRes.ok) {
      const fullUser = (await fullRes.json()) as RawJellyfinUser;
      if (fullUser.Policy) basePolicy = fullUser.Policy;
    }
  } catch {
    // Fall back to created.Policy
  }

  const safePolicy: RawJellyfinUserPolicy = {
    ...basePolicy,
    IsAdministrator: false,
    IsDisabled: false,
    IsHidden: !input.showOnSharedLogin,
    EnableRemoteAccess: true,
    EnableAllDevices: true,
    EnableAllChannels: true,
    EnableAllFolders: true,
    EnableContentDeletion: false,
    EnableContentDownloading: true,
    EnableMediaPlayback: true,
    EnableAudioPlaybackTranscoding: true,
    EnableVideoPlaybackTranscoding: input.allowTranscoding,
    EnablePlaybackRemuxing: true,
    InvalidLoginAttemptCount: 0,
    LoginAttemptsBeforeLockout: -1,
    MaxParentalRating: parentalTierToRating(input.parentalTier),
    MaxActiveSessions: Math.max(0, Math.min(5, input.maxActiveSessions)),
    AuthenticationProviderId:
      basePolicy.AuthenticationProviderId ||
      'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
    PasswordResetProviderId:
      basePolicy.PasswordResetProviderId ||
      'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
  };

  const policyRes = await fetchWithRetry(`${session.serverUrl}/Users/${created.Id}/Policy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: buildAuthHeader(session.accessToken),
    },
    body: JSON.stringify(safePolicy),
  });

  if (!policyRes.ok) {
    throw new Error(`User created, but applying family limits failed (HTTP ${policyRes.status})`);
  }

  return mapFamilyUser({ ...created, Policy: safePolicy });
}

export async function updateFamilyUserPolicy(
  session: AuthSession,
  userId: string,
  patch: {
    parentalTier?: ParentalTier;
    allowTranscoding?: boolean;
    isDisabled?: boolean;
    showOnSharedLogin?: boolean;
    maxActiveSessions?: number;
  }
): Promise<FamilyUser> {
  if (!session.isAdmin || session.isDemo) {
    throw new Error('Only the administrator can update family accounts.');
  }

  const getRes = await fetchWithRetry(`${session.serverUrl}/Users/${userId}`, {
    headers: { Authorization: buildAuthHeader(session.accessToken) },
  });
  if (!getRes.ok) throw new Error(`Could not fetch user settings (HTTP ${getRes.status})`);
  const existing = (await getRes.json()) as RawJellyfinUser;
  const currentPolicy: RawJellyfinUserPolicy = existing.Policy || {};

  const nextPolicy: RawJellyfinUserPolicy = {
    ...currentPolicy,
    // Never elevate a non-admin account through the family panel
    IsAdministrator: Boolean(currentPolicy.IsAdministrator),
    EnableContentDeletion: Boolean(currentPolicy.IsAdministrator)
      ? Boolean(currentPolicy.EnableContentDeletion)
      : false,
    // Always guarantee remote 5G/Wi-Fi access, all devices, and offline downloads stay allowed
    EnableRemoteAccess: true,
    EnableAllDevices: true,
    EnableAllChannels: true,
    EnableAllFolders: true,
    EnableMediaPlayback: true,
    EnableContentDownloading: true,
    InvalidLoginAttemptCount: 0,
    LoginAttemptsBeforeLockout: -1,
  };

  if (patch.parentalTier !== undefined) {
    nextPolicy.MaxParentalRating = parentalTierToRating(patch.parentalTier);
  }
  if (patch.allowTranscoding !== undefined) {
    nextPolicy.EnableVideoPlaybackTranscoding = patch.allowTranscoding;
  }
  if (patch.isDisabled !== undefined && !currentPolicy.IsAdministrator) {
    nextPolicy.IsDisabled = patch.isDisabled;
  }
  if (patch.showOnSharedLogin !== undefined) {
    nextPolicy.IsHidden = !patch.showOnSharedLogin;
  }
  if (patch.maxActiveSessions !== undefined) {
    nextPolicy.MaxActiveSessions = Math.max(0, Math.min(5, patch.maxActiveSessions));
  }

  const postRes = await fetchWithRetry(`${session.serverUrl}/Users/${userId}/Policy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: buildAuthHeader(session.accessToken),
    },
    body: JSON.stringify(nextPolicy),
  });
  if (!postRes.ok) throw new Error(`Failed to save user settings (HTTP ${postRes.status})`);

  return mapFamilyUser({ ...existing, Policy: nextPolicy });
}

export async function resetFamilyUserPassword(
  session: AuthSession,
  userId: string,
  newPassword: string
): Promise<void> {
  if (!session.isAdmin || session.isDemo) {
    throw new Error('Only the administrator can reset passwords.');
  }
  if (newPassword.length < 4) {
    throw new Error('New password must be at least 4 characters.');
  }

  const res = await fetch(`${session.serverUrl}/Users/${userId}/Password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: buildAuthHeader(session.accessToken),
    },
    body: JSON.stringify({
      NewPw: newPassword,
      ResetPassword: false,
    }),
  });
  if (!res.ok) throw new Error(`Failed to reset password (HTTP ${res.status})`);
}

export async function deleteFamilyUser(session: AuthSession, userId: string): Promise<void> {
  if (!session.isAdmin || session.isDemo) {
    throw new Error('Only the administrator can delete accounts.');
  }
  if (userId === session.userId) {
    throw new Error('You cannot delete your own admin account.');
  }

  const res = await fetch(`${session.serverUrl}/Users/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: buildAuthHeader(session.accessToken) },
  });
  if (!res.ok) throw new Error(`Failed to delete account (HTTP ${res.status})`);
  removeSavedProfile(userId);
}


