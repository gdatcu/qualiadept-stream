export type MediaType = 'Movie' | 'Series' | 'Episode';

export interface SubtitleTrack {
  index: number;
  label: string;
  language: string;
  url: string;
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
  subtitles: SubtitleTrack[];
}

export interface AuthSession {
  serverUrl: string;
  accessToken: string;
  userId: string;
  username: string;
  isDemo: boolean;
}
