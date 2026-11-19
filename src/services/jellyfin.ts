import { DEMO_EPISODES, DEMO_ITEMS, DEMO_SEASONS } from '../data/demoCatalog';
import type {
  AuthSession,
  MediaItem,
  MediaType,
  PlaybackInfo,
  SeasonItem,
  SubtitleTrack,
} from '../types/media';

const SESSION_STORAGE_KEY = 'qualiadept_stream_session_v1';
const DEVICE_ID_KEY = 'qualiadept_stream_device_id';
const DEMO_FAVORITES_KEY = 'qualiadept_demo_favorites';

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
  const res = await fetch(`${cleanUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: buildAuthHeader(),
    },
    body: JSON.stringify({
      Username: username,
      Pw: password,
    }),
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Invalid username or password.');
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
  };
  saveSession(session);
  return session;
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

  const posterUrl = raw.ImageTags?.Primary
    ? `${base}/Items/${raw.Id}/Images/Primary?fillHeight=600&fillWidth=400&quality=90&api_key=${token}`
    : `${base}/Items/${raw.Id}/Images/Backdrop?fillHeight=600&fillWidth=400&quality=85&api_key=${token}`;

  let backdropUrl = posterUrl;
  if (raw.BackdropImageTags && raw.BackdropImageTags.length > 0) {
    backdropUrl = `${base}/Items/${raw.Id}/Images/Backdrop/0?maxWidth=1920&quality=88&api_key=${token}`;
  } else if (raw.ParentBackdropItemId && raw.ParentBackdropImageTags?.length) {
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
    Limit: '250',
  });

  const res = await fetch(
    `${session.serverUrl}/Users/${session.userId}/Items?${params.toString()}`,
    {
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    }
  );

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

  const res = await fetch(
    `${session.serverUrl}/Users/${session.userId}/Items/Resume?${params.toString()}`,
    {
      headers: { Authorization: buildAuthHeader(session.accessToken) },
    }
  );

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

  const res = await fetch(
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

  const res = await fetch(
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

export async function getPlaybackInfo(
  session: AuthSession,
  item: MediaItem
): Promise<PlaybackInfo> {
  if (session.isDemo) {
    const url = item.demoStreamUrl || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
    return {
      streamUrl: url,
      isHls: url.endsWith('.m3u8'),
      mediaSourceId: item.id,
      playSessionId: `demo-${Date.now()}`,
      subtitles: item.demoSubtitles || [],
    };
  }

  const res = await fetch(
    `${session.serverUrl}/Items/${item.id}/PlaybackInfo?UserId=${session.userId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildAuthHeader(session.accessToken),
      },
      body: JSON.stringify({
        DeviceProfile: {
          MaxStreamingBitrate: 40_000_000,
          DirectPlayProfiles: [
            { Container: 'mp4,m4v,webm', Type: 'Video', VideoCodec: 'h264,vp9,av1', AudioCodec: 'aac,mp3,opus' },
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
            },
          ],
          SubtitleProfiles: [
            { Format: 'vtt', Method: 'External' },
            { Format: 'srt', Method: 'External' },
          ],
        },
      }),
    }
  );

  if (!res.ok) throw new Error(`Playback info failed (HTTP ${res.status})`);
  const data = await res.json();
  const source = data.MediaSources?.[0];
  if (!source) throw new Error('No playable media source found.');

  const playSessionId: string = data.PlaySessionId || crypto.randomUUID();
  const mediaSourceId: string = source.Id;
  const token = encodeURIComponent(session.accessToken);

  // Extract text subtitles as WebVTT URLs
  const subtitles: SubtitleTrack[] = (source.MediaStreams || [])
    .filter((s: { Type: string; IsTextSubtitleStream?: boolean }) => s.Type === 'Subtitle' && s.IsTextSubtitleStream)
    .map((s: { Index: number; DisplayTitle?: string; Language?: string }) => ({
      index: s.Index,
      label: s.DisplayTitle || s.Language || `Subtitle #${s.Index}`,
      language: s.Language || 'und',
      url: `${session.serverUrl}/Videos/${item.id}/${mediaSourceId}/Subtitles/${s.Index}/0/Stream.vtt?api_key=${token}`,
    }));

  // Prefer Direct Play for native browser MP4/WebM; otherwise use HLS (auto remux/transcode for MKV!)
  const canDirectPlay =
    source.SupportsDirectPlay &&
    ['mp4', 'm4v', 'webm'].includes((source.Container || '').toLowerCase());

  if (canDirectPlay) {
    return {
      streamUrl: `${session.serverUrl}/Videos/${item.id}/stream?static=true&mediaSourceId=${mediaSourceId}&api_key=${token}`,
      isHls: false,
      mediaSourceId,
      playSessionId,
      subtitles,
    };
  }

  const hlsUrl = source.TranscodingUrl
    ? `${session.serverUrl}${source.TranscodingUrl}`
    : `${session.serverUrl}/Videos/${item.id}/master.m3u8?MediaSourceId=${mediaSourceId}&PlaySessionId=${playSessionId}&VideoCodec=h264&AudioCodec=aac&AudioBitrate=192000&VideoBitrate=12000000&MaxStreamingBitrate=12000000&DeviceId=${encodeURIComponent(getDeviceId())}&api_key=${token}`;

  return {
    streamUrl: hlsUrl,
    isHls: true,
    mediaSourceId,
    playSessionId,
    subtitles,
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

  try {
    await fetch(`${session.serverUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildAuthHeader(session.accessToken),
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
}
