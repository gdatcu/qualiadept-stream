import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  Crown,
  Download,
  Film,
  Globe,
  Home,
  LogOut,
  Search,
  Tv,
  Users,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { APP_VERSION_NAME, isCapacitorNativeApp } from '../services/appUpdate';
import type { AuthSession } from '../types/media';
import { isTizenTv } from '../utils/tvNavigation';
import { BrandLogo } from './BrandLogo';

export type NavTab = 'home' | 'movies' | 'series' | 'mylist' | 'downloads' | 'family';

interface NavbarProps {
  session: AuthSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSwitchProfile: () => void;
  onCheckUpdates: () => void;
  onSignOut: () => void;
  downloadCount?: number;
  activeDownloadCount?: number;
  tvSearchActive?: boolean;
  onToggleTvSearch?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  session,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  onSwitchProfile,
  onCheckUpdates,
  onSignOut,
  downloadCount = 0,
  activeDownloadCount = 0,
  tvSearchActive = false,
  onToggleTvSearch,
}) => {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const isNativeApp = isCapacitorNativeApp();
  const isTv = isTizenTv();
  const { lang, setLang, toggleLang, t } = useI18n();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navItems: { id: NavTab; label: string }[] = [
    { id: 'home', label: t.navHome },
    { id: 'movies', label: t.navMovies },
    { id: 'series', label: t.navSeries },
    { id: 'mylist', label: t.navMyList },
    ...(!isTv ? [{ id: 'downloads' as const, label: t.navDownloads }] : []),
    ...(session.isAdmin && !session.isDemo ? [{ id: 'family' as const, label: t.navFamily }] : []),
  ];

  const iconCls = isTv ? 'h-5 w-5' : 'h-4 w-4';

  const renderTabIcon = (id: NavTab) => {
    switch (id) {
      case 'home':
        return <Home className={iconCls} />;
      case 'movies':
        return <Film className={iconCls} />;
      case 'series':
        return <Tv className={iconCls} />;
      case 'mylist':
        return <Bookmark className={iconCls} />;
      case 'downloads':
        return <Download className={iconCls} />;
      case 'family':
        return <Crown className={`${iconCls} text-amber-400`} />;
    }
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 pt-[var(--app-safe-top)] ${
        isTv ? 'transition-colors duration-150' : 'transition-all duration-300'
      } ${
        scrolled
          ? isTv
            ? 'bg-[#070910]/98 border-b border-white/10 shadow-2xl'
            : 'bg-obsidian/90 backdrop-blur-xl border-b border-white/10 shadow-lg'
          : isTv
          ? 'bg-gradient-to-b from-obsidian via-obsidian/80 to-transparent'
          : 'bg-gradient-to-b from-obsidian/95 via-obsidian/55 to-transparent'
      }`}
    >
      <div
        data-tv-row="navbar"
        className={
          isTv
            ? 'flex w-full items-center justify-between px-[3.8vw] py-4'
            : 'mx-auto flex max-w-[1600px] items-center justify-between px-4 sm:px-8 py-3.5'
        }
      >
        {/* Left: Brand (+ inline Nav on non-TV) */}
        <div className="flex items-center gap-4 md:gap-8 min-w-0">
          <button
            onClick={() => {
              onTabChange('home');
              onSearchChange('');
            }}
            className="flex-shrink-0 rounded-2xl transition hover:opacity-90"
          >
            <BrandLogo size={isTv ? 'tv' : 'sm'} hideTextOnMobile={!isTv && searchOpen} />
          </button>

          {!isTv && (
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                    activeTab === item.id
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {item.id === 'family' && renderTabIcon(item.id)}
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
          )}
        </div>

        {/* Center (Smart TV only): Apple TV+ / Netflix 10-foot Capsule Navigation Dock */}
        {isTv && (
          <nav className="flex items-center gap-1.5 rounded-full border border-white/15 bg-[#121626]/95 p-1.5 shadow-2xl">
            {navItems.map((item) => {
              const isActive = !tvSearchActive && activeTab === item.id;
              return (
                <button
                  key={item.id}
                  data-tv-pill="true"
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2.5 rounded-full px-5 py-2.5 text-[0.92rem] font-bold transition ${
                    isActive
                      ? 'bg-white/20 text-white shadow-md'
                      : 'text-zinc-300 hover:text-white'
                  }`}
                >
                  {renderTabIcon(item.id)}
                  <span>{item.label}</span>
                </button>
              );
            })}

            <button
              data-tv-pill="true"
              onClick={() => {
                if (onToggleTvSearch) onToggleTvSearch();
              }}
              className={`flex items-center gap-2.5 rounded-full px-5 py-2.5 text-[0.92rem] font-bold transition ${
                tvSearchActive
                  ? 'bg-white/20 text-white shadow-md'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <Search className="h-5 w-5" />
              <span>{t.navSearch}</span>
            </button>
          </nav>
        )}

        {/* Right: Search (non-TV) + 1-Click Language Toggle + Profile Switcher Menu */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {!isTv && (
            <>
              {searchOpen ? (
                <div className="flex items-center rounded-full border border-white/15 bg-surface/90 px-3.5 py-1.5 backdrop-blur-md">
                  <Search className="h-4 w-4 text-zinc-400" />
                  <input
                    autoFocus
                    type="text"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={t.searchPlaceholderShort}
                    className="w-32 sm:w-56 bg-transparent px-2.5 text-sm text-white placeholder-zinc-500 outline-none"
                  />
                  <button
                    onClick={() => {
                      onSearchChange('');
                      setSearchOpen(false);
                    }}
                    className="rounded-full p-1 text-zinc-400 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSearchOpen(true)}
                  aria-label={t.navSearch}
                  className="flex items-center gap-1.5 rounded-xl p-2 text-zinc-200 transition hover:bg-white/15 hover:text-white"
                >
                  <Search className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
              )}
            </>
          )}

          {/* 1-Click Language Switcher Pill (EN / RO) */}
          {(!searchOpen || isTv) && (
            <button
              data-tv-pill={isTv ? 'true' : undefined}
              onClick={toggleLang}
              title={`${t.langLabel}: ${lang === 'ro' ? 'Română → English' : 'English → Română'}`}
              className={
                isTv
                  ? 'flex items-center gap-2 rounded-full border border-white/15 bg-[#121626]/95 px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-zinc-100 shadow-xl transition'
                  : 'flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.07] px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-200 transition hover:border-violet-400/50 hover:bg-white/15 hover:text-white'
              }
            >
              <Globe className={isTv ? 'h-4 w-4 text-violet-300' : 'h-3.5 w-3.5 text-violet-300'} />
              <span>{lang.toUpperCase()}</span>
            </button>
          )}

          {session.isDemo && (
            <span className="hidden sm:inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-300">
              {t.demoMode}
            </span>
          )}

          {/* Clickable Profile Pill + Dropdown */}
          <div className="relative">
            <button
              data-tv-pill={isTv ? 'true' : undefined}
              onClick={() => setProfileMenuOpen((v) => !v)}
              className={`flex items-center transition ${
                isTv
                  ? 'gap-2.5 rounded-full border border-white/15 bg-[#121626]/95 py-1.5 pl-2 pr-4 text-white shadow-xl'
                  : 'gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-2.5 py-1.5 hover:border-violet-400/50 hover:bg-white/15'
              }`}
              title={t.switchProfile}
            >
              <div
                className={`relative flex items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 font-extrabold text-white ${
                  isTv ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-xs'
                }`}
              >
                {session.username.charAt(0).toUpperCase()}
                {session.isAdmin && !session.isDemo && (
                  <Crown
                    className={`absolute -top-1.5 -right-1.5 text-amber-400 drop-shadow ${
                      isTv ? 'h-4 w-4' : 'h-3 w-3'
                    }`}
                  />
                )}
              </div>
              <span
                className={`truncate font-bold ${
                  isTv
                    ? 'text-sm max-w-[140px]'
                    : 'hidden sm:inline text-xs font-semibold text-zinc-100 max-w-[110px]'
                }`}
              >
                {session.username}
              </span>
            </button>

            {profileMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setProfileMenuOpen(false)}
                />
                <div
                  data-tv-scope={isTv ? 'modal' : undefined}
                  className={`absolute right-0 mt-2.5 z-50 rounded-2xl border border-white/20 shadow-2xl ${
                    isTv
                      ? 'w-76 bg-[#101320] p-3.5'
                      : 'w-60 bg-surface/95 p-2.5 backdrop-blur-xl'
                  }`}
                >
                  <div className="border-b border-white/10 px-3 py-2">
                    <p className={`truncate font-bold text-white ${isTv ? 'text-base' : 'text-sm'}`}>
                      {session.username}
                    </p>
                    <p className={isTv ? 'text-xs text-zinc-400 mt-0.5' : 'text-[11px] text-zinc-400'}>
                      {session.isDemo
                        ? t.demoPreview
                        : session.isAdmin
                        ? t.serverAdmin
                        : t.familyMember}
                    </p>
                  </div>

                  {/* Per-Profile Language Selector (English / Română) */}
                  <div className="border-b border-white/10 px-3 py-2.5">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      <Globe className="h-3.5 w-3.5 text-violet-400" />
                      <span>{t.langLabel}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        data-tv-pill={isTv ? 'true' : undefined}
                        onClick={() => setLang('en')}
                        className={`rounded-xl px-2.5 py-1.5 text-xs font-bold transition ${
                          lang === 'en'
                            ? 'bg-violet-600 text-white shadow'
                            : 'bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {t.langEnglish}
                      </button>
                      <button
                        data-tv-pill={isTv ? 'true' : undefined}
                        onClick={() => setLang('ro')}
                        className={`rounded-xl px-2.5 py-1.5 text-xs font-bold transition ${
                          lang === 'ro'
                            ? 'bg-violet-600 text-white shadow'
                            : 'bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {t.langRomanian}
                      </button>
                    </div>
                  </div>

                  <div className="mt-1.5 space-y-1">
                    <button
                      data-tv-default-focus={isTv ? 'true' : undefined}
                      data-tv-pill={isTv ? 'true' : undefined}
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onSwitchProfile();
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3.5 text-left font-bold text-zinc-100 transition hover:bg-white/10 hover:text-white ${
                        isTv ? 'py-3 text-sm' : 'py-2 text-xs font-semibold text-zinc-200'
                      }`}
                    >
                      <Users className={isTv ? 'h-5 w-5 text-violet-400' : 'h-4 w-4 text-violet-400'} />
                      {t.switchProfile}
                    </button>

                    {session.isAdmin && !session.isDemo && (
                      <button
                        data-tv-pill={isTv ? 'true' : undefined}
                        onClick={() => {
                          setProfileMenuOpen(false);
                          onTabChange('family');
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl px-3.5 text-left font-bold text-amber-200 transition hover:bg-amber-500/15 ${
                          isTv ? 'py-3 text-sm' : 'py-2 text-xs font-semibold'
                        }`}
                      >
                        <Crown className={isTv ? 'h-5 w-5 text-amber-400' : 'h-4 w-4 text-amber-400'} />
                        {t.manageFamilyAccounts}
                      </button>
                    )}

                    {isNativeApp && (
                      <button
                        onClick={() => {
                          setProfileMenuOpen(false);
                          onCheckUpdates();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
                      >
                        <Download className="h-4 w-4 text-emerald-400" />
                        {t.checkForUpdates}
                      </button>
                    )}

                    <button
                      data-tv-pill={isTv ? 'true' : undefined}
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onSignOut();
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3.5 text-left font-bold text-red-300 transition hover:bg-red-500/15 ${
                        isTv ? 'py-3 text-sm' : 'py-2 text-xs font-semibold'
                      }`}
                    >
                      <LogOut className={isTv ? 'h-5 w-5' : 'h-4 w-4'} />
                      {t.signOut}
                    </button>
                  </div>

                  <div
                    className={`mt-2 border-t border-white/10 px-3 pt-2 text-zinc-500 ${
                      isTv ? 'text-xs' : 'text-[10px]'
                    }`}
                  >
                    Qualiadept Stream v{APP_VERSION_NAME}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile tab bar */}
      <div className="flex md:hidden items-center justify-around overflow-x-auto no-scrollbar border-t border-white/5 bg-obsidian/90 px-1.5 py-1.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${
              activeTab === item.id ? 'text-violet-400' : 'text-zinc-400'
            }`}
          >
            {item.id === 'family' && <Crown className="h-3 w-3 text-amber-400" />}
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
