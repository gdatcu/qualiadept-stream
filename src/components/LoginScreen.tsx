import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Crown,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Play,
  Plus,
  Server,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import { useI18n } from '../i18n';
import {
  authenticateJellyfin,
  createDemoSession,
  fetchPublicUsers,
  loadSavedProfiles,
  pruneHiddenSavedProfiles,
  removeSavedProfile,
  saveSession,
} from '../services/jellyfin';
import type { AuthSession, PublicUserProfile } from '../types/media';
import { isTizenTv } from '../utils/tvNavigation';
import { BrandLogo } from './BrandLogo';

interface LoginScreenProps {
  onLogin: (session: AuthSession) => void;
  /** When opened from Navbar "Switch Profile", allows returning to the active profile */
  onCancel?: () => void;
  activeUserId?: string;
  /** Informational banner shown when redirected back due to an expired/revoked session */
  sessionNotice?: string | null;
}

const AVATAR_GRADIENTS = [
  'from-violet-500 to-fuchsia-500',
  'from-sky-500 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-cyan-500 to-blue-600',
];

function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

const DEFAULT_SERVER_URL = 'https://media.qualiadept.eu';

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLogin,
  onCancel,
  activeUserId,
  sessionNotice,
}) => {
  const { lang, setLang, t } = useI18n();
  const [savedProfiles, setSavedProfiles] = useState<AuthSession[]>(() => loadSavedProfiles());
  const [publicUsers, setPublicUsers] = useState<PublicUserProfile[]>([]);
  const [serverUrl, setServerUrl] = useState(
    () => savedProfiles[0]?.serverUrl || DEFAULT_SERVER_URL
  );
  const [showAdvancedServer, setShowAdvancedServer] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managingProfiles, setManagingProfiles] = useState(false);
  const [showLoginForm, setShowLoginForm] = useState(() => loadSavedProfiles().length === 0);

  useEffect(() => {
    let active = true;
    fetchPublicUsers(serverUrl).then((list) => {
      if (!active || list === null) return;
      const pruned = pruneHiddenSavedProfiles(serverUrl, new Set(list.map((u) => u.id)));
      setSavedProfiles(pruned);
      setPublicUsers(list);
      if (list.length > 0 && pruned.length === 0 && !username) {
        setShowLoginForm(false);
      } else if (list.length === 0 && pruned.length === 0) {
        setShowLoginForm(true);
      }
    });
    return () => {
      active = false;
    };
  }, [serverUrl]);

  const savedIds = new Set(savedProfiles.map((p) => p.userId));
  const extraPublicProfiles = publicUsers.filter((u) => !savedIds.has(u.id));
  const hasAnyProfiles = savedProfiles.length > 0 || extraPublicProfiles.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await authenticateJellyfin(serverUrl, username, password);
      onLogin(session);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to reach media server. Make sure your Oracle VM is online.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSwitch = (profile: AuthSession) => {
    saveSession(profile);
    onLogin(profile);
  };

  const handleSelectPublicUser = (pub: PublicUserProfile) => {
    setUsername(pub.name);
    setPassword('');
    setError(null);
    setShowLoginForm(true);
  };

  const handleRemoveSaved = (userId: string) => {
    removeSavedProfile(userId);
    const next = loadSavedProfiles();
    setSavedProfiles(next);
    if (next.length === 0 && extraPublicProfiles.length === 0) {
      setManagingProfiles(false);
      setShowLoginForm(true);
    }
  };

  const handleDemo = () => {
    const demo = createDemoSession();
    onLogin(demo);
  };

  const isTv = isTizenTv();

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-obsidian px-4 pt-[max(1.5rem,var(--app-safe-top))] pb-[max(1.5rem,var(--app-safe-bottom))]">
      {/* Ambient HBO Max style glowing gradients (hidden on Tizen TV to keep GPU responsive) */}
      <div className="tv-ambient-glow pointer-events-none absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-violet-700/25 blur-[140px]" />
      <div className="tv-ambient-glow pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-indigo-600/20 blur-[140px]" />

      {/* Top-Right EN / RO Language Selector (accessible on Login & Who's Watching on TV, Mobile & Web) */}
      <div
        data-tv-row={isTv ? 'login-topbar' : undefined}
        className={`absolute z-20 flex items-center gap-1 rounded-full border border-white/15 p-1 shadow-xl ${
          isTv
            ? 'top-6 right-[3.8vw] bg-[#121626]'
            : 'top-[max(1rem,var(--app-safe-top))] right-4 sm:right-6 bg-surface/90 backdrop-blur-md'
        }`}
      >
        <Globe className={isTv ? 'ml-2.5 mr-1 h-4 w-4 text-violet-300' : 'ml-2 mr-0.5 h-3.5 w-3.5 text-violet-300'} />
        <button
          type="button"
          data-tv-pill={isTv ? 'true' : undefined}
          onClick={() => setLang('en')}
          className={`rounded-full font-bold transition ${
            isTv ? 'px-3.5 py-1.5 text-xs' : 'px-2.5 py-1 text-[11px]'
          } ${
            lang === 'en'
              ? 'bg-violet-600 text-white shadow'
              : 'text-zinc-300 hover:text-white'
          }`}
        >
          EN
        </button>
        <button
          type="button"
          data-tv-pill={isTv ? 'true' : undefined}
          onClick={() => setLang('ro')}
          className={`rounded-full font-bold transition ${
            isTv ? 'px-3.5 py-1.5 text-xs' : 'px-2.5 py-1 text-[11px]'
          } ${
            lang === 'ro'
              ? 'bg-violet-600 text-white shadow'
              : 'text-zinc-300 hover:text-white'
          }`}
        >
          RO
        </button>
      </div>

      <div
        className={`relative z-10 w-full animate-fade-in ${
          isTv && hasAnyProfiles && !showLoginForm ? 'max-w-5xl' : 'max-w-xl'
        }`}
      >
        {onCancel && (
          <button
            data-tv-pill={isTv ? 'true' : undefined}
            onClick={onCancel}
            className={
              isTv
                ? 'mb-6 inline-flex items-center gap-2.5 rounded-full border border-white/20 bg-[#121626] px-5 py-2.5 text-sm font-bold text-zinc-100'
                : 'mb-5 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10'
            }
          >
            <ArrowLeft className={isTv ? 'h-5 w-5' : 'h-4 w-4'} />
            {t.back}
          </button>
        )}

        {/* Brand */}
        <div className={isTv ? 'mb-10 text-center' : 'mb-7 text-center'}>
          <BrandLogo size="lg" stacked />
          <p className={isTv ? 'mt-4 text-2xl font-bold text-zinc-200' : 'mt-3 text-sm text-zinc-400'}>
            {hasAnyProfiles && !showLoginForm ? t.whosWatching : t.signInSubtitle}
          </p>
        </div>

        {sessionNotice && (
          <div className="mx-auto mb-5 max-w-md rounded-xl border border-amber-400/35 bg-amber-500/15 px-4 py-3 text-center text-xs font-medium text-amber-200">
            {sessionNotice}
          </div>
        )}

        {/* Netflix-style "Who's Watching?" Profile Switcher */}
        {hasAnyProfiles && !showLoginForm ? (
          <div
            className={
              isTv
                ? 'px-4 py-2'
                : 'rounded-2xl border border-white/10 bg-surface/85 p-6 shadow-2xl backdrop-blur-xl'
            }
          >
            <div
              data-tv-row={isTv ? 'login-profiles' : undefined}
              className={
                isTv
                  ? 'flex flex-wrap items-start justify-center gap-8 py-4'
                  : 'grid grid-cols-2 gap-4 sm:grid-cols-3'
              }
            >
              {savedProfiles.map((profile, idx) => {
                const isCurrent = profile.userId === activeUserId;
                return (
                  <div key={profile.userId} className="relative flex flex-col items-center">
                    <button
                      data-tv-card={isTv ? 'true' : undefined}
                      data-tv-default-focus={isTv && idx === 0 ? 'true' : undefined}
                      onClick={() => {
                        if (managingProfiles) return;
                        handleQuickSwitch(profile);
                      }}
                      className={
                        isTv
                          ? 'group flex w-40 flex-col items-center focus:outline-none'
                          : `group flex w-full flex-col items-center rounded-2xl border p-4 transition ${
                              isCurrent
                                ? 'border-violet-400/70 bg-violet-500/15'
                                : 'border-white/10 bg-white/5 hover:scale-[1.03] hover:border-violet-400/50 hover:bg-white/10'
                            }`
                      }
                    >
                      <div
                        className={`tv-card-frame relative flex items-center justify-center bg-gradient-to-br ${getAvatarGradient(
                          profile.username
                        )} font-black text-white shadow-xl ${
                          isTv
                            ? 'h-32 w-32 rounded-3xl border-2 border-white/20 text-5xl'
                            : 'h-16 w-16 rounded-2xl text-2xl'
                        }`}
                      >
                        {profile.username.charAt(0).toUpperCase()}
                        {profile.isAdmin && (
                          <span
                            title="Admin"
                            className={`absolute -top-2 -right-2 flex items-center justify-center rounded-full bg-amber-400 text-obsidian shadow ${
                              isTv ? 'h-8 w-8' : 'h-6 w-6'
                            }`}
                          >
                            <Crown className={isTv ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
                          </span>
                        )}
                      </div>
                      <span
                        className={
                          isTv
                            ? 'tv-card-title mt-3.5 max-w-full truncate text-lg font-bold text-zinc-200'
                            : 'mt-3 max-w-full truncate text-sm font-bold text-white'
                        }
                      >
                        {profile.username}
                      </span>
                      <span
                        className={
                          isTv
                            ? 'mt-0.5 text-xs font-medium text-emerald-300'
                            : 'mt-0.5 text-[10px] font-medium text-emerald-300'
                        }
                      >
                        {isCurrent ? t.activeNow : t.ready}
                      </span>
                    </button>

                    {managingProfiles && (
                      <button
                        onClick={() => handleRemoveSaved(profile.userId)}
                        title={`${t.removeFromDevice}: ${profile.username}`}
                        className="absolute -top-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white shadow-lg hover:bg-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}

              {extraPublicProfiles.map((pub, idx) => (
                <button
                  key={pub.id}
                  data-tv-card={isTv ? 'true' : undefined}
                  data-tv-default-focus={isTv && savedProfiles.length === 0 && idx === 0 ? 'true' : undefined}
                  onClick={() => handleSelectPublicUser(pub)}
                  className={
                    isTv
                      ? 'group flex w-40 flex-col items-center focus:outline-none'
                      : 'group flex flex-col items-center rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:scale-[1.03] hover:border-violet-400/50 hover:bg-white/10'
                  }
                >
                  <div
                    className={`tv-card-frame flex items-center justify-center bg-gradient-to-br ${getAvatarGradient(
                      pub.name
                    )} font-black text-white shadow-xl ${
                      isTv
                        ? 'h-32 w-32 rounded-3xl border-2 border-white/20 text-5xl'
                        : 'h-16 w-16 rounded-2xl text-2xl'
                    }`}
                  >
                    {pub.name.charAt(0).toUpperCase()}
                  </div>
                  <span
                    className={
                      isTv
                        ? 'tv-card-title mt-3.5 max-w-full truncate text-lg font-bold text-zinc-200'
                        : 'mt-3 max-w-full truncate text-sm font-bold text-white'
                    }
                  >
                    {pub.name}
                  </span>
                  <span className={isTv ? 'mt-0.5 text-xs text-zinc-400' : 'mt-0.5 text-[10px] text-zinc-400'}>
                    {pub.hasPassword ? t.passwordProtected : t.signIn}
                  </span>
                </button>
              ))}

              {/* Add / Sign In Another Account */}
              <button
                data-tv-card={isTv ? 'true' : undefined}
                onClick={() => {
                  setUsername('');
                  setPassword('');
                  setError(null);
                  setShowLoginForm(true);
                }}
                className={
                  isTv
                    ? 'group flex w-40 flex-col items-center text-zinc-300 focus:outline-none'
                    : 'flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-white/[0.02] p-4 text-zinc-300 transition hover:border-violet-400/60 hover:bg-white/5 hover:text-white'
                }
              >
                <div
                  className={
                    isTv
                      ? 'tv-card-frame flex h-32 w-32 items-center justify-center rounded-3xl border-2 border-white/20 bg-[#121626]'
                      : 'flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/5'
                  }
                >
                  <Plus className={isTv ? 'h-12 w-12 text-zinc-200' : 'h-7 w-7 text-violet-300'} />
                </div>
                <span
                  className={
                    isTv
                      ? 'tv-card-title mt-3.5 text-lg font-bold text-zinc-200'
                      : 'mt-3 text-sm font-semibold'
                  }
                >
                  {t.addAccount}
                </span>
                <span className={isTv ? 'mt-0.5 text-xs text-zinc-500' : 'mt-0.5 text-[10px] text-zinc-500'}>
                  {t.otherProfile}
                </span>
              </button>
            </div>

            {savedProfiles.length > 0 && (
              <div className="mt-7 flex items-center justify-center pt-3">
                <button
                  data-tv-pill={isTv ? 'true' : undefined}
                  onClick={() => setManagingProfiles((v) => !v)}
                  className={
                    isTv
                      ? 'rounded-full border border-white/20 bg-[#121626] px-6 py-2.5 text-sm font-bold text-zinc-200'
                      : 'rounded-xl border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white'
                  }
                >
                  {managingProfiles ? t.doneManaging : t.manageDeviceProfiles}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Clean Family Sign-In Form (Server URL neatly tucked behind Advanced) */
          <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-surface/85 p-7 shadow-2xl backdrop-blur-xl">
            {hasAnyProfiles && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setShowLoginForm(false);
                }}
                className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 hover:text-violet-200"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t.backToWhosWatching}
              </button>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  {t.username}
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    id="qs-login-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (username.trim()) {
                          document.getElementById('qs-login-password')?.focus();
                        }
                      }
                    }}
                    placeholder={t.usernamePlaceholder}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    className="w-full rounded-xl border border-white/10 bg-obsidian/80 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/25"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  {t.password}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    id="qs-login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full rounded-xl border border-white/10 bg-obsidian/80 py-3 pl-10 pr-11 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                    title={showPassword ? t.hidePassword : t.showPassword}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Advanced Server URL Toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvancedServer((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 hover:text-zinc-200"
                >
                  <Server className="h-3.5 w-3.5" />
                  <span>
                    {t.serverLabel}: {serverUrl.replace(/^https?:\/\//, '')}
                  </span>
                  {showAdvancedServer ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>

                {showAdvancedServer && (
                  <div className="mt-2 relative">
                    <Server className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      type="text"
                      value={serverUrl}
                      onChange={(e) => setServerUrl(e.target.value)}
                      placeholder="https://media.qualiadept.eu"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                      className="w-full rounded-xl border border-white/10 bg-obsidian/80 py-2.5 pl-10 pr-4 text-xs text-white placeholder-zinc-500 outline-none transition focus:border-violet-500"
                    />
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-600/30 transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
              >
                <Play className="h-4 w-4 fill-current" />
                {loading ? t.signingIn : t.signIn}
              </button>
            </form>

            {!onCancel && (
              <>
                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-xs font-medium text-zinc-500">{t.orPreviewNow}</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>

                <button
                  type="button"
                  onClick={handleDemo}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-violet-400/50 hover:bg-white/10"
                >
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  {t.launchDemoPreview}
                </button>
              </>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-zinc-500">
          {t.hostedOn} <span className="text-zinc-300">qualiadept.eu</span>
        </p>
      </div>
    </div>
  );
};
