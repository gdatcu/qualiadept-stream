import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetailModal } from './components/DetailModal';
import { HeroBanner } from './components/HeroBanner';
import { LoginScreen } from './components/LoginScreen';
import { MediaRow } from './components/MediaRow';
import { Navbar, type NavTab } from './components/Navbar';
import { VideoPlayer } from './components/VideoPlayer';
import {
  clearSession,
  fetchLibraryItems,
  fetchResumeItems,
  loadSavedSession,
  toggleFavorite,
} from './services/jellyfin';
import type { AuthSession, MediaItem } from './types/media';
import { initTvNavigation } from './utils/tvNavigation';

export const App: React.FC = () => {
  const [session, setSession] = useState<AuthSession | null>(() => loadSavedSession());
  const [items, setItems] = useState<MediaItem[]>([]);
  const [resumeItems, setResumeItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
  const [showExitToast, setShowExitToast] = useState(false);

  const sessionRef = useRef(session);
  sessionRef.current = session;
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

  const closePlayer = useCallback(() => {
    setPlayingItem(null);
    const activeSession = sessionRef.current;
    if (activeSession && !activeSession.isDemo) {
      fetchResumeItems(activeSession).then(setResumeItems);
    }
  }, []);

  const loadLibrary = useCallback(async (activeSession: AuthSession) => {
    setLoading(true);
    setError(null);
    try {
      const [library, resume] = await Promise.all([
        fetchLibraryItems(activeSession),
        fetchResumeItems(activeSession),
      ]);
      setItems(library);
      setResumeItems(resume);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return initTvNavigation();
  }, []);

  // Samsung Android / Mobile Back button navigation guard (works in Chrome, PWA & Capacitor APK):
  // Navigates back through Player -> Detail -> Search -> Tabs -> Home, then asks for double-Back to exit.
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
    };
  }, [closePlayer]);

  useEffect(() => {
    if (session) {
      loadLibrary(session);
    }
  }, [session, loadLibrary]);

  const handleSignOut = () => {
    clearSession();
    setSession(null);
    setItems([]);
    setResumeItems([]);
    setSelectedItem(null);
    setPlayingItem(null);
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

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  return (
    <div className="min-h-screen bg-obsidian text-white pb-20">
      <Navbar
        session={session}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSignOut={handleSignOut}
      />

      {loading ? (
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
            <p className="mt-4 text-sm text-zinc-400">Loading your cinema...</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <p className="text-red-300 text-sm max-w-md">{error}</p>
          <button
            onClick={() => loadLibrary(session)}
            className="mt-4 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
          >
            Retry
          </button>
        </div>
      ) : searchQuery.trim() ? (
        <main className="mx-auto max-w-[1600px] px-4 pt-28 sm:px-8">
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
              heroItem && activeTab === 'home' ? '-mt-10 relative z-10' : 'pt-28'
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

      {/* Fullscreen Video Player */}
      {playingItem && (
        <VideoPlayer
          session={session}
          item={playingItem}
          onPlayNext={(nextEp) => setPlayingItem(nextEp)}
          onClose={closePlayer}
        />
      )}

      {/* Samsung Android double-back exit confirmation toast */}
      {showExitToast && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-white/15 bg-black/85 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md">
          Press Back again to exit
        </div>
      )}
    </div>
  );
};

export default App;
