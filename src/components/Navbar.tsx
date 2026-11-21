import React, { useEffect, useState } from 'react';
import { LogOut, Search, X } from 'lucide-react';
import type { AuthSession } from '../types/media';
import { BrandLogo } from './BrandLogo';

export type NavTab = 'home' | 'movies' | 'series' | 'mylist' | 'downloads';

interface NavbarProps {
  session: AuthSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSignOut: () => void;
  downloadCount?: number;
  activeDownloadCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  session,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  onSignOut,
  downloadCount = 0,
  activeDownloadCount = 0,
}) => {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navItems: { id: NavTab; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'movies', label: 'Movies' },
    { id: 'series', label: 'Series' },
    { id: 'mylist', label: 'My List' },
    { id: 'downloads', label: 'Downloads' },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 pt-[var(--app-safe-top)] transition-all duration-300 ${
        scrolled
          ? 'bg-obsidian/90 backdrop-blur-xl border-b border-white/10 shadow-lg'
          : 'bg-gradient-to-b from-obsidian/95 via-obsidian/50 to-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3.5 sm:px-8">
        {/* Left: Brand + Nav */}
        <div className="flex items-center gap-4 md:gap-8 min-w-0">
          <button
            onClick={() => {
              onTabChange('home');
              onSearchChange('');
            }}
            className="flex-shrink-0 transition hover:opacity-90"
          >
            <BrandLogo size="sm" hideTextOnMobile={searchOpen} />
          </button>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                  activeTab === item.id
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span>{item.label}</span>
                {item.id === 'downloads' && (activeDownloadCount > 0 || downloadCount > 0) && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      activeDownloadCount > 0
                        ? 'bg-violet-500 text-white animate-pulse'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {activeDownloadCount > 0 ? activeDownloadCount : downloadCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: Search + User */}
        <div className="flex items-center gap-3">
          {searchOpen ? (
            <div className="flex items-center rounded-xl border border-white/15 bg-surface/90 px-3 py-1.5 backdrop-blur-md">
              <Search className="h-4 w-4 text-zinc-400" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search titles, genres..."
                className="w-36 sm:w-56 bg-transparent px-2.5 text-sm text-white placeholder-zinc-500 outline-none"
              />
              <button
                onClick={() => {
                  onSearchChange('');
                  setSearchOpen(false);
                }}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              className="rounded-xl p-2 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <Search className="h-5 w-5" />
            </button>
          )}

          {session.isDemo && (
            <span className="hidden sm:inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold text-violet-300">
              DEMO MODE
            </span>
          )}

          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs font-bold">
              {session.username.charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:inline text-xs font-medium text-zinc-200 max-w-[100px] truncate">
              {session.username}
            </span>
          </div>

          <button
            onClick={onSignOut}
            title="Sign Out"
            className="rounded-xl p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile tab bar */}
      <div className="flex md:hidden items-center justify-around border-t border-white/5 bg-obsidian/90 px-1.5 py-1.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${
              activeTab === item.id ? 'text-violet-400' : 'text-zinc-400'
            }`}
          >
            <span>{item.label}</span>
            {item.id === 'downloads' && (activeDownloadCount > 0 || downloadCount > 0) && (
              <span
                className={`rounded-full px-1 py-0.5 text-[9px] font-bold leading-none ${
                  activeDownloadCount > 0
                    ? 'bg-violet-500 text-white animate-pulse'
                    : 'bg-emerald-500/20 text-emerald-300'
                }`}
              >
                {activeDownloadCount > 0 ? activeDownloadCount : downloadCount}
              </span>
            )}
          </button>
        ))}
      </div>
    </header>
  );
};
