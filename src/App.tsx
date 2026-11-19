import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
          onClose={() => {
            setPlayingItem(null);
            if (session && !session.isDemo) {
              fetchResumeItems(session).then(setResumeItems);
            }
          }}
        />
      )}
    </div>
  );
};

export default App;
