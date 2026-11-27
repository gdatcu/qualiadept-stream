export type MediaType = 'Movie' | 'Series' | 'Episode' | 'BoxSet';

export interface LibraryView {
  id: string;
  name: string;
  collectionType?: string;
}

export type QualityPreset = 'auto' | '1080p' | '720p' | '480p' | '360p';

export interface QualityOption {
  id: QualityPreset;
  label: string;
  description: string;
  maxWidth?: number;
  videoBitrate?: number;
}

export const QUALITY_OPTIONS: QualityOption[] = [
  { id: 'auto', label: 'Original', description: 'Untouched source quality (Direct Play / Lossless Remux)' },
  { id: '1080p', label: '1080p HD', description: '8 Mbps · Smooth Full HD', maxWidth: 1920, videoBitrate: 8_000_000 },
  { id: '720p', label: '720p HD', description: '3 Mbps · Crisp & fast on 5G / Wi-Fi', maxWidth: 1280, videoBitrate: 3_000_000 },
  { id: '480p', label: '480p SD', description: '1.5 Mbps · Smooth on 4G / variable mobile', maxWidth: 854, videoBitrate: 1_500_000 },
  { id: '360p', label: '360p Saver', description: '800 kbps · Zero-buffer on weak signal', maxWidth: 640, videoBitrate: 800_000 },
];

export interface AudioTrack {
  index: number;
  label: string;
  language: string;
  codec?: string;
  channels?: number;
  isDefault?: boolean;
}

export interface SubtitleTrack {
  index: number;
  label: string;
  language: string;
  /** True for text subtitles (SRT/ASS/VTT) delivered as WebVTT; false for bitmap subtitles (PGS/VobSub) burned in via HLS */
  isText: boolean;
  codec?: string;
  isDefault?: boolean;
  isForced?: boolean;
  url?: string;
}

export interface PersonCredit {
  id: string;
  name: string;
  role?: string;
  type: string;
  avatarUrl?: string;
}

export interface ChapterItem {
  index: number;
  name: string;
  startSeconds: number;
  imageUrl?: string;
}

export interface RemoteTrailer {
  name: string;
  url: string;
}

export interface MediaItemDetails {
  tagline?: string;
  tags: string[];
  people: PersonCredit[];
  directors: string[];
  writers: string[];
  studios: string[];
  imdbId?: string;
  tmdbId?: string;
  remoteTrailers: RemoteTrailer[];
  chapters: ChapterItem[];
  isPlayed: boolean;
  videoSpec?: string;
  videoCodec?: string;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  defaultAudioIndex: number | null;
  defaultSubtitleIndex: number | null;
}

export interface PlaybackStartOptions {
  startFromBeginning?: boolean;
  startAtSeconds?: number;
  audioIndex?: number | null;
  /** null = explicitly Off, number = specific subtitle stream index, undefined = player default */
  subtitleIndex?: number | null;
}

export interface MediaItem {
  id: string;
  name: string;
  type: MediaType;
  overview: string;
  year?: number;
  rating?: number;
  officialRating?: string;
  runtimeMinutes?: number;
  runtimeTicks?: number;
  genres: string[];
  posterUrl: string;
  backdropUrl: string;
  isFavorite?: boolean;
  isPlayed?: boolean;
  /** 0 to 100 percentage for Continue Watching */
  playedPercentage?: number;
  /** Position in seconds to resume from */
  resumePositionSeconds?: number;
  /** For episodes */
  seriesId?: string;
  seriesName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  /** Direct demo stream URL (only in Demo Mode) */
  demoStreamUrl?: string;
  demoSubtitles?: SubtitleTrack[];
}

export interface SeasonItem {
  id: string;
  name: string;
  seasonNumber: number;
}

export type StreamPlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode';

export interface PlaybackInfo {
  streamUrl: string;
  isHls: boolean;
  playMethod?: StreamPlayMethod;
  transcodeReasons?: string[];
  mediaSourceId: string;
  playSessionId: string;
  audioTracks: AudioTrack[];
  defaultAudioIndex: number | null;
  subtitles: SubtitleTrack[];
  sourceBitrate?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  videoCodec?: string;
  videoRange?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
}

export interface AuthSession {
  serverUrl: string;
  accessToken: string;
  userId: string;
  username: string;
  isDemo: boolean;
  isAdmin?: boolean;
  isHidden?: boolean;
}

export type ParentalTier = 'adult' | 'teen' | 'kids';

export interface PublicUserProfile {
  id: string;
  name: string;
  hasPassword: boolean;
  avatarUrl?: string;
}

export interface FamilyUser {
  id: string;
  name: string;
  isAdmin: boolean;
  isDisabled: boolean;
  isHidden: boolean;
  parentalTier: ParentalTier;
  maxParentalRating: number | null;
  allowTranscoding: boolean;
  maxActiveSessions: number;
  lastActivityDate?: string;
}

export interface ActiveStreamSession {
  id: string;
  userId: string;
  username: string;
  deviceName: string;
  client: string;
  nowPlayingTitle: string;
  playMethod: string;
  isPaused: boolean;
}
