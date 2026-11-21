import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Crown,
  Lock,
  Play,
  Plus,
  Server,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import {
  authenticateJellyfin,
  createDemoSession,
  fetchPublicUsers,
  loadSavedProfiles,
  removeSavedProfile,
  saveSession,
} from '../services/jellyfin';
import type { AuthSession, PublicUserProfile } from '../types/media';
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
  const [savedProfiles, setSavedProfiles] = useState<AuthSession[]>(() => loadSavedProfiles());
  const [publicUsers, setPublicUsers] = useState<PublicUserProfile[]>([]);
  const [serverUrl, setServerUrl] = useState(
    () => savedProfiles[0]?.serverUrl || DEFAULT_SERVER_URL
  );
  const [showAdvancedServer, setShowAdvancedServer] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managingProfiles, setManagingProfiles] = useState(false);
  const [showLoginForm, setShowLoginForm] = useState(() => loadSavedProfiles().length === 0);

  useEffect(() => {
    let active = true;
    fetchPublicUsers(serverUrl).then((list) => {
      if (!active) return;
      setPublicUsers(list);
      if (list.length > 0 && savedProfiles.length === 0 && !username) {
        setShowLoginForm(false);
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

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-obsidian px-4 pt-[max(1.5rem,var(--app-safe-top))] pb-[max(1.5rem,var(--app-safe-bottom))]">
      {/* Ambient HBO Max style glowing gradients */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-violet-700/25 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-indigo-600/20 blur-[140px]" />

      <div className="relative z-10 w-full max-w-xl animate-fade-in">
        {onCancel && (
          <button
            onClick={onCancel}
            className="mb-5 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}

        {/* Brand */}
        <div className="mb-7 text-center">
          <BrandLogo size="lg" stacked />
          <p className="mt-3 text-sm text-zinc-400">
            {hasAnyProfiles && !showLoginForm
              ? "Who's watching?"
              : 'Sign in with your personal family account'}
          </p>
        </div>

        {sessionNotice && (
          <div className="mx-auto mb-5 max-w-md rounded-xl border border-amber-400/35 bg-amber-500/15 px-4 py-3 text-center text-xs font-medium text-amber-200">
            {sessionNotice}
          </div>
        )}

        {/* Netflix-style "Who's Watching?" Profile Switcher */}
        {hasAnyProfiles && !showLoginForm ? (
          <div className="rounded-2xl border border-white/10 bg-surface/85 p-6 shadow-2xl backdrop-blur-xl">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {savedProfiles.map((profile) => {
                const isCurrent = profile.userId === activeUserId;
                return (
                  <div key={profile.userId} className="relative flex flex-col items-center">
                    <button
                      onClick={() => {
                        if (managingProfiles) return;
                        handleQuickSwitch(profile);
                      }}
                      className={`group flex w-full flex-col items-center rounded-2xl border p-4 transition ${
                        isCurrent
                          ? 'border-violet-400/70 bg-violet-500/15'
                          : 'border-white/10 bg-white/5 hover:scale-[1.03] hover:border-violet-400/50 hover:bg-white/10'
                      }`}
                    >
                      <div
                        className={`relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${getAvatarGradient(
                          profile.username
                        )} text-2xl font-black text-white shadow-xl`}
                      >
                        {profile.username.charAt(0).toUpperCase()}
                        {profile.isAdmin && (
                          <span
                            title="Admin"
                            className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-obsidian shadow"
                          >
                            <Crown className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                      <span className="mt-3 max-w-full truncate text-sm font-bold text-white">
                        {profile.username}
                      </span>
                      <span className="mt-0.5 text-[10px] font-medium text-emerald-300">
                        {isCurrent ? 'Active now' : 'Saved on device'}
                      </span>
                    </button>

                    {managingProfiles && (
                      <button
                        onClick={() => handleRemoveSaved(profile.userId)}
                        title={`Remove ${profile.username} from this device`}
                        className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-white shadow-lg hover:bg-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}

              {extraPublicProfiles.map((pub) => (
                <button
                  key={pub.id}
                  onClick={() => handleSelectPublicUser(pub)}
                  className="group flex flex-col items-center rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:scale-[1.03] hover:border-violet-400/50 hover:bg-white/10"
                >
                  <div
                    className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${getAvatarGradient(
                      pub.name
                    )} text-2xl font-black text-white shadow-xl`}
                  >
                    {pub.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="mt-3 max-w-full truncate text-sm font-bold text-white">
                    {pub.name}
                  </span>
                  <span className="mt-0.5 text-[10px] text-zinc-400">
                    {pub.hasPassword ? 'Tap to enter password' : 'Tap to sign in'}
                  </span>
                </button>
              ))}

              {/* Add / Sign In Another Account */}
              <button
                onClick={() => {
                  setUsername('');
                  setPassword('');
                  setError(null);
                  setShowLoginForm(true);
                }}
                className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-white/[0.02] p-4 text-zinc-300 transition hover:border-violet-400/60 hover:bg-white/5 hover:text-white"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/5">
                  <Plus className="h-7 w-7 text-violet-300" />
                </div>
                <span className="mt-3 text-sm font-semibold">Add Account</span>
                <span className="mt-0.5 text-[10px] text-zinc-500">Sign in with password</span>
              </button>
            </div>

            {savedProfiles.length > 0 && (
              <div className="mt-5 flex items-center justify-center border-t border-white/10 pt-4">
                <button
                  onClick={() => setManagingProfiles((v) => !v)}
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
                >
                  {managingProfiles ? 'Done Managing' : 'Manage Device Profiles'}
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
                Back to Who&apos;s Watching
              </button>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Username
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your family username"
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
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-white/10 bg-obsidian/80 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/25"
                  />
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
                  <span>Server: {serverUrl.replace(/^https?:\/\//, '')}</span>
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
                {loading ? 'Connecting...' : 'Sign In'}
              </button>
            </form>

            {!onCancel && (
              <>
                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-xs font-medium text-zinc-500">OR PREVIEW NOW</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>

                <button
                  type="button"
                  onClick={handleDemo}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-violet-400/50 hover:bg-white/10"
                >
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  Launch Demo Preview (No Server Needed)
                </button>
              </>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-zinc-500">
          Hosted on <span className="text-zinc-300">qualiadept.eu</span>
        </p>
      </div>
    </div>
  );
};
