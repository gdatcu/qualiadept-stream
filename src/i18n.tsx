import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type AppLanguage = 'en' | 'ro';

const DEFAULT_LANG_KEY = 'qualiadept_lang_default_v1';
const PROFILE_LANG_PREFIX = 'qualiadept_lang_profile_v1_';

function isValidLang(val: unknown): val is AppLanguage {
  return val === 'en' || val === 'ro';
}

function detectInitialDefaultLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(DEFAULT_LANG_KEY);
    if (isValidLang(saved)) return saved;
  } catch {
    // Ignore storage access errors
  }
  try {
    const browserLang = (navigator.language || '').toLowerCase();
    if (browserLang.startsWith('ro')) return 'ro';
  } catch {
    // Ignore navigator errors
  }
  return 'en';
}

export function getSavedLanguageForProfile(
  userId?: string | null,
  isHidden?: boolean
): AppLanguage {
  if (userId) {
    try {
      const store = isHidden ? sessionStorage : localStorage;
      const profileSaved = store.getItem(`${PROFILE_LANG_PREFIX}${userId}`);
      if (isValidLang(profileSaved)) return profileSaved;
    } catch {
      // Ignore storage errors
    }
  }
  return detectInitialDefaultLanguage();
}

let currentActiveLanguage: AppLanguage = detectInitialDefaultLanguage();

export function getAppLanguage(): AppLanguage {
  return currentActiveLanguage;
}

export function getAcceptLanguageHeader(): string {
  return currentActiveLanguage === 'ro'
    ? 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7'
    : 'en-US,en;q=0.9,ro-RO;q=0.6';
}

const GENRE_MAP_EN_TO_RO: Record<string, string> = {
  action: 'Acțiune',
  adventure: 'Aventură',
  'action & adventure': 'Acțiune și aventură',
  animation: 'Animație',
  anime: 'Anime',
  biography: 'Biografic',
  children: 'Copii',
  comedy: 'Comedie',
  crime: 'Crimă',
  documentary: 'Documentar',
  drama: 'Dramă',
  family: 'Familie',
  fantasy: 'Fantezie',
  history: 'Istoric',
  horror: 'Horror',
  kids: 'Copii',
  music: 'Muzică',
  musical: 'Muzical',
  mystery: 'Mister',
  news: 'Știri',
  reality: 'Reality',
  romance: 'Romantic',
  'science fiction': 'SF',
  'sci-fi': 'SF',
  'sci-fi & fantasy': 'SF și fantezie',
  short: 'Scurtmetraj',
  soap: 'Telenovelă',
  sport: 'Sport',
  sports: 'Sport',
  suspense: 'Suspans',
  talk: 'Talk-show',
  thriller: 'Thriller',
  'tv movie': 'Film TV',
  war: 'Război',
  'war & politics': 'Război și politică',
  western: 'Western',
};

const GENRE_MAP_RO_TO_EN: Record<string, string> = {
  acțiune: 'Action',
  actiune: 'Action',
  aventură: 'Adventure',
  aventura: 'Adventure',
  'acțiune și aventură': 'Action & Adventure',
  animație: 'Animation',
  animatie: 'Animation',
  biografic: 'Biography',
  copii: 'Kids',
  comedie: 'Comedy',
  crimă: 'Crime',
  crima: 'Crime',
  documentar: 'Documentary',
  dramă: 'Drama',
  drama: 'Drama',
  familie: 'Family',
  fantezie: 'Fantasy',
  istoric: 'History',
  groază: 'Horror',
  muzică: 'Music',
  muzical: 'Musical',
  mister: 'Mystery',
  știri: 'News',
  romantic: 'Romance',
  dragoste: 'Romance',
  sf: 'Sci-Fi',
  'sf și fantezie': 'Sci-Fi & Fantasy',
  'film tv': 'TV Movie',
  război: 'War',
  razboi: 'War',
  'război și politică': 'War & Politics',
};

export function translateGenre(genre: string, lang: AppLanguage = currentActiveLanguage): string {
  const key = genre.trim().toLowerCase();
  if (!key) return genre;
  if (lang === 'ro') {
    return GENRE_MAP_EN_TO_RO[key] || genre;
  }
  return GENRE_MAP_RO_TO_EN[key] || genre;
}

export function translateLibraryName(
  name: string,
  lang: AppLanguage = currentActiveLanguage
): string {
  const key = name.trim().toLowerCase();
  if (lang === 'ro') {
    if (key === 'movies' || key === 'films') return 'Filme';
    if (key === 'shows' || key === 'tv shows' || key === 'series') return 'Seriale';
    if (key === 'private') return 'Privat';
    if (key === 'music') return 'Muzică';
    if (key === 'kids') return 'Copii';
    return name;
  }
  if (key === 'filme') return 'Movies';
  if (key === 'seriale') return 'Shows';
  if (key === 'privat') return 'Private';
  return name;
}

export function formatSeasonLabel(
  rawName: string | undefined,
  seasonNumber: number | undefined,
  lang: AppLanguage = currentActiveLanguage
): string {
  const trimmed = (rawName || '').trim();
  const stdMatch = trimmed.match(/^(?:season|sezonul|sezon)\s+(\d+)$/i);
  if (stdMatch) {
    const num = Number(stdMatch[1]);
    return lang === 'ro' ? `Sezonul ${num}` : `Season ${num}`;
  }
  if (/^(?:specials|speciale)$/i.test(trimmed) || seasonNumber === 0) {
    return lang === 'ro' ? 'Speciale' : 'Specials';
  }
  if (!trimmed && seasonNumber != null) {
    return lang === 'ro' ? `Sezonul ${seasonNumber}` : `Season ${seasonNumber}`;
  }
  return trimmed || (lang === 'ro' ? 'Sezonul 1' : 'Season 1');
}

export function formatOverviewText(
  overview: string | undefined,
  lang: AppLanguage = currentActiveLanguage
): string {
  if (!overview || overview === 'No description available.') {
    return lang === 'ro' ? 'Nicio descriere disponibilă.' : 'No description available.';
  }
  return overview;
}

const TRACK_LANG_NAMES: Record<string, { en: string; ro: string }> = {
  ro: { en: 'Romanian', ro: 'Română' },
  ron: { en: 'Romanian', ro: 'Română' },
  rum: { en: 'Romanian', ro: 'Română' },
  en: { en: 'English', ro: 'Engleză' },
  eng: { en: 'English', ro: 'Engleză' },
  es: { en: 'Spanish', ro: 'Spaniolă' },
  spa: { en: 'Spanish', ro: 'Spaniolă' },
  fr: { en: 'French', ro: 'Franceză' },
  fre: { en: 'French', ro: 'Franceză' },
  fra: { en: 'French', ro: 'Franceză' },
  de: { en: 'German', ro: 'Germană' },
  ger: { en: 'German', ro: 'Germană' },
  deu: { en: 'German', ro: 'Germană' },
  it: { en: 'Italian', ro: 'Italiană' },
  ita: { en: 'Italian', ro: 'Italiană' },
  pt: { en: 'Portuguese', ro: 'Portugheză' },
  por: { en: 'Portuguese', ro: 'Portugheză' },
  hu: { en: 'Hungarian', ro: 'Maghiară' },
  hun: { en: 'Hungarian', ro: 'Maghiară' },
  pl: { en: 'Polish', ro: 'Poloneză' },
  pol: { en: 'Polish', ro: 'Poloneză' },
  nl: { en: 'Dutch', ro: 'Olandeză' },
  dut: { en: 'Dutch', ro: 'Olandeză' },
  nld: { en: 'Dutch', ro: 'Olandeză' },
  tr: { en: 'Turkish', ro: 'Turcă' },
  tur: { en: 'Turkish', ro: 'Turcă' },
  ja: { en: 'Japanese', ro: 'Japoneză' },
  jpn: { en: 'Japanese', ro: 'Japoneză' },
  ko: { en: 'Korean', ro: 'Coreeană' },
  kor: { en: 'Korean', ro: 'Coreeană' },
  zh: { en: 'Chinese', ro: 'Chineză' },
  chi: { en: 'Chinese', ro: 'Chineză' },
  zho: { en: 'Chinese', ro: 'Chineză' },
  ru: { en: 'Russian', ro: 'Rusă' },
  rus: { en: 'Russian', ro: 'Rusă' },
  uk: { en: 'Ukrainian', ro: 'Ucraineană' },
  ukr: { en: 'Ukrainian', ro: 'Ucraineană' },
  ar: { en: 'Arabic', ro: 'Arabă' },
  ara: { en: 'Arabic', ro: 'Arabă' },
  sv: { en: 'Swedish', ro: 'Suedeză' },
  swe: { en: 'Swedish', ro: 'Suedeză' },
  da: { en: 'Danish', ro: 'Daneză' },
  dan: { en: 'Danish', ro: 'Daneză' },
  no: { en: 'Norwegian', ro: 'Norvegiană' },
  nor: { en: 'Norwegian', ro: 'Norvegiană' },
  fi: { en: 'Finnish', ro: 'Finlandeză' },
  fin: { en: 'Finnish', ro: 'Finlandeză' },
  el: { en: 'Greek', ro: 'Greacă' },
  gre: { en: 'Greek', ro: 'Greacă' },
  ell: { en: 'Greek', ro: 'Greacă' },
};

export function localizeTrackLabel(
  label: string,
  langCode?: string,
  lang: AppLanguage = currentActiveLanguage
): string {
  const code = (langCode || '').trim().toLowerCase();
  const entry = code ? TRACK_LANG_NAMES[code] : undefined;
  let out = label;
  if (entry) {
    const upperCode = code.toUpperCase();
    if (out === upperCode || out.startsWith(`${upperCode} · `)) {
      out = out.replace(upperCode, entry[lang]);
    } else if (lang === 'ro') {
      out = out.replace(new RegExp(`\\b${entry.en}\\b`, 'i'), entry.ro);
    } else {
      out = out.replace(new RegExp(`\\b${entry.ro}\\b`, 'i'), entry.en);
    }
  }
  if (lang === 'ro') {
    out = out
      .replace(/\bDefault\b/gi, 'Implicit')
      .replace(/\bForced\b/gi, 'Forțat')
      .replace(/\bTrack #/gi, 'Pista #')
      .replace(/\bSubtitle #/gi, 'Subtitrare #');
  }
  return out;
}

const EN_STRINGS = {
  // Language names
  langLabel: 'Language',
  langEnglish: 'English',
  langRomanian: 'Română',

  // Navigation
  navHome: 'Home',
  navMovies: 'Movies',
  navSeries: 'Series',
  navMyList: 'My List',
  navDownloads: 'Downloads',
  navFamily: 'Family',
  navSearch: 'Search',
  searchPlaceholderShort: 'Search titles, actors, year...',
  searchPlaceholderLong: 'Search movies, series, genres, or year...',
  searchPlaceholderTv: 'Search movies, series, actors, or year...',
  demoMode: 'DEMO MODE',
  demoPreview: 'Demo Preview',
  serverAdmin: 'Server Administrator',
  familyMember: 'Family Member',
  switchProfile: 'Switch Profile',
  manageFamilyAccounts: 'Manage Family Accounts',
  checkForUpdates: 'Check for Updates',
  signOut: 'Sign Out',

  // Login & Who's Watching
  back: 'Back',
  whosWatching: "Who's watching?",
  signInSubtitle: 'Sign in with your personal family account',
  activeNow: 'Active now',
  ready: 'Ready',
  passwordProtected: 'Password protected',
  signIn: 'Sign In',
  signingIn: 'Connecting...',
  addAccount: 'Add Account',
  otherProfile: 'Other profile',
  manageDeviceProfiles: 'Manage Device Profiles',
  doneManaging: 'Done Managing',
  backToWhosWatching: "Back to Who's Watching",
  username: 'Username',
  usernamePlaceholder: 'Enter your family username',
  password: 'Password',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  serverLabel: 'Server',
  orPreviewNow: 'OR PREVIEW NOW',
  launchDemoPreview: 'Launch Demo Preview (No Server Needed)',
  hostedOn: 'Hosted on',
  removeFromDevice: 'Remove from this device',

  // Home & Catalog
  loadingCinema: 'Loading your cinema...',
  retry: 'Retry',
  openOfflineDownloads: 'Open Offline Downloads',
  continueWatching: 'Continue Watching',
  upNext: 'Up Next',
  recentlyAdded: 'Recently Added',
  collections: 'Collections',
  allLibraries: 'All Libraries',
  allMovies: 'All Movies',
  allSeries: 'All TV Series',
  allTitles: 'All Titles',
  tvSeries: 'TV Series',
  catalog: 'Catalog',
  searchCatalog: 'Search Catalog',
  clear: 'Clear',
  clearFilters: 'Clear Filters',
  reset: 'Reset',
  genres: 'Genres',
  allGenres: 'All Genres',
  sortRecent: 'Recently Added',
  sortRecentShort: 'Recent',
  sortTopRated: 'Top Rated',
  sortYear: 'Year (Newest)',
  sortNewestShort: 'Newest',
  sortAz: 'Title (A–Z)',
  sortAzShort: 'A–Z',
  castAndCrew: 'Cast & Crew',
  emptyMyList: 'Your list is empty. Add any movie or series to My List to find it here.',
  emptyLibrary: 'No titles in this library yet.',
  noTitlesFound: 'No titles found',
  pressBackAgainToExit: 'Press Back again to exit',
  checkingForUpdates: 'Checking for updates...',
  onLatestVersion: "You're on the latest version",
  sessionExpiredNotice: 'Your session expired or your password was updated. Please sign in again.',
  offlineShowingCached: 'Offline · showing cached catalog',
  markedPlayed: 'Marked as played',
  markedUnplayed: 'Marked as unplayed',
  couldNotUpdateWatched: 'Could not update watched status',
  removedFromContinue: 'Removed from Continue Watching',
  couldNotUpdateContinue: 'Could not update Continue Watching',

  // Hero & Media Cards
  featuredSeries: 'Featured Series',
  featuredFilm: 'Featured Film',
  playNow: 'Play Now',
  play: 'Play',
  resume: 'Resume',
  moreInfo: 'More Info',
  inMyList: 'In My List',
  addToMyList: 'Add to My List',
  removeFromMyList: 'Remove from My List',
  collectionBadge: 'Collection',
  seriesBadge: 'Series',
  movieBadge: 'Movie',
  markAsPlayed: 'Mark as played',
  markAsUnplayed: 'Mark as unplayed',
  removeFromContinueWatching: 'Remove from Continue Watching',

  // Detail Modal
  close: 'Close',
  seasonsCount: 'Seasons',
  endsAt: 'Ends at',
  watched: 'Watched',
  played: 'Played',
  markPlayedBtn: 'Mark Played',
  restart: 'Restart',
  playFromBeginning: 'Play from beginning',
  playOffline: 'Play Offline',
  trailer: 'Trailer',
  openTrailer: 'Open Trailer',
  trailerExternalNote: 'This trailer opens externally in your browser.',
  download: 'Download',
  preparing: 'Preparing...',
  downloadForOffline: 'Download for Offline',
  downloadCompactHint: 'Pick a compact mobile size (~1–1.5 GB) instead of storing a 10+ GB file.',
  bestBadge: 'Best',
  saveInsideApp: 'Save Inside App (Watch Offline)',
  saveMp4ToPhone: 'Save .mp4 to Phone',
  videoLabel: 'Video',
  audioLabel: 'Audio',
  subtitlesLabel: 'Subtitles',
  off: 'Off',
  directorLabel: 'Director',
  writerLabel: 'Writer',
  studioLabel: 'Studio',
  tagsLabel: 'Tags:',
  showLess: 'Show less',
  moreCountSuffix: 'more',
  episodes: 'Episodes',
  loadingEpisodes: 'Loading episodes...',
  titlesInCollection: 'Titles in this Collection',
  loadingCollection: 'Loading collection titles...',
  noCollectionTitles: 'No titles found in this collection.',
  chapters: 'Chapters',
  moreLikeThis: 'More Like This',
  searchingLibrary: 'Searching your library...',

  // Downloads View
  offlineDownloadsTitle: 'Offline Downloads',
  offlineDownloadsSubtitle:
    'Saved inside the app for instant, zero-buffering playback — even in Airplane Mode.',
  usedLabel: 'used',
  freeLabel: 'free',
  clearAll: 'Clear All',
  downloadingNow: 'Downloading Now',
  startingStreamServer: 'Starting stream on server...',
  finalizingOfflineFile: 'Finalizing offline file...',
  cancel: 'Cancel',
  noOfflineDownloadsTitle: 'No offline downloads yet',
  noOfflineDownloadsDesc:
    'Open any movie or TV episode and tap Download to save a compact Mobile HD copy (~1.3 GB instead of 10+ GB) for instant, buffer-free offline viewing.',
  deleteOfflineCopy: 'Delete offline copy',

  // Update Modal
  updateAvailable: 'Update Available',
  updateReadyDesc:
    'A newer version of Qualiadept Stream is ready with the latest playback improvements and fixes.',
  downloadStarted: 'Download started!',
  updateNow: 'Update Now',
  downloadAgain: 'Download Again',
  later: 'Later',
  openReleasePage: 'Open release page',

  // Family Admin View
  adminOnlyTitle: 'Administrator Access Only',
  adminOnlyDesc: 'Only the owner account can manage family profiles.',
  familyAndProfiles: 'Family & Profiles',
  refresh: 'Refresh',
  addFamilyMember: 'Add Family Member',
  newFamilyMember: 'New Family Member',
  newFamilyMemberDesc:
    'Created as a standard viewer (Admin & Delete permissions permanently disabled).',
  passwordMinChars: 'Password (min 4 chars)',
  contentAccess: 'Content Access',
  tierAdult: 'Adult',
  tierAdultDesc: 'All titles',
  tierTeen: 'Teen',
  tierTeenDesc: 'Up to PG-13',
  tierKids: 'Kids',
  tierKidsDesc: 'PG & G only',
  maxSimultaneousStreams: 'Max Simultaneous Streams',
  allowTranscodingLabel: 'Allow video transcoding (needed for mobile 720p/480p)',
  showOnWhosWatchingLabel: 'Show avatar on "Who\'s Watching?" picker',
  creating: 'Creating...',
  createAccount: 'Create Account',
  watchingNow: 'Watching Now',
  noActiveStreams: 'No active streams right now — server CPU is idle.',
  accounts: 'Accounts',
  loadingFamilyAccounts: 'Loading family accounts...',
  pausedBadge: 'Paused',
  pauseBtn: 'Pause',
  unpauseBtn: 'Unpause',
  saveBtn: 'Save',
  deleteBtn: 'Delete',

  // Video Player
  pause: 'Pause',
  nextEpisode: 'Next Episode',
  upNextIn: 'Up Next in',
  backToClose: '↩ Back to close',
  backToBrowse: 'Back to Browse',
  reconnect: 'Reconnect',
  nativePlayer: 'Native Player',
  tryOriginal: 'Try Original',
  buffering: 'Buffering...',
  brightness: 'Brightness',
  stopCasting: 'Stop Casting',
  pauseOnTv: 'Pause on TV',
  playOnTv: 'Play on TV',
  settings: 'Settings',
  playbackSettings: 'Playback Settings',
  streamQuality: 'Stream Quality',
  aspectRatio: 'Aspect Ratio',
  aspectAuto: 'Auto',
  aspectAutoDesc: 'Original picture aspect ratio',
  aspectCover: 'Cover / Fill',
  aspectCoverDesc: 'Eliminate black bars by filling screen',
  aspectZoom: 'Zoom (115%)',
  aspectZoomDesc: 'Slight cinematic zoom for ultrawide films',
  aspectFill: 'Stretch',
  aspectFillDesc: 'Stretch video to fill full frame',
  playbackSpeed: 'Playback Speed',
  normalSpeed: '1x (Normal)',
  repeatMode: 'Repeat Mode',
  repeatNone: 'None',
  repeatNoneDesc: 'Stop or play next episode at end',
  repeatOne: 'Repeat One',
  repeatOneDesc: 'Loop this video continuously',
  playbackInfo: 'Playback Info',
  on: 'On',
  playMethod: 'Play Method',
  directPlay: 'Direct Play',
  directRemux: 'Direct Remux',
  losslessVideoRemux: 'Lossless Video Remux',
  transcoded: 'Transcoded',
  decodedOutput: 'Decoded Output',
  verifyingFrame: 'Verifying frame...',
  sourceFile: 'Source File',
  sourceBitrate: 'Source Bitrate',
  networkBuffer: 'Network / Buffer',
  speedAspect: 'Speed / Aspect',
  droppedFrames: 'Dropped Frames',
  originalQuality: 'Original',
  originalUntouchedDesc: 'Untouched source quality (Direct Play / Lossless Remux)',
  autoStabilityTitle: 'Auto (Stability First)',
  autoStabilityDesc: 'Auto-adjusts quality if connection buffers',
  autoTvHotspotTitle: 'Auto (Hotspot / Weak Wi-Fi)',
  autoTvHotspotDesc: 'Automatically lowers resolution only if playback stalls',
  audioAndSubtitles: 'Audio & Subtitles',
  loadingSubtitles: 'Loading subtitles...',
  sizeLabel: 'Size',
  styleLabel: 'Style',
  stylePill: 'Pill',
  styleOutline: 'Shadow',
  styleBox: 'Box',
  syncLabel: 'Sync',
  somethingWentWrong: 'Something went wrong',
  reloadApp: 'Reload App',
};

const RO_STRINGS: typeof EN_STRINGS = {
  // Language names
  langLabel: 'Limbă',
  langEnglish: 'English',
  langRomanian: 'Română',

  // Navigation
  navHome: 'Acasă',
  navMovies: 'Filme',
  navSeries: 'Seriale',
  navMyList: 'Lista mea',
  navDownloads: 'Descărcări',
  navFamily: 'Familie',
  navSearch: 'Caută',
  searchPlaceholderShort: 'Caută titluri, actori, an...',
  searchPlaceholderLong: 'Caută filme, seriale, genuri sau an...',
  searchPlaceholderTv: 'Caută filme, seriale, actori sau an...',
  demoMode: 'MOD DEMO',
  demoPreview: 'Previzualizare Demo',
  serverAdmin: 'Administrator server',
  familyMember: 'Membru al familiei',
  switchProfile: 'Schimbă profilul',
  manageFamilyAccounts: 'Administrează conturile',
  checkForUpdates: 'Verifică actualizări',
  signOut: 'Deconectare',

  // Login & Who's Watching
  back: 'Înapoi',
  whosWatching: 'Cine vizionează?',
  signInSubtitle: 'Conectează-te cu contul tău de familie',
  activeNow: 'Activ acum',
  ready: 'Pregătit',
  passwordProtected: 'Protejat cu parolă',
  signIn: 'Conectare',
  signingIn: 'Se conectează...',
  addAccount: 'Adaugă cont',
  otherProfile: 'Alt profil',
  manageDeviceProfiles: 'Administrează profilurile',
  doneManaging: 'Gata',
  backToWhosWatching: 'Înapoi la Cine vizionează?',
  username: 'Utilizator',
  usernamePlaceholder: 'Introdu numele de utilizator',
  password: 'Parolă',
  showPassword: 'Arată parola',
  hidePassword: 'Ascunde parola',
  serverLabel: 'Server',
  orPreviewNow: 'SAU ÎNCEARCĂ DEMO',
  launchDemoPreview: 'Deschide modul Demo (fără server)',
  hostedOn: 'Găzduit pe',
  removeFromDevice: 'Elimină de pe acest dispozitiv',

  // Home & Catalog
  loadingCinema: 'Se încarcă biblioteca...',
  retry: 'Reîncearcă',
  openOfflineDownloads: 'Deschide descărcările offline',
  continueWatching: 'Continuă vizionarea',
  upNext: 'Urmează',
  recentlyAdded: 'Adăugate recent',
  collections: 'Colecții',
  allLibraries: 'Toate bibliotecile',
  allMovies: 'Toate filmele',
  allSeries: 'Toate serialele',
  allTitles: 'Toate titlurile',
  tvSeries: 'Seriale TV',
  catalog: 'Catalog',
  searchCatalog: 'Caută în catalog',
  clear: 'Șterge',
  clearFilters: 'Resetează filtrele',
  reset: 'Resetează',
  genres: 'Genuri',
  allGenres: 'Toate genurile',
  sortRecent: 'Adăugate recent',
  sortRecentShort: 'Recente',
  sortTopRated: 'Cele mai apreciate',
  sortYear: 'An (Cele mai noi)',
  sortNewestShort: 'Cele mai noi',
  sortAz: 'Titlu (A–Z)',
  sortAzShort: 'A–Z',
  castAndCrew: 'Distribuție',
  emptyMyList: 'Lista ta este goală. Adaugă orice film sau serial în Lista mea pentru a-l găsi rapid aici.',
  emptyLibrary: 'Nu există încă titluri în această bibliotecă.',
  noTitlesFound: 'Nu s-au găsit titluri',
  pressBackAgainToExit: 'Apasă Înapoi încă o dată pentru a ieși',
  checkingForUpdates: 'Se verifică actualizările...',
  onLatestVersion: 'Ai deja cea mai nouă versiune',
  sessionExpiredNotice: 'Sesiunea a expirat sau parola a fost schimbată. Te rugăm să te conectezi din nou.',
  offlineShowingCached: 'Offline · se afișează catalogul salvat',
  markedPlayed: 'Marcat ca văzut',
  markedUnplayed: 'Marcat ca nevăzut',
  couldNotUpdateWatched: 'Nu s-a putut actualiza starea de vizionare',
  removedFromContinue: 'Eliminat din Continuă vizionarea',
  couldNotUpdateContinue: 'Nu s-a putut actualiza Continuă vizionarea',

  // Hero & Media Cards
  featuredSeries: 'Serial recomandat',
  featuredFilm: 'Film recomandat',
  playNow: 'Redă acum',
  play: 'Redă',
  resume: 'Continuă',
  moreInfo: 'Mai multe detalii',
  inMyList: 'În Lista mea',
  addToMyList: 'Adaugă în Lista mea',
  removeFromMyList: 'Elimină din Lista mea',
  collectionBadge: 'Colecție',
  seriesBadge: 'Serial',
  movieBadge: 'Film',
  markAsPlayed: 'Marchează ca văzut',
  markAsUnplayed: 'Marchează ca nevăzut',
  removeFromContinueWatching: 'Elimină din Continuă vizionarea',

  // Detail Modal
  close: 'Închide',
  seasonsCount: 'Sezoane',
  endsAt: 'Se termină la',
  watched: 'Văzut',
  played: 'Văzut',
  markPlayedBtn: 'Marchează văzut',
  restart: 'De la început',
  playFromBeginning: 'Redă de la început',
  playOffline: 'Redă offline',
  trailer: 'Trailer',
  openTrailer: 'Deschide trailerul',
  trailerExternalNote: 'Acest trailer se deschide extern în browser.',
  download: 'Descarcă',
  preparing: 'Se pregătește...',
  downloadForOffline: 'Descarcă offline',
  downloadCompactHint: 'Alege o variantă compactă (~1–1,5 GB) în locul fișierului mare de 10+ GB.',
  bestBadge: 'Optim',
  saveInsideApp: 'Salvează în aplicație (Offline)',
  saveMp4ToPhone: 'Salvează .mp4 pe telefon',
  videoLabel: 'Video',
  audioLabel: 'Audio',
  subtitlesLabel: 'Subtitrări',
  off: 'Oprit',
  directorLabel: 'Regia',
  writerLabel: 'Scenariul',
  studioLabel: 'Studio',
  tagsLabel: 'Etichete:',
  showLess: 'Mai puțin',
  moreCountSuffix: 'în plus',
  episodes: 'Episoade',
  loadingEpisodes: 'Se încarcă episoadele...',
  titlesInCollection: 'Titluri în această colecție',
  loadingCollection: 'Se încarcă colecția...',
  noCollectionTitles: 'Nu s-au găsit titluri în această colecție.',
  chapters: 'Capitole',
  moreLikeThis: 'Titluri similare',
  searchingLibrary: 'Se caută în bibliotecă...',

  // Downloads View
  offlineDownloadsTitle: 'Descărcări offline',
  offlineDownloadsSubtitle:
    'Salvate direct în aplicație pentru redare instantanee, fără buffering — chiar și în Mod Avion.',
  usedLabel: 'folosit',
  freeLabel: 'liber',
  clearAll: 'Șterge tot',
  downloadingNow: 'Se descarcă acum',
  startingStreamServer: 'Se pornește fluxul pe server...',
  finalizingOfflineFile: 'Se salvează fișierul offline...',
  cancel: 'Anulează',
  noOfflineDownloadsTitle: 'Nicio descărcare offline încă',
  noOfflineDownloadsDesc:
    'Deschide orice film sau episod și apasă Descarcă pentru a salva o copie HD compactă (~1,3 GB în loc de 10+ GB) pentru vizionare fără internet.',
  deleteOfflineCopy: 'Șterge copia offline',

  // Update Modal
  updateAvailable: 'Actualizare disponibilă',
  updateReadyDesc:
    'O versiune nouă Qualiadept Stream este disponibilă cu cele mai noi îmbunătățiri de redare.',
  downloadStarted: 'Descărcarea a început!',
  updateNow: 'Actualizează acum',
  downloadAgain: 'Descarcă din nou',
  later: 'Mai târziu',
  openReleasePage: 'Deschide pagina versiunii',

  // Family Admin View
  adminOnlyTitle: 'Acces doar pentru administrator',
  adminOnlyDesc: 'Doar contul principal poate administra profilurile familiei.',
  familyAndProfiles: 'Familie și profiluri',
  refresh: 'Reîmprospătează',
  addFamilyMember: 'Adaugă membru',
  newFamilyMember: 'Membru nou al familiei',
  newFamilyMemberDesc:
    'Creat ca profil standard (fără drepturi de administrare sau ștergere).',
  passwordMinChars: 'Parolă (min. 4 caractere)',
  contentAccess: 'Nivel acces conținut',
  tierAdult: 'Adult',
  tierAdultDesc: 'Toate titlurile',
  tierTeen: 'Adolescent',
  tierTeenDesc: 'Până la PG-13',
  tierKids: 'Copii',
  tierKidsDesc: 'Doar PG și G',
  maxSimultaneousStreams: 'Redări simultane maxime',
  allowTranscodingLabel: 'Permite transcodarea video (necesar pentru 720p/480p pe mobil)',
  showOnWhosWatchingLabel: 'Afișează profilul în ecranul „Cine vizionează?”',
  creating: 'Se creează...',
  createAccount: 'Creează contul',
  watchingNow: 'Vizionează acum',
  noActiveStreams: 'Nicio redare activă în acest moment — serverul este liber.',
  accounts: 'Conturi',
  loadingFamilyAccounts: 'Se încarcă conturile...',
  pausedBadge: 'Suspendat',
  pauseBtn: 'Suspendă',
  unpauseBtn: 'Reactivează',
  saveBtn: 'Salvează',
  deleteBtn: 'Șterge',

  // Video Player
  pause: 'Pauză',
  nextEpisode: 'Episodul următor',
  upNextIn: 'Urmează în',
  backToClose: '↩ Înapoi pt. închidere',
  backToBrowse: 'Înapoi la catalog',
  reconnect: 'Reconectează',
  nativePlayer: 'Player nativ',
  tryOriginal: 'Încearcă Original',
  buffering: 'Se încarcă...',
  brightness: 'Luminozitate',
  stopCasting: 'Oprește Cast',
  pauseOnTv: 'Pauză pe TV',
  playOnTv: 'Redă pe TV',
  settings: 'Setări',
  playbackSettings: 'Setări redare',
  streamQuality: 'Calitate video',
  aspectRatio: 'Format imagine',
  aspectAuto: 'Automat',
  aspectAutoDesc: 'Raportul original al imaginii',
  aspectCover: 'Umplere ecran',
  aspectCoverDesc: 'Elimină barele negre prin umplerea ecranului',
  aspectZoom: 'Zoom (115%)',
  aspectZoomDesc: 'Zoom cinematic ușor pentru filme ultrawide',
  aspectFill: 'Întins',
  aspectFillDesc: 'Întinde imaginea pe tot ecranul',
  playbackSpeed: 'Viteză de redare',
  normalSpeed: '1x (Normal)',
  repeatMode: 'Repetare',
  repeatNone: 'Fără',
  repeatNoneDesc: 'Oprește sau trece la episodul următor la final',
  repeatOne: 'Repetă',
  repeatOneDesc: 'Redă acest videoclip în buclă',
  playbackInfo: 'Informații redare',
  on: 'Activ',
  playMethod: 'Metodă redare',
  directPlay: 'Redare directă',
  directRemux: 'Remux direct',
  losslessVideoRemux: 'Remux video fără pierderi',
  transcoded: 'Transcodat',
  decodedOutput: 'Rezoluție activă',
  verifyingFrame: 'Se verifică imaginea...',
  sourceFile: 'Fișier sursă',
  sourceBitrate: 'Bitrate sursă',
  networkBuffer: 'Rețea / Buffer',
  speedAspect: 'Viteză / Format',
  droppedFrames: 'Cadre pierdute',
  originalQuality: 'Original',
  originalUntouchedDesc: 'Calitate sursă neatinsă (Redare directă / Remux fără pierderi)',
  autoStabilityTitle: 'Auto (Stabilitate)',
  autoStabilityDesc: 'Ajustează automat calitatea dacă rețeaua încetinește',
  autoTvHotspotTitle: 'Auto (Hotspot / Wi-Fi slab)',
  autoTvHotspotDesc: 'Scade automat rezoluția doar dacă redarea se întrerupe',
  audioAndSubtitles: 'Audio și subtitrări',
  loadingSubtitles: 'Se încarcă subtitrarea...',
  sizeLabel: 'Mărime',
  styleLabel: 'Stil',
  stylePill: 'Pastilă',
  styleOutline: 'Umbră',
  styleBox: 'Chenar',
  syncLabel: 'Sincronizare',
  somethingWentWrong: 'A apărut o problemă',
  reloadApp: 'Reîncarcă aplicația',
};

export type TranslationDictionary = typeof EN_STRINGS;
export type TranslationKey = keyof TranslationDictionary;

interface I18nContextValue {
  lang: AppLanguage;
  setLang: (next: AppLanguage) => void;
  toggleLang: () => void;
  t: TranslationDictionary;
}

const I18nContext = createContext<I18nContextValue>({
  lang: currentActiveLanguage,
  setLang: () => {},
  toggleLang: () => {},
  t: currentActiveLanguage === 'ro' ? RO_STRINGS : EN_STRINGS,
});

export const I18nProvider: React.FC<{
  activeUserId?: string | null;
  isHiddenProfile?: boolean;
  children: React.ReactNode;
}> = ({ activeUserId, isHiddenProfile, children }) => {
  const [lang, setLangState] = useState<AppLanguage>(() =>
    getSavedLanguageForProfile(activeUserId, isHiddenProfile)
  );

  // Automatically restore each family member's preferred language when switching profiles!
  useEffect(() => {
    const profileLang = getSavedLanguageForProfile(activeUserId, isHiddenProfile);
    currentActiveLanguage = profileLang;
    setLangState(profileLang);
  }, [activeUserId, isHiddenProfile]);

  useEffect(() => {
    currentActiveLanguage = lang;
    try {
      document.documentElement.lang = lang;
    } catch {
      // Ignore DOM errors
    }
  }, [lang]);

  const setLang = useCallback(
    (next: AppLanguage) => {
      currentActiveLanguage = next;
      setLangState(next);
      try {
        if (!isHiddenProfile) {
          localStorage.setItem(DEFAULT_LANG_KEY, next);
        }
        if (activeUserId) {
          const store = isHiddenProfile ? sessionStorage : localStorage;
          store.setItem(`${PROFILE_LANG_PREFIX}${activeUserId}`, next);
        }
      } catch {
        // Ignore storage quota errors
      }
    },
    [activeUserId, isHiddenProfile]
  );

  const toggleLang = useCallback(() => {
    setLang(lang === 'en' ? 'ro' : 'en');
  }, [lang, setLang]);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      toggleLang,
      t: lang === 'ro' ? RO_STRINGS : EN_STRINGS,
    }),
    [lang, setLang, toggleLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
