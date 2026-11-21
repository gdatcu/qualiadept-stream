import { DEMO_EPISODES, DEMO_ITEMS, DEMO_SEASONS } from '../data/demoCatalog';
import {
  QUALITY_OPTIONS,
  type AudioTrack,
  type AuthSession,
  type MediaItem,
  type MediaType,
  type PlaybackInfo,
  type QualityPreset,
  type SeasonItem,
  type SubtitleTrack,
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

export async function getPlaybackInfo(
  session: AuthSession,
  item: MediaItem,
  quality: QualityPreset = 'auto',
  options: PlaybackOptions = {}
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
  const allowDirectPlay = !needsBurnIn && !hasExplicitAudio;

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
              VideoCodec: 'h264,vp9,av1',
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
          SegmentLength: 6,
          MinSegments: 1,
          BreakOnNonKeyFrames: true,
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
    !needsBurnIn &&
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
    const videoBitrate = Math.max(500_000, (preset.videoBitrate ?? 12_000_000) - audioBitrate);
    const hlsParams = new URLSearchParams({
      MediaSourceId: mediaSourceId,
      PlaySessionId: playSessionId,
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      AudioBitrate: String(audioBitrate),
      VideoBitrate: String(videoBitrate),
      TranscodingMaxAudioChannels: '2',
      SegmentContainer: 'ts',
      SegmentLength: '6',
      MinSegments: '1',
      BreakOnNonKeyFrames: 'true',
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
  };
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
