import type { MediaItem, SeasonItem } from '../types/media';

// Public open-source Blender Foundation films & HLS test streams for instant UI preview
export const DEMO_ITEMS: MediaItem[] = [
  {
    id: 'demo-tears-of-steel',
    name: 'Tears of Steel',
    type: 'Movie',
    year: 2012,
    rating: 7.8,
    officialRating: 'PG-13',
    runtimeMinutes: 12,
    genres: ['Sci-Fi', 'Action', 'Featured'],
    overview:
      'In an apocalyptic Amsterdam, a group of warriors and scientists gather at the Oude Kerk to stage a desperate mission to save the world from destructive robots.',
    posterUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Tears_of_Steel_poster.jpg/600px-Tears_of_Steel_poster.jpg',
    backdropUrl:
      'https://mango.blender.org/wp-content/uploads/2012/09/01_thom_celia_bridge.jpg',
    playedPercentage: 35,
    resumePositionSeconds: 245,
    demoStreamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  },
  {
    id: 'demo-sintel',
    name: 'Sintel',
    type: 'Movie',
    year: 2010,
    rating: 8.4,
    officialRating: 'PG',
    runtimeMinutes: 15,
    genres: ['Fantasy', 'Adventure', 'Drama'],
    overview:
      'A lonely young woman, Sintel, helps and befriends a baby dragon, whom she calls Scales. When he is kidnapped by an adult dragon, Sintel embarks on a perilous quest to find him.',
    posterUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Sintel_poster.jpg/600px-Sintel_poster.jpg',
    backdropUrl:
      'https://durian.blender.org/wp-content/uploads/2010/06/05.8b_comp_000272.jpg',
    playedPercentage: 62,
    resumePositionSeconds: 510,
    demoStreamUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
  },
  {
    id: 'demo-big-buck-bunny',
    name: 'Big Buck Bunny',
    type: 'Movie',
    year: 2008,
    rating: 7.5,
    officialRating: 'G',
    runtimeMinutes: 10,
    genres: ['Animation', 'Comedy', 'Adventure'],
    overview:
      'A giant, gentle rabbit deals with three bullying rodents in a lush forest, devising an ingenious and hilarious plan to teach them a lesson.',
    posterUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/600px-Big_buck_bunny_poster_big.jpg',
    backdropUrl:
      'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg',
    demoStreamUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  },
  {
    id: 'demo-elephants-dream',
    name: 'Elephants Dream',
    type: 'Movie',
    year: 2006,
    rating: 7.1,
    officialRating: 'PG',
    runtimeMinutes: 11,
    genres: ['Sci-Fi', 'Animation', 'Drama'],
    overview:
      'Two strange characters, Proog and Emo, explore a capricious and seemingly infinite mechanical world, testing the boundaries of perception and trust.',
    posterUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Elephants_Dream_poster.jpg/600px-Elephants_Dream_poster.jpg',
    backdropUrl:
      'https://orange.blender.org/wp-content/themes/orange/images/common/ed_header.jpg',
    demoStreamUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  },
  {
    id: 'demo-series-blender',
    name: 'Open Cinema Anthology',
    type: 'Series',
    year: 2024,
    rating: 8.9,
    officialRating: 'TV-14',
    genres: ['Sci-Fi', 'Adventure', 'Animation'],
    overview:
      'A curated showcase of open-source short films demonstrating multi-season browsing, episode playback, and adaptive HLS streaming on Qualiadept Stream.',
    posterUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Sintel_poster.jpg/600px-Sintel_poster.jpg',
    backdropUrl:
      'https://mango.blender.org/wp-content/uploads/2012/09/01_thom_celia_bridge.jpg',
  },
];

export const DEMO_SEASONS: Record<string, SeasonItem[]> = {
  'demo-series-blender': [
    { id: 'demo-s1', name: 'Season 1', seasonNumber: 1 },
  ],
};

export const DEMO_EPISODES: Record<string, MediaItem[]> = {
  'demo-s1': [
    {
      id: 'demo-ep-1',
      name: 'Episode 1: Tears of Steel (HLS)',
      type: 'Episode',
      seriesId: 'demo-series-blender',
      seriesName: 'Open Cinema Anthology',
      seasonNumber: 1,
      episodeNumber: 1,
      runtimeMinutes: 12,
      genres: ['Sci-Fi'],
      overview: 'Adaptive HLS test stream demonstrating instant seeking and quality switching.',
      posterUrl:
        'https://mango.blender.org/wp-content/uploads/2012/09/01_thom_celia_bridge.jpg',
      backdropUrl:
        'https://mango.blender.org/wp-content/uploads/2012/09/01_thom_celia_bridge.jpg',
      demoStreamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    },
    {
      id: 'demo-ep-2',
      name: 'Episode 2: Sintel (MP4 Direct Play)',
      type: 'Episode',
      seriesId: 'demo-series-blender',
      seriesName: 'Open Cinema Anthology',
      seasonNumber: 1,
      episodeNumber: 2,
      runtimeMinutes: 15,
      genres: ['Fantasy'],
      overview: 'Direct Play MP4 demonstration with crisp 1080p playback.',
      posterUrl:
        'https://durian.blender.org/wp-content/uploads/2010/06/05.8b_comp_000272.jpg',
      backdropUrl:
        'https://durian.blender.org/wp-content/uploads/2010/06/05.8b_comp_000272.jpg',
      demoStreamUrl:
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    },
  ],
};
