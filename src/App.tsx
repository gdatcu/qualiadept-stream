import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Folder, Search, Star, X } from 'lucide-react';
import { BrowseFilterBar, type SortOption } from './components/BrowseFilterBar';
import { DetailModal } from './components/DetailModal';
import { HeroBanner } from './components/HeroBanner';
import { LoginScreen } from './components/LoginScreen';
import { MediaRow } from './components/MediaRow';
import { Navbar, type NavTab } from './components/Navbar';
import { UpdateModal } from './components/UpdateModal';
import {
  APP_VERSION_NAME,
  checkForAppUpdate,
  isCapacitorNativeApp,
  type AppUpdateInfo,
} from './services/appUpdate';
import {
  SessionExpiredError,
  clearCachedLibrary,
  clearSession,
  fetchCollections,
  fetchLibraryItems,
  fetchNextUpEpisodes,
  fetchPersonItems,
  fetchResumeItems,
  fetchUserViews,
  loadCachedLibrary,
  loadSavedSession,
  refreshSessionProfile,
  removeFromContinueWatching,
  removeSavedProfile,
  saveCachedLibrary,
  searchJellyfinCatalog,
  toggleFavorite,
  togglePlayedStatus,
} from './services/jellyfin';
import {
  listActiveDownloads,
  listOfflineRecords,
  subscribeOfflineDownloads,
} from './services/offlineDownloads';
import { getLocalizedTitleInfo, prefetchOfficialRoMeta } from './services/tmdb';
import { getCachedTranslation } from './services/translate';
import { useOfficialRoMetaVersion } from './components/TranslatedOverview';
import type {
  AuthSession,
  LibraryView,
  MediaItem,
  PersonCredit,
  PlaybackStartOptions,
} from './types/media';
import {
  I18nProvider,
  translateGenre,
  translateLibraryName,
  useI18n,
} from './i18n';
import { exitTizenApp, initTvNavigation, isTizenTv } from './utils/tvNavigation';

const DownloadsView = lazy(() =>
  import('./components/DownloadsView').then((m) => ({ default: m.DownloadsView }))
);
const FamilyAdminView = lazy(() =>
  import('./components/FamilyAdminView').then((m) => ({ default: m.FamilyAdminView }))
);
const VideoPlayer = lazy(() =>
  import('./components/VideoPlayer').then((m) => ({ default: m.VideoPlayer }))
);

const LazyViewFallback: React.FC<{ fullscreen?: boolean }> = ({ fullscreen }) => (
  <div
    className={
      fullscreen
        ? 'fixed inset-0 z-50 flex items-center justify-center bg-black'
        : 'flex min-h-[60vh] items-center justify-center pt-28'
    }
  >
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
  </div>
);

export const App: React.FC = () => {
  const [session, setSession] = useState<AuthSession | null>(() => loadSavedSession());
  const [switchingProfile, setSwitchingProfile] = useState(false);

  return (
    <I18nProvider
      activeUserId={switchingProfile ? null : session?.userId}
      isHiddenProfile={session?.isHidden}
    >
      <AppContent
        session={session}
        setSession={setSession}
        switchingProfile={switchingProfile}
        setSwitchingProfile={setSwitchingProfile}
      />
    </I18nProvider>
  );
};

interface AppContentProps {
  session: AuthSession | null;
  setSession: React.Dispatch<React.SetStateAction<AuthSession | null>>;
  switchingProfile: boolean;
  setSwitchingProfile: React.Dispatch<React.SetStateAction<boolean>>;
}

const AppContent: React.FC<AppContentProps> = ({
  session,
  setSession,
  switchingProfile,
  setSwitchingProfile,
}) => {
  const { lang, t } = useI18n();
  const roMetaVersion = useOfficialRoMetaVersion(lang === 'ro');
  const tRef = useRef(t);
  tRef.current = t;
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [items, setItems] = useState<MediaItem[]>(() => {
    const saved = loadSavedSession();
    if (!saved || saved.isDemo) return [];
    return loadCachedLibrary(saved.userId)?.items || [];
  });
  const [resumeItems, setResumeItems] = useState<MediaItem[]>(() => {
    const saved = loadSavedSession();
    if (!saved || saved.isDemo) return [];
    return loadCachedLibrary(saved.userId)?.resumeItems || [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [tvSearchOpen, setTvSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
  const [playStartOptions, setPlayStartOptions] = useState<PlaybackStartOptions | undefined>(
    undefined
  );
  const [libraryViews, setLibraryViews] = useState<LibraryView[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [libraryViewItems, setLibraryViewItems] = useState<MediaItem[] | null>(null);
  const [collections, setCollections] = useState<MediaItem[]>([]);
  const [nextUpItems, setNextUpItems] = useState<MediaItem[]>([]);
  const [remoteSearchItems, setRemoteSearchItems] = useState<MediaItem[]>([]);
  const [remoteSearchPeople, setRemoteSearchPeople] = useState<PersonCredit[]>([]);
  const [selectedSearchPerson, setSelectedSearchPerson] = useState<PersonCredit | null>(null);
  const [selectedSearchPersonItems, setSelectedSearchPersonItems] = useState<MediaItem[]>([]);
  const [showExitToast, setShowExitToast] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [offlineCount, setOfflineCount] = useState(() => listOfflineRecords().length);
  const [activeDownloadCount, setActiveDownloadCount] = useState(
    () => listActiveDownloads().length
  );

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const errorRef = useRef(error);
  errorRef.current = error;
  const lastSyncTsRef = useRef(0);
  const switchingProfileRef = useRef(switchingProfile);
  switchingProfileRef.current = switchingProfile;
  const availableUpdateRef = useRef(availableUpdate);
  availableUpdateRef.current = availableUpdate;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const tvSearchOpenRef = useRef(tvSearchOpen);
  tvSearchOpenRef.current = tvSearchOpen;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const selectedGenreRef = useRef(selectedGenre);
  selectedGenreRef.current = selectedGenre;
  const selectedItemRef = useRef(selectedItem);
  selectedItemRef.current = selectedItem;
  const playingItemRef = useRef(playingItem);
  playingItemRef.current = playingItem;
  const exitConfirmUntilRef = useRef(0);
  const exitToastTimerRef = useRef<number | null>(null);
  const statusToastTimerRef = useRef<number | null>(null);

  const flashStatusToast = useCallback((msg: string) => {
    setStatusToast(msg);
    if (statusToastTimerRef.current) window.clearTimeout(statusToastTimerRef.current);
    statusToastTimerRef.current = window.setTimeout(() => {
      setStatusToast(null);
    }, 3200);
  }, []);

  useEffect(() => {
    const syncCounts = () => {
      setOfflineCount(listOfflineRecords().length);
      setActiveDownloadCount(listActiveDownloads().length);
    };
    syncCounts();
    return subscribeOfflineDownloads(syncCounts);
  }, []);

  // Automatically check GitHub Releases for a newer signed Android APK 2s after app startup
  useEffect(() => {
    if (!isCapacitorNativeApp()) return;
    let active = true;
    const timer = window.setTimeout(() => {
      checkForAppUpdate().then((info) => {
        if (active && info) {
          setAvailableUpdate(info);
        }
      });
    }, 2000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const handleManualUpdateCheck = useCallback(async () => {
    flashStatusToast(tRef.current.checkingForUpdates);
    const info = await checkForAppUpdate({ force: true });
    if (info) {
      setStatusToast(null);
      setAvailableUpdate(info);
    } else {
      flashStatusToast(`${tRef.current.onLatestVersion} (v${APP_VERSION_NAME})`);
    }
  }, [flashStatusToast]);

  const handleSessionExpired = useCallback((expiredSession: AuthSession) => {
    if (!expiredSession.isDemo) {
      removeSavedProfile(expiredSession.userId);
    }
    clearSession();
    setSession(null);
    setSwitchingProfile(false);
    setItems([]);
    setResumeItems([]);
    setSelectedItem(null);
    setPlayingItem(null);
    setError(null);
    setSessionNotice(tRef.current.sessionExpiredNotice);
  }, [setSession, setSwitchingProfile]);

  const closePlayer = useCallback(() => {
    setPlayingItem(null);
    setPlayStartOptions(undefined);
    const activeSession = sessionRef.current;
    if (activeSession && !activeSession.isDemo && navigator.onLine !== false) {
      fetchResumeItems(activeSession)
        .then((nextResume) => {
          setResumeItems(nextResume);
          if (!activeSession.isHidden && itemsRef.current.length > 0) {
            saveCachedLibrary(activeSession.userId, itemsRef.current, nextResume);
          }
        })
        .catch((err) => {
          if (err instanceof SessionExpiredError) {
            handleSessionExpired(activeSession);
          }
        });
    }
  }, [handleSessionExpired]);

  const loadLibrary = useCallback(
    async (activeSession: AuthSession, options?: { background?: boolean }) => {
      const cached =
        !activeSession.isDemo && !activeSession.isHidden
          ? loadCachedLibrary(activeSession.userId)
          : null;
      const hasVisibleCatalog = Boolean(options?.background || (cached && cached.items.length > 0));

      if (!hasVisibleCatalog) {
        setLoading(true);
      }
      setError(null);
      try {
        const [library, resume, views, boxSets, nextUp] = await Promise.all([
          fetchLibraryItems(activeSession),
          fetchResumeItems(activeSession),
          fetchUserViews(activeSession),
          fetchCollections(activeSession),
          fetchNextUpEpisodes(activeSession),
        ]);
        lastSyncTsRef.current = Date.now();
        setItems(library);
        setResumeItems(resume);
        setLibraryViews(views);
        setCollections(boxSets);
        setNextUpItems(nextUp);
        if (!activeSession.isDemo && !activeSession.isHidden) {
          saveCachedLibrary(activeSession.userId, library, resume);
        }
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          handleSessionExpired(activeSession);
          return;
        }
        // Only show blocking error screen when there is no cached catalog to display
        if (!hasVisibleCatalog && itemsRef.current.length === 0) {
          setError(err instanceof Error ? err.message : 'Failed to load library');
        } else if (!options?.background) {
          flashStatusToast(tRef.current.offlineShowingCached);
        }
        // If offline / Airplane Mode and user already has saved downloads, jump straight to them
        if (navigator.onLine === false && listOfflineRecords().length > 0 && itemsRef.current.length === 0) {
          setActiveTab('downloads');
        }
      } finally {
        setLoading(false);
      }
    },
    [handleSessionExpired, flashStatusToast]
  );

  // Load items scoped to a specific Jellyfin Library View when selected
  useEffect(() => {
    if (!session || !selectedLibraryId) {
      setLibraryViewItems(null);
      return;
    }
    let active = true;
    fetchLibraryItems(session, selectedLibraryId)
      .then((list) => {
        if (active) setLibraryViewItems(list);
      })
      .catch(() => {
        if (active) setLibraryViewItems([]);
      });
    return () => {
      active = false;
    };
  }, [session, selectedLibraryId]);

  // Debounced live Jellyfin server search (finds actors, directors, tags, and collections)
  useEffect(() => {
    const q = searchQuery.trim();
    setSelectedSearchPerson(null);
    setSelectedSearchPersonItems([]);
    if (!session || session.isDemo || q.length < 2) {
      setRemoteSearchItems([]);
      setRemoteSearchPeople([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      searchJellyfinCatalog(session, q).then(({ items: foundItems, people: foundPeople }) => {
        if (!active) return;
        setRemoteSearchItems(foundItems);
        setRemoteSearchPeople(foundPeople);
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [session, searchQuery]);

  useEffect(() => {
    return initTvNavigation();
  }, []);

  // Auto-recover when mobile network returns or app comes back to foreground
  useEffect(() => {
    const onOnline = () => {
      const active = sessionRef.current;
      if (!active || active.isDemo) return;
      if (errorRef.current || itemsRef.current.length === 0 || Date.now() - lastSyncTsRef.current > 30_000) {
        loadLibrary(active, { background: itemsRef.current.length > 0 });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const active = sessionRef.current;
      if (!active || active.isDemo || playingItemRef.current || navigator.onLine === false) return;
      if (errorRef.current || Date.now() - lastSyncTsRef.current > 60_000) {
        loadLibrary(active, { background: itemsRef.current.length > 0 });
      }
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadLibrary]);

  // Samsung Android / Mobile Back button navigation guard (works in Chrome, PWA & Capacitor APK):
  // Navigates back through Update -> Profile Switch -> Player -> Detail -> Search -> Tabs -> Home, then asks for double-Back to exit.
  useEffect(() => {
    const armBackGuard = () => {
      try {
        if (!window.history.state?.qsGuard) {
          window.history.pushState({ qsGuard: true }, '', window.location.href);
        }
      } catch {
        // Ignore history restrictions
      }
    };

    armBackGuard();
    // Re-arm on user gestures so Chrome Android's History Manipulation Intervention always honors the guard
    const onUserGesture = () => armBackGuard();
    window.addEventListener('pointerdown', onUserGesture, { passive: true });
    window.addEventListener('keydown', onUserGesture, { passive: true });

    const handleBackStep = (fromTizenKey = false) => {
      if (availableUpdateRef.current) {
        setAvailableUpdate(null);
        if (!fromTizenKey) armBackGuard();
        return;
      }
      if (switchingProfileRef.current) {
        setSwitchingProfile(false);
        if (!fromTizenKey) armBackGuard();
        return;
      }
      if (playingItemRef.current) {
        closePlayer();
        if (!fromTizenKey) armBackGuard();
        return;
      }
      if (selectedItemRef.current) {
        setSelectedItem(null);
        if (!fromTizenKey) armBackGuard();
        return;
      }
      if (tvSearchOpenRef.current) {
        setTvSearchOpen(false);
        setSearchQuery('');
        setSelectedSearchPerson(null);
        setSelectedSearchPersonItems([]);
        if (!fromTizenKey) armBackGuard();
        return;
      }
      if (searchQueryRef.current.trim()) {
        setSearchQuery('');
        if (!fromTizenKey) armBackGuard();
        return;
      }
      if (selectedGenreRef.current) {
        setSelectedGenre(null);
        if (!fromTizenKey) armBackGuard();
        return;
      }
      if (activeTabRef.current !== 'home') {
        setActiveTab('home');
        if (!fromTizenKey) armBackGuard();
        return;
      }

      const now = Date.now();
      if (now < exitConfirmUntilRef.current) {
        // Confirmed second Back press within 2.2s: allow exiting cleanly
        setShowExitToast(false);
        if (fromTizenKey && isTizenTv()) {
          exitTizenApp();
        }
        return;
      }

      exitConfirmUntilRef.current = now + 2200;
      if (!fromTizenKey) armBackGuard();
      setShowExitToast(true);
      if (exitToastTimerRef.current) window.clearTimeout(exitToastTimerRef.current);
      exitToastTimerRef.current = window.setTimeout(() => {
        setShowExitToast(false);
      }, 2200);
    };

    const onPopState = () => handleBackStep(false);
    const onEscapeKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // VideoPlayer handles its own Escape/Back while mounted
      if (playingItemRef.current) return;
      handleBackStep(true);
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onEscapeKey);
    return () => {
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('keydown', onUserGesture);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onEscapeKey);
      if (exitToastTimerRef.current) window.clearTimeout(exitToastTimerRef.current);
      if (statusToastTimerRef.current) window.clearTimeout(statusToastTimerRef.current);
    };
  }, [closePlayer]);

  // Hydrate cached catalog immediately & refresh from Jellyfin whenever the active user changes
  const activeSessionKey = session ? `${session.serverUrl}:${session.userId}:${session.accessToken}` : null;
  useEffect(() => {
    if (!session) return;
    if (!session.isDemo) {
      if (session.isHidden) {
        clearCachedLibrary(session.userId);
        setItems([]);
        setResumeItems([]);
      } else {
        const cached = loadCachedLibrary(session.userId);
        if (cached) {
          setItems(cached.items);
          setResumeItems(cached.resumeItems);
        } else {
          setItems([]);
          setResumeItems([]);
        }
      }
    }
    loadLibrary(session);
    if (!session.isDemo) {
      refreshSessionProfile(session).then((refreshed) => {
        if (
          refreshed.isAdmin !== session.isAdmin ||
          refreshed.isHidden !== session.isHidden ||
          refreshed.username !== session.username
        ) {
          setSession(refreshed);
        }
      });
    }
  }, [activeSessionKey, loadLibrary]);

  const handleLogin = (nextSession: AuthSession) => {
    setSessionNotice(null);
    setSession(nextSession);
    setSwitchingProfile(false);
    setSelectedItem(null);
    setPlayingItem(null);
    setSearchQuery('');
    setActiveTab('home');
  };

  const handleSignOut = () => {
    if (session && !session.isDemo) {
      removeSavedProfile(session.userId);
      if (session.isHidden) {
        clearCachedLibrary(session.userId);
      }
    }
    clearSession();
    setSession(null);
    setSessionNotice(null);
    setSwitchingProfile(false);
    setItems([]);
    setResumeItems([]);
    setSelectedItem(null);
    setPlayingItem(null);
    setActiveTab('home');
  };

  const handleToggleFavorite = async (item: MediaItem) => {
    if (!session) return;
    try {
      const next = await toggleFavorite(session, item.id, !!item.isFavorite);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, isFavorite: next } : i))
      );
      setResumeItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, isFavorite: next } : i))
      );
      setSelectedItem((prev) =>
        prev && prev.id === item.id ? { ...prev, isFavorite: next } : prev
      );
      setPlayingItem((prev) =>
        prev && prev.id === item.id ? { ...prev, isFavorite: next } : prev
      );
    } catch {
      // Ignore transient error
    }
  };

  const handleTogglePlayed = async (item: MediaItem) => {
    if (!session) return;
    try {
      const next = await togglePlayedStatus(session, item.id, !!item.isPlayed);
      const patch = (i: MediaItem): MediaItem =>
        i.id === item.id
          ? {
              ...i,
              isPlayed: next,
              playedPercentage: next ? 100 : 0,
              resumePositionSeconds: next ? undefined : i.resumePositionSeconds,
            }
          : i;
      setItems((prev) => prev.map(patch));
      setResumeItems((prev) => (next ? prev.filter((i) => i.id !== item.id) : prev.map(patch)));
      setSelectedItem((prev) => (prev && prev.id === item.id ? patch(prev) : prev));
      flashStatusToast(next ? t.markedPlayed : t.markedUnplayed);
    } catch {
      flashStatusToast(t.couldNotUpdateWatched);
    }
  };

  const handleRemoveContinueWatching = async (item: MediaItem) => {
    if (!session) return;
    setResumeItems((prev) => prev.filter((i) => i.id !== item.id));
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, playedPercentage: 0, resumePositionSeconds: undefined } : i
      )
    );
    try {
      await removeFromContinueWatching(session, item.id);
      flashStatusToast(`${t.removedFromContinue} · ${item.name}`);
    } catch {
      flashStatusToast(t.couldNotUpdateContinue);
    }
  };

  const handleSelectSearchPerson = async (person: PersonCredit) => {
    if (!session) return;
    if (selectedSearchPerson?.id === person.id) {
      setSelectedSearchPerson(null);
      setSelectedSearchPersonItems([]);
      return;
    }
    setSelectedSearchPerson(person);
    const list = await fetchPersonItems(session, person.id);
    setSelectedSearchPersonItems(list);
  };

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (q.trim() && (activeTab === 'downloads' || activeTab === 'family')) {
      setActiveTab('home');
    }
  };

  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab);
    setTvSearchOpen(false);
    setSelectedGenre(null);
    if (isTizenTv()) {
      setSearchQuery('');
      setSortBy('recent');
    }
    if (tab !== 'home') {
      setSelectedLibraryId(null);
    }
  };

  const tabBaseItems = useMemo(() => {
    const source = activeTab === 'home' && selectedLibraryId && libraryViewItems !== null
      ? libraryViewItems
      : items;
    return source.filter((item) => {
      if (activeTab === 'movies' && item.type !== 'Movie') return false;
      if (activeTab === 'series' && item.type !== 'Series') return false;
      if (activeTab === 'mylist' && !item.isFavorite) return false;
      return true;
    });
  }, [items, libraryViewItems, selectedLibraryId, activeTab]);

  const availableGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of tabBaseItems) {
      for (const genre of item.genres) {
        if (!genre || genre === 'Featured') continue;
        counts.set(genre, (counts.get(genre) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [tabBaseItems]);

  // Background-enrich catalog items with official Romanian titles (TMDB / Wikidata) when in RO mode
  useEffect(() => {
    if (lang !== 'ro') return;
    const targets = [...items, ...resumeItems, ...remoteSearchItems];
    if (targets.length > 0) {
      prefetchOfficialRoMeta(targets);
    }
  }, [lang, items, resumeItems, remoteSearchItems]);

  const filteredItems = useMemo(() => {
    void roMetaVersion;
    if (selectedSearchPerson) {
      return selectedSearchPersonItems;
    }

    const fold = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const q = fold(searchQuery.trim());
    const localMatched = tabBaseItems.filter((item) => {
      if (selectedGenre && !item.genres.includes(selectedGenre)) return false;
      if (!q) return true;
      const cachedRoOverview = getCachedTranslation(item.overview, 'ro');
      const roTitle = getLocalizedTitleInfo(item, 'ro').title;
      return (
        fold(item.name).includes(q) ||
        (roTitle !== item.name ? fold(roTitle).includes(q) : false) ||
        fold(item.overview).includes(q) ||
        (cachedRoOverview ? fold(cachedRoOverview).includes(q) : false) ||
        String(item.year || '').includes(q) ||
        item.genres.some(
          (g) =>
            fold(g).includes(q) ||
            fold(translateGenre(g, 'ro')).includes(q) ||
            fold(translateGenre(g, 'en')).includes(q)
        )
      );
    });

    // Merge server-side Jellyfin search hits (collections, tags, aliases) without duplicates
    let matched = localMatched;
    if (q && remoteSearchItems.length > 0 && !selectedGenre) {
      const seen = new Set(localMatched.map((i) => i.id));
      const extras = remoteSearchItems.filter((i) => {
        if (seen.has(i.id)) return false;
        if (activeTab === 'movies' && i.type !== 'Movie') return false;
        if (activeTab === 'series' && i.type !== 'Series') return false;
        if (activeTab === 'mylist' && !i.isFavorite) return false;
        return true;
      });
      if (extras.length > 0) {
        matched = [...localMatched, ...extras];
      }
    }

    if (sortBy === 'rating') {
      return [...matched].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    }
    if (sortBy === 'year') {
      return [...matched].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    }
    if (sortBy === 'az') {
      return [...matched].sort((a, b) => a.name.localeCompare(b.name));
    }
    return matched;
  }, [
    tabBaseItems,
    selectedGenre,
    searchQuery,
    sortBy,
    remoteSearchItems,
    selectedSearchPerson,
    selectedSearchPersonItems,
    activeTab,
  ]);

  const isTv = isTizenTv();

  const recentlyAddedItems = useMemo(
    () => (isTv ? filteredItems.slice(0, 18) : filteredItems.slice(0, 30)),
    [filteredItems, isTv]
  );

  const genreRows = useMemo(() => {
    const maxPerRow = isTv ? 16 : 24;
    const maxRows = isTv ? 6 : 8;
    const map = new Map<string, MediaItem[]>();
    for (const item of filteredItems) {
      for (const genre of item.genres) {
        if (genre === 'Featured') continue;
        const list = map.get(genre) || [];
        if (list.length < maxPerRow) {
          list.push(item);
        }
        map.set(genre, list);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, maxRows);
  }, [filteredItems, isTv]);

  const heroItem = useMemo(() => {
    if (tabBaseItems.length === 0) return null;
    return (
      tabBaseItems.find((i) => Boolean(i.backdropUrl && i.backdropUrl !== i.posterUrl)) ||
      tabBaseItems[0]
    );
  }, [tabBaseItems]);

  const isFilteredGridMode = Boolean(
    tvSearchOpen || searchQuery.trim() || selectedGenre || sortBy !== 'recent'
  );

  const showHero = Boolean(heroItem && activeTab === 'home' && !isFilteredGridMode && !selectedLibraryId);
  const showGridSection = Boolean(
    isFilteredGridMode ||
      selectedSearchPerson ||
      selectedLibraryId ||
      activeTab === 'movies' ||
      activeTab === 'series' ||
      activeTab === 'mylist'
  );

  if (!session || switchingProfile) {
    return (
      <>
        <LoginScreen
          onLogin={handleLogin}
          onCancel={session ? () => setSwitchingProfile(false) : undefined}
          activeUserId={session?.userId}
          sessionNotice={switchingProfile ? null : sessionNotice}
        />
        {availableUpdate && (
          <UpdateModal update={availableUpdate} onClose={() => setAvailableUpdate(null)} />
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian text-white pb-[calc(5.5rem+var(--app-safe-bottom))]">
      <Navbar
        session={session}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onSwitchProfile={() => setSwitchingProfile(true)}
        onCheckUpdates={handleManualUpdateCheck}
        onSignOut={handleSignOut}
        downloadCount={offlineCount}
        activeDownloadCount={activeDownloadCount}
        tvSearchActive={tvSearchOpen}
        onToggleTvSearch={() => {
          setTvSearchOpen((prev) => {
            const next = !prev;
            if (!next) {
              setSearchQuery('');
              setSelectedSearchPerson(null);
              setSelectedSearchPersonItems([]);
            }
            return next;
          });
        }}
      />

      {activeTab === 'family' && session.isAdmin ? (
        <Suspense fallback={<LazyViewFallback />}>
          <FamilyAdminView session={session} />
        </Suspense>
      ) : activeTab === 'downloads' ? (
        <Suspense fallback={<LazyViewFallback />}>
          <DownloadsView onPlayOffline={setPlayingItem} />
        </Suspense>
      ) : loading ? (
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white border-t-transparent" />
            <p className="mt-4 text-base font-medium text-zinc-300">{t.loadingCinema}</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <p className="text-red-300 text-base max-w-md">{error}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              data-tv-pill={isTv ? 'true' : undefined}
              onClick={() => loadLibrary(session)}
              className="rounded-full bg-white px-6 py-3 text-sm font-extrabold text-obsidian hover:bg-zinc-200"
            >
              {t.retry}
            </button>
            {offlineCount > 0 && (
              <button
                onClick={() => setActiveTab('downloads')}
                className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-5 py-3 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25"
              >
                {t.openOfflineDownloads} ({offlineCount})
              </button>
            )}
          </div>
        </div>
      ) : (
        <main>
          {showHero && heroItem && (
            <HeroBanner
              item={heroItem}
              onPlay={(item) =>
                item.type === 'Series' ? setSelectedItem(item) : setPlayingItem(item)
              }
              onMoreInfo={setSelectedItem}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          <div
            className={
              isTv
                ? `w-full ${
                    showHero
                      ? '-mt-10 relative z-10'
                      : 'pt-[calc(6.2rem+var(--app-safe-top))]'
                  }`
                : `mx-auto max-w-[1600px] ${
                    showHero
                      ? '-mt-10 relative z-10'
                      : 'pt-[calc(7.5rem+var(--app-safe-top))]'
                  }`
            }
          >
            {activeTab === 'home' && !isFilteredGridMode && !selectedLibraryId && resumeItems.length > 0 && (
              <MediaRow
                title={t.continueWatching}
                items={resumeItems}
                showProgress
                onSelect={setSelectedItem}
                onPlay={(item) => {
                  setPlayStartOptions(undefined);
                  setPlayingItem(item);
                }}
                onToggleFavorite={handleToggleFavorite}
                onTogglePlayed={handleTogglePlayed}
                onRemoveContinueWatching={handleRemoveContinueWatching}
              />
            )}

            {activeTab === 'home' && !isFilteredGridMode && !selectedLibraryId && nextUpItems.length > 0 && (
              <MediaRow
                title={t.upNext}
                items={nextUpItems}
                onSelect={setSelectedItem}
                onPlay={(item) => {
                  setPlayStartOptions(undefined);
                  setPlayingItem(item);
                }}
                onToggleFavorite={handleToggleFavorite}
                onTogglePlayed={handleTogglePlayed}
              />
            )}

            {/* Real Jellyfin Library View Pills (e.g. All Libraries · Movies · Shows · Private) */}
            {activeTab === 'home' && libraryViews.length > 1 && !searchQuery.trim() && !tvSearchOpen && (
              <div
                data-tv-row="library-views"
                className={
                  isTv
                    ? 'no-scrollbar mb-6 flex items-center gap-3 overflow-x-auto px-[3.8vw] py-2'
                    : 'no-scrollbar mb-3 flex items-center gap-2 overflow-x-auto px-4 sm:px-8'
                }
              >
                <button
                  data-tv-pill={isTv ? 'true' : undefined}
                  onClick={() => {
                    setSelectedLibraryId(null);
                    setSelectedGenre(null);
                  }}
                  className={
                    isTv
                      ? `flex flex-shrink-0 items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-bold transition ${
                          selectedLibraryId === null
                            ? 'border-white/30 bg-white/20 text-white'
                            : 'border-white/15 bg-[#121626]/95 text-zinc-300'
                        }`
                      : `flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
                          selectedLibraryId === null
                            ? 'border-violet-400 bg-violet-600 text-white shadow-lg shadow-violet-900/30'
                            : 'border-white/15 bg-white/5 text-zinc-300 hover:bg-white/15 hover:text-white'
                        }`
                  }
                >
                  <Folder className={isTv ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
                  {t.allLibraries}
                </button>
                {libraryViews.map((view) => {
                  const active = selectedLibraryId === view.id;
                  return (
                    <button
                      key={view.id}
                      data-tv-pill={isTv ? 'true' : undefined}
                      onClick={() => {
                        setSelectedLibraryId(active ? null : view.id);
                        setSelectedGenre(null);
                      }}
                      className={
                        isTv
                          ? `flex flex-shrink-0 items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-bold transition ${
                              active
                                ? 'border-white/30 bg-white/20 text-white'
                                : 'border-white/15 bg-[#121626]/95 text-zinc-300'
                            }`
                          : `flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
                              active
                                ? 'border-violet-400 bg-violet-600 text-white shadow-lg shadow-violet-900/30'
                                : 'border-white/15 bg-white/5 text-zinc-300 hover:bg-white/15 hover:text-white'
                            }`
                      }
                    >
                      {translateLibraryName(view.name, lang)}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Desktop & Mobile: Prominent Search + Genre Filter Pills + Sort Bar */}
            {!isTv && (
              <BrowseFilterBar
                searchQuery={searchQuery}
                onSearchChange={handleSearchChange}
                genres={availableGenres}
                selectedGenre={selectedGenre}
                onSelectGenre={setSelectedGenre}
                sortBy={sortBy}
                onSortChange={setSortBy}
                totalMatching={filteredItems.length}
              />
            )}

            {/* Smart TV Dedicated Search & Browse Filter Header (hidden on TV Home so Home stays pure cinema!) */}
            {isTv && showGridSection && (
              <section className="mb-6 px-[3.8vw]">
                {tvSearchOpen && (
                  <div className="mb-5 flex items-center gap-4 rounded-2xl border border-white/20 bg-[#121626] px-5 py-3.5 shadow-2xl">
                    <Search className="h-6 w-6 flex-shrink-0 text-zinc-300" />
                    <input
                      autoFocus
                      data-tv-default-focus="true"
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      placeholder={t.searchPlaceholderTv}
                      className="flex-1 bg-transparent text-lg font-semibold text-white placeholder-zinc-500 outline-none"
                    />
                    {searchQuery && (
                      <button
                        data-tv-pill="true"
                        type="button"
                        onClick={() => handleSearchChange('')}
                        className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm font-bold text-zinc-200"
                      >
                        <X className="h-4 w-4" />
                        {t.clear}
                      </button>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h1 className="text-3xl font-black tracking-tight text-white">
                    {selectedSearchPerson
                      ? lang === 'ro'
                        ? `Titluri cu ${selectedSearchPerson.name}`
                        : `Titles with ${selectedSearchPerson.name}`
                      : tvSearchOpen && !searchQuery.trim()
                      ? t.searchCatalog
                      : searchQuery.trim()
                      ? lang === 'ro'
                        ? `Rezultate pentru „${searchQuery.trim()}”`
                        : `Results for "${searchQuery.trim()}"`
                      : selectedLibraryId
                      ? translateLibraryName(
                          libraryViews.find((v) => v.id === selectedLibraryId)?.name || t.catalog,
                          lang
                        )
                      : activeTab === 'movies'
                      ? t.navMovies
                      : activeTab === 'series'
                      ? t.tvSeries
                      : activeTab === 'mylist'
                      ? t.navMyList
                      : t.catalog}{' '}
                    <span className="ml-1 text-lg font-semibold text-zinc-400">
                      ({filteredItems.length})
                    </span>
                  </h1>

                  {/* Focusable TV Sort Pills (replaces ugly native <select> popup on TV!) */}
                  <div data-tv-row="tv-sort" className="flex items-center gap-2">
                    {(
                      [
                        { id: 'recent', label: t.sortRecentShort },
                        { id: 'rating', label: t.sortTopRated },
                        { id: 'year', label: t.sortNewestShort },
                        { id: 'az', label: t.sortAzShort },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        data-tv-pill="true"
                        type="button"
                        onClick={() => setSortBy(opt.id)}
                        className={`rounded-full border px-4 py-2 text-xs font-bold transition ${
                          sortBy === opt.id
                            ? 'border-white/35 bg-white/20 text-white'
                            : 'border-white/12 bg-[#121626] text-zinc-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Focusable TV Genre Pills */}
                {availableGenres.length > 0 && activeTab !== 'mylist' && (
                  <div
                    data-tv-row="tv-genres"
                    className="no-scrollbar mt-4 flex items-center gap-2.5 overflow-x-auto py-2"
                  >
                    <button
                      data-tv-pill="true"
                      type="button"
                      onClick={() => setSelectedGenre(null)}
                      className={`flex-shrink-0 rounded-full border px-5 py-2 text-xs font-bold transition ${
                        selectedGenre === null
                          ? 'border-white/35 bg-white/20 text-white'
                          : 'border-white/12 bg-[#121626] text-zinc-300'
                      }`}
                    >
                      {t.allGenres}
                    </button>
                    {availableGenres.map((g) => {
                      const active = selectedGenre === g.name;
                      return (
                        <button
                          key={g.name}
                          data-tv-pill="true"
                          type="button"
                          onClick={() => setSelectedGenre(active ? null : g.name)}
                          className={`flex flex-shrink-0 items-center gap-2 rounded-full border px-5 py-2 text-xs font-bold transition ${
                            active
                              ? 'border-white/35 bg-white/20 text-white'
                              : 'border-white/12 bg-[#121626] text-zinc-300'
                          }`}
                        >
                          <span>{translateGenre(g.name, lang)}</span>
                          <span className="opacity-65">{g.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Matching Actors / Directors from live Jellyfin Search */}
            {searchQuery.trim().length >= 2 && remoteSearchPeople.length > 0 && (
              <div className={isTv ? 'mb-6 px-[3.8vw]' : 'mb-5 px-4 sm:px-8'}>
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
                  {t.castAndCrew}
                </div>
                <div
                  data-tv-row="search-people"
                  className="no-scrollbar flex items-center gap-3 overflow-x-auto py-1.5"
                >
                  {remoteSearchPeople.map((person) => {
                    const active = selectedSearchPerson?.id === person.id;
                    return (
                      <button
                        key={person.id}
                        data-tv-pill={isTv ? 'true' : undefined}
                        onClick={() => handleSelectSearchPerson(person)}
                        className={`flex flex-shrink-0 items-center gap-2.5 rounded-full border py-1.5 pl-2 pr-4 text-xs font-bold transition ${
                          active
                            ? isTv
                              ? 'border-white/35 bg-white/20 text-white'
                              : 'border-violet-400 bg-violet-600 text-white shadow-lg'
                            : 'border-white/15 bg-[#121626] text-zinc-200 hover:bg-white/15'
                        }`}
                      >
                        <div className="h-8 w-8 overflow-hidden rounded-full bg-surface-elevated flex-shrink-0 flex items-center justify-center text-xs font-black text-zinc-300">
                          {person.avatarUrl ? (
                            <img
                              src={person.avatarUrl}
                              alt={person.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            person.name.charAt(0).toUpperCase()
                          )}
                        </div>
                        <span>{person.name}</span>
                        {active && <X className="h-4 w-4" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {filteredItems.length === 0 ? (
              <div className="px-8 py-20 text-center text-zinc-400">
                {searchQuery.trim() || selectedGenre || selectedSearchPerson ? (
                  <div>
                    <p className={isTv ? 'text-lg text-zinc-300' : 'text-sm text-zinc-300'}>
                      {t.noTitlesFound}
                      {selectedSearchPerson ? ` · ${selectedSearchPerson.name}` : ''}
                      {selectedGenre ? ` · ${translateGenre(selectedGenre, lang)}` : ''}
                      {searchQuery.trim() && !selectedSearchPerson
                        ? ` · "${searchQuery.trim()}"`
                        : ''}
                    </p>
                    <button
                      data-tv-pill={isTv ? 'true' : undefined}
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedGenre(null);
                        setSelectedSearchPerson(null);
                        setSelectedSearchPersonItems([]);
                      }}
                      className={
                        isTv
                          ? 'mt-5 rounded-full bg-white px-6 py-3 text-sm font-extrabold text-obsidian'
                          : 'mt-4 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500'
                      }
                    >
                      {t.clearFilters}
                    </button>
                  </div>
                ) : activeTab === 'mylist' ? (
                  <p className={isTv ? 'text-lg text-zinc-300' : 'text-sm text-zinc-400'}>
                    {t.emptyMyList}
                  </p>
                ) : (
                  t.emptyLibrary
                )}
              </div>
            ) : showGridSection ? (
              <section className={isTv ? 'px-[3.8vw]' : 'px-4 sm:px-8'}>
                {!isTv && (
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg sm:text-xl font-bold text-white">
                      {selectedSearchPerson
                        ? lang === 'ro'
                          ? `Titluri cu ${selectedSearchPerson.name}`
                          : `Titles with ${selectedSearchPerson.name}`
                        : searchQuery.trim()
                        ? `${
                            lang === 'ro'
                              ? `Rezultate pentru „${searchQuery.trim()}”`
                              : `Results for "${searchQuery.trim()}"`
                          }${selectedGenre ? ` · ${translateGenre(selectedGenre, lang)}` : ''}`
                        : selectedLibraryId
                        ? `${translateLibraryName(
                            libraryViews.find((v) => v.id === selectedLibraryId)?.name || t.catalog,
                            lang
                          )}${selectedGenre ? ` · ${translateGenre(selectedGenre, lang)}` : ''}`
                        : selectedGenre
                        ? `${translateGenre(selectedGenre, lang)}${
                            activeTab === 'movies'
                              ? ` · ${t.navMovies}`
                              : activeTab === 'series'
                              ? ` · ${t.tvSeries}`
                              : ''
                          }`
                        : activeTab === 'movies'
                        ? t.allMovies
                        : activeTab === 'series'
                        ? t.allSeries
                        : activeTab === 'mylist'
                        ? t.navMyList
                        : t.allTitles}{' '}
                      <span className="text-sm font-medium text-zinc-400">
                        ({filteredItems.length})
                      </span>
                    </h2>
                  </div>
                )}

                <div
                  className={
                    isTv
                      ? 'grid grid-cols-6 gap-x-6 gap-y-8 py-2'
                      : 'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                  }
                >
                  {filteredItems.map((item) => (
                    <div
                      key={item.id}
                      data-tv-card="true"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedItem(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedItem(item);
                        }
                      }}
                      className={
                        isTv
                          ? 'group cursor-pointer focus:outline-none'
                          : 'group cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-lg transition hover:scale-[1.03] hover:border-violet-400/50 focus:outline-none focus:scale-[1.04] focus:border-violet-400 focus:ring-4 focus:ring-violet-400'
                      }
                    >
                      <div
                        className={`tv-card-frame relative aspect-[2/3] overflow-hidden bg-[#111524] ${
                          isTv ? 'rounded-2xl border border-white/15' : 'bg-surface-elevated'
                        }`}
                      >
                        {item.posterUrl ? (
                          <img
                            src={item.posterUrl}
                            alt={getLocalizedTitleInfo(item, lang).title}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center p-4 text-center">
                            <span className="text-sm font-bold text-zinc-300 line-clamp-3">
                              {getLocalizedTitleInfo(item, lang).title}
                            </span>
                          </div>
                        )}
                        {item.isPlayed && (
                          <div
                            className={`pointer-events-none absolute top-2.5 left-2.5 flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ${
                              isTv ? 'h-7 w-7' : 'h-5 w-5'
                            }`}
                          >
                            <Check className={isTv ? 'h-4 w-4 stroke-[3]' : 'h-3 w-3'} />
                          </div>
                        )}
                        {!item.isPlayed && !isTv && (
                          <div className="absolute top-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-200 backdrop-blur-sm">
                            {item.type === 'Series'
                              ? t.seriesBadge
                              : item.type === 'BoxSet'
                              ? t.collectionBadge
                              : t.movieBadge}
                          </div>
                        )}
                        {item.rating && (
                          <div
                            className={
                              isTv
                                ? 'absolute top-2.5 right-2.5 flex items-center gap-1 rounded-lg border border-white/10 bg-black/85 px-2 py-0.5 text-xs font-extrabold text-amber-300'
                                : 'absolute top-2 right-2 flex items-center gap-0.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur-sm'
                            }
                          >
                            <Star className={isTv ? 'h-3.5 w-3.5 fill-amber-300' : 'h-2.5 w-2.5 fill-amber-300'} />
                            {item.rating}
                          </div>
                        )}
                      </div>
                      <div className={isTv ? 'pt-2.5 px-0.5' : 'p-2.5'}>
                        <p
                          className={
                            isTv
                              ? 'tv-card-title truncate text-[0.92rem] font-bold text-zinc-200'
                              : 'truncate text-sm font-semibold text-white'
                          }
                        >
                          {getLocalizedTitleInfo(item, lang).title}
                        </p>
                        <p
                          className={
                            isTv
                              ? 'mt-0.5 truncate text-[0.78rem] font-medium text-zinc-400'
                              : 'truncate text-xs text-zinc-400'
                          }
                        >
                          {item.year ? `${item.year}` : ''}
                          {item.genres[0]
                            ? `${item.year ? ' · ' : ''}${translateGenre(item.genres[0], lang)}`
                            : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <>
                <MediaRow
                  title={t.recentlyAdded}
                  items={recentlyAddedItems}
                  onSelect={setSelectedItem}
                  onPlay={(item) =>
                    item.type === 'Series' || item.type === 'BoxSet'
                      ? setSelectedItem(item)
                      : (setPlayStartOptions(undefined), setPlayingItem(item))
                  }
                  onToggleFavorite={handleToggleFavorite}
                  onTogglePlayed={handleTogglePlayed}
                />

                {collections.length > 0 && (
                  <MediaRow
                    title={t.collections}
                    items={collections}
                    onSelect={setSelectedItem}
                    onPlay={setSelectedItem}
                  />
                )}

                {genreRows.map(([genre, list]) => (
                  <MediaRow
                    key={genre}
                    title={translateGenre(genre, lang)}
                    items={list}
                    onSelect={setSelectedItem}
                    onPlay={(item) =>
                      item.type === 'Series' || item.type === 'BoxSet'
                        ? setSelectedItem(item)
                        : (setPlayStartOptions(undefined), setPlayingItem(item))
                    }
                    onToggleFavorite={handleToggleFavorite}
                    onTogglePlayed={handleTogglePlayed}
                  />
                ))}
              </>
            )}
          </div>
        </main>
      )}

      {/* Detail Modal */}
      {selectedItem && (
        <DetailModal
          session={session}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onSelectItem={(next) => setSelectedItem(next)}
          onPlay={(item, options) => {
            setSelectedItem(null);
            setPlayStartOptions(options);
            setPlayingItem(item);
          }}
          onToggleFavorite={handleToggleFavorite}
          onTogglePlayed={handleTogglePlayed}
        />
      )}

      {/* Fullscreen Video Player (lazy-loaded so hls.js is only parsed when watching) */}
      {playingItem && (
        <Suspense fallback={<LazyViewFallback fullscreen />}>
          <VideoPlayer
            session={session}
            item={playingItem}
            startOptions={playStartOptions}
            onPlayNext={(nextEp) => {
              setPlayStartOptions(undefined);
              setPlayingItem(nextEp);
            }}
            onToggleFavorite={handleToggleFavorite}
            onClose={() => {
              setPlayStartOptions(undefined);
              closePlayer();
            }}
          />
        </Suspense>
      )}

      {/* In-App Android APK Update Prompt */}
      {availableUpdate && !playingItem && (
        <UpdateModal update={availableUpdate} onClose={() => setAvailableUpdate(null)} />
      )}

      {/* Samsung Android / TV double-back exit confirmation toast */}
      {showExitToast && (
        <div
          className={
            isTv
              ? 'pointer-events-none fixed bottom-10 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-white/25 bg-[#101320] px-6 py-3 text-sm font-bold text-white shadow-2xl'
              : 'pointer-events-none fixed bottom-[calc(2rem+var(--app-safe-bottom))] left-1/2 z-[60] -translate-x-1/2 rounded-full border border-white/15 bg-black/85 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md'
          }
        >
          {t.pressBackAgainToExit}
        </div>
      )}

      {/* Update check status toast */}
      {statusToast && !showExitToast && (
        <div
          className={
            isTv
              ? 'pointer-events-none fixed bottom-10 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 truncate rounded-full border border-white/25 bg-[#101320] px-6 py-3 text-sm font-bold text-zinc-100 shadow-2xl'
              : 'pointer-events-none fixed bottom-[calc(2rem+var(--app-safe-bottom))] left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 truncate rounded-full border border-violet-400/35 bg-black/85 px-4 py-2 text-xs font-semibold text-zinc-100 shadow-2xl backdrop-blur-md'
          }
        >
          {statusToast}
        </div>
      )}
    </div>
  );
};

export default App;
