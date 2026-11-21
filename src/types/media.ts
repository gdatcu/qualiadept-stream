export type MediaType = 'Movie' | 'Series' | 'Episode';

export type QualityPreset = 'auto' | '1080p' | '720p' | '480p' | '360p';

export interface QualityOption {
  id: QualityPreset;
  label: string;
  description: string;
  maxWidth?: number;
  videoBitrate?: number;
}

export const QUALITY_OPTIONS: QualityOption[] = [
  { id: 'auto', label: 'Original', description: 'Best available (Direct Play / 12 Mbps)' },
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

export interface PlaybackInfo {
  streamUrl: string;
  isHls: boolean;
  mediaSourceId: string;
  playSessionId: string;
  audioTracks: AudioTrack[];
  defaultAudioIndex: number | null;
  subtitles: SubtitleTrack[];
}

export interface AuthSession {
  serverUrl: string;
  accessToken: string;
  userId: string;
  username: string;
  isDemo: boolean;
}
