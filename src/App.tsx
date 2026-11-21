import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  clearSession,
  fetchLibraryItems,
  fetchResumeItems,
  loadCachedLibrary,
  loadSavedSession,
  refreshSessionProfile,
  removeSavedProfile,
  saveCachedLibrary,
  toggleFavorite,
} from './services/jellyfin';
import {
  listActiveDownloads,
  listOfflineRecords,
  subscribeOfflineDownloads,
} from './services/offlineDownloads';
import type { AuthSession, MediaItem } from './types/media';
import { initTvNavigation } from './utils/tvNavigation';

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
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [switchingProfile, setSwitchingProfile] = useState(false);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
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
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
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
    flashStatusToast('Checking for updates...');
    const info = await checkForAppUpdate({ force: true });
    if (info) {
      setStatusToast(null);
      setAvailableUpdate(info);
    } else {
      flashStatusToast(`You're on the latest version (v${APP_VERSION_NAME})`);
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
    setSessionNotice('Your session expired or your password was updated. Please sign in again.');
  }, []);

  const closePlayer = useCallback(() => {
    setPlayingItem(null);
    const activeSession = sessionRef.current;
    if (activeSession && !activeSession.isDemo && navigator.onLine !== false) {
      fetchResumeItems(activeSession)
        .then((nextResume) => {
          setResumeItems(nextResume);
          if (itemsRef.current.length > 0) {
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
      const cached = !activeSession.isDemo ? loadCachedLibrary(activeSession.userId) : null;
      const hasVisibleCatalog = Boolean(options?.background || (cached && cached.items.length > 0));

      if (!hasVisibleCatalog) {
        setLoading(true);
      }
      setError(null);
      try {
        const [library, resume] = await Promise.all([
          fetchLibraryItems(activeSession),
          fetchResumeItems(activeSession),
        ]);
        lastSyncTsRef.current = Date.now();
        setItems(library);
        setResumeItems(resume);
        if (!activeSession.isDemo) {
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
          flashStatusToast('Offline · showing cached catalog');
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

    const onPopState = () => {
      if (availableUpdateRef.current) {
        setAvailableUpdate(null);
        armBackGuard();
        return;
      }
      if (switchingProfileRef.current) {
        setSwitchingProfile(false);
        armBackGuard();
        return;
      }
      if (playingItemRef.current) {
        closePlayer();
        armBackGuard();
        return;
      }
      if (selectedItemRef.current) {
        setSelectedItem(null);
        armBackGuard();
        return;
      }
      if (searchQueryRef.current.trim()) {
        setSearchQuery('');
        armBackGuard();
        return;
      }
      if (activeTabRef.current !== 'home') {
        setActiveTab('home');
        armBackGuard();
        return;
      }

      const now = Date.now();
      if (now < exitConfirmUntilRef.current) {
        // Confirmed second Back press within 2.2s: allow exiting cleanly
        setShowExitToast(false);
        return;
      }

      exitConfirmUntilRef.current = now + 2200;
      armBackGuard();
      setShowExitToast(true);
      if (exitToastTimerRef.current) window.clearTimeout(exitToastTimerRef.current);
      exitToastTimerRef.current = window.setTimeout(() => {
        setShowExitToast(false);
      }, 2200);
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('keydown', onUserGesture);
      window.removeEventListener('popstate', onPopState);
      if (exitToastTimerRef.current) window.clearTimeout(exitToastTimerRef.current);
      if (statusToastTimerRef.current) window.clearTimeout(statusToastTimerRef.current);
    };
  }, [closePlayer]);

  // Hydrate cached catalog immediately & refresh from Jellyfin whenever the active user changes
  const activeSessionKey = session ? `${session.serverUrl}:${session.userId}:${session.accessToken}` : null;
  useEffect(() => {
    if (!session) return;
    if (!session.isDemo) {
      const cached = loadCachedLibrary(session.userId);
      if (cached) {
        setItems(cached.items);
        setResumeItems(cached.resumeItems);
      } else {
        setItems([]);
        setResumeItems([]);
      }
    }
    loadLibrary(session);
    if (!session.isDemo && session.isAdmin === undefined) {
      refreshSessionProfile(session).then((refreshed) => {
        if (refreshed.isAdmin !== session.isAdmin) {
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
      setSelectedItem((prev) =>
        prev && prev.id === item.id ? { ...prev, isFavorite: next } : prev
      );
    } catch {
      // Ignore transient error
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (activeTab === 'movies' && item.type !== 'Movie') return false;
      if (activeTab === 'series' && item.type !== 'Series') return false;
      if (activeTab === 'mylist' && !item.isFavorite) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.overview.toLowerCase().includes(q) ||
        item.genres.some((g) => g.toLowerCase().includes(q))
      );
    });
  }, [items, activeTab, searchQuery]);

  const genreRows = useMemo(() => {
    const map = new Map<string, MediaItem[]>();
    for (const item of filteredItems) {
      for (const genre of item.genres) {
        if (genre === 'Featured') continue;
        const list = map.get(genre) || [];
        list.push(item);
        map.set(genre, list);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8);
  }, [filteredItems]);

  const heroItem = useMemo(() => {
    if (filteredItems.length === 0) return null;
    return filteredItems[0];
  }, [filteredItems]);

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
        onTabChange={setActiveTab}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSwitchProfile={() => setSwitchingProfile(true)}
        onCheckUpdates={handleManualUpdateCheck}
        onSignOut={handleSignOut}
        downloadCount={offlineCount}
        activeDownloadCount={activeDownloadCount}
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
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
            <p className="mt-4 text-sm text-zinc-400">Loading your cinema...</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <p className="text-red-300 text-sm max-w-md">{error}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => loadLibrary(session)}
              className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Retry
            </button>
            {offlineCount > 0 && (
              <button
                onClick={() => setActiveTab('downloads')}
                className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-5 py-2.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25"
              >
                Open Offline Downloads ({offlineCount})
              </button>
            )}
          </div>
        </div>
      ) : searchQuery.trim() ? (
        <main className="mx-auto max-w-[1600px] px-4 pt-[calc(7.5rem+var(--app-safe-top))] sm:px-8">
          <h2 className="mb-6 text-xl font-bold">
            Search results for &ldquo;{searchQuery}&rdquo; ({filteredItems.length})
          </h2>
          {filteredItems.length === 0 ? (
            <p className="text-sm text-zinc-400">No matching titles found.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-surface transition hover:scale-[1.03] hover:border-violet-400/50"
                >
                  <div className="aspect-[2/3] bg-surface-elevated">
                    <img
                      src={item.posterUrl}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    <p className="text-xs text-zinc-400">{item.year}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      ) : (
        <main>
          {heroItem && activeTab === 'home' && (
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
            className={`mx-auto max-w-[1600px] ${
              heroItem && activeTab === 'home'
                ? '-mt-10 relative z-10'
                : 'pt-[calc(7.5rem+var(--app-safe-top))]'
            }`}
          >
            {activeTab === 'home' && resumeItems.length > 0 && (
              <MediaRow
                title="Continue Watching"
                items={resumeItems}
                showProgress
                onSelect={setSelectedItem}
                onPlay={setPlayingItem}
              />
            )}

            {filteredItems.length === 0 ? (
              <div className="px-8 py-16 text-center text-zinc-400">
                {activeTab === 'mylist'
                  ? 'Your list is empty. Click the + button on any movie or series to save it here.'
                  : 'No titles in this library yet.'}
              </div>
            ) : (
              <>
                <MediaRow
                  title={
                    activeTab === 'movies'
                      ? 'All Movies'
                      : activeTab === 'series'
                      ? 'All TV Series'
                      : activeTab === 'mylist'
                      ? 'My List'
                      : 'Recently Added'
                  }
                  items={filteredItems}
                  onSelect={setSelectedItem}
                  onPlay={(item) =>
                    item.type === 'Series'
                      ? setSelectedItem(item)
                      : setPlayingItem(item)
                  }
                />

                {activeTab === 'home' &&
                  genreRows.map(([genre, list]) => (
                    <MediaRow
                      key={genre}
                      title={genre}
                      items={list}
                      onSelect={setSelectedItem}
                      onPlay={(item) =>
                        item.type === 'Series'
                          ? setSelectedItem(item)
                          : setPlayingItem(item)
                      }
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
          onPlay={(item) => {
            setSelectedItem(null);
            setPlayingItem(item);
          }}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {/* Fullscreen Video Player (lazy-loaded so hls.js is only parsed when watching) */}
      {playingItem && (
        <Suspense fallback={<LazyViewFallback fullscreen />}>
          <VideoPlayer
            session={session}
            item={playingItem}
            onPlayNext={(nextEp) => setPlayingItem(nextEp)}
            onClose={closePlayer}
          />
        </Suspense>
      )}

      {/* In-App Android APK Update Prompt */}
      {availableUpdate && !playingItem && (
        <UpdateModal update={availableUpdate} onClose={() => setAvailableUpdate(null)} />
      )}

      {/* Samsung Android double-back exit confirmation toast */}
      {showExitToast && (
        <div className="pointer-events-none fixed bottom-[calc(2rem+var(--app-safe-bottom))] left-1/2 z-[60] -translate-x-1/2 rounded-full border border-white/15 bg-black/85 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md">
          Press Back again to exit
        </div>
      )}

      {/* Update check status toast */}
      {statusToast && !showExitToast && (
        <div className="pointer-events-none fixed bottom-[calc(2rem+var(--app-safe-bottom))] left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 truncate rounded-full border border-violet-400/35 bg-black/85 px-4 py-2 text-xs font-semibold text-zinc-100 shadow-2xl backdrop-blur-md">
          {statusToast}
        </div>
      )}
    </div>
  );
};

export default App;
