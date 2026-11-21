import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Baby,
  Check,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Pause,
  Play,
  RefreshCw,
  Share2,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  createFamilyUser,
  deleteFamilyUser,
  fetchActiveStreams,
  fetchAllFamilyUsers,
  resetFamilyUserPassword,
  updateFamilyUserPolicy,
} from '../services/jellyfin';
import type {
  ActiveStreamSession,
  AuthSession,
  FamilyUser,
  ParentalTier,
} from '../types/media';

interface FamilyAdminViewProps {
  session: AuthSession;
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

function formatLastSeen(iso?: string): string {
  if (!iso) return 'Never signed in yet';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Active recently';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 2) return 'Active just now';
  if (mins < 60) return `Active ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Active ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Active ${days}d ago`;
}

export const FamilyAdminView: React.FC<FamilyAdminViewProps> = ({ session }) => {
  const [users, setUsers] = useState<FamilyUser[]>([]);
  const [streams, setStreams] = useState<ActiveStreamSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Add Family Member Form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newTier, setNewTier] = useState<ParentalTier>('adult');
  const [newAllowTranscode, setNewAllowTranscode] = useState(true);
  const [newMaxStreams, setNewMaxStreams] = useState(2);
  const [newShowOnSharedLogin, setNewShowOnSharedLogin] = useState(true);
  const [creating, setCreating] = useState(false);

  // Per-user actions
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((prev) => (prev === msg ? null : prev)), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userList, activeList] = await Promise.all([
        fetchAllFamilyUsers(session),
        fetchActiveStreams(session),
      ]);
      setUsers(userList);
      setStreams(activeList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load family members');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await createFamilyUser(session, {
        name: newName,
        password: newPassword,
        parentalTier: newTier,
        allowTranscoding: newAllowTranscode,
        maxActiveSessions: newMaxStreams,
        showOnSharedLogin: newShowOnSharedLogin,
      });
      setUsers((prev) =>
        [...prev, created].sort(
          (a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.name.localeCompare(b.name)
        )
      );
      setNewName('');
      setNewPassword('');
      setNewTier('adult');
      setShowCreateForm(false);
      flashNotice(`Created family member "${created.name}" (non-admin).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create family member');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdatePolicy = async (
    user: FamilyUser,
    patch: Parameters<typeof updateFamilyUserPolicy>[2],
    successMsg: string
  ) => {
    setBusyUserId(user.id);
    setError(null);
    try {
      const updated = await updateFamilyUserPolicy(session, user.id, patch);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
      flashNotice(successMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetPassword = async (user: FamilyUser) => {
    setBusyUserId(user.id);
    setError(null);
    try {
      await resetFamilyUserPassword(session, user.id, resetPwValue);
      setResetUserId(null);
      setResetPwValue('');
      flashNotice(`Updated password for "${user.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDelete = async (user: FamilyUser) => {
    setBusyUserId(user.id);
    setError(null);
    try {
      await deleteFamilyUser(session, user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setConfirmDeleteId(null);
      flashNotice(`Removed "${user.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setBusyUserId(null);
    }
  };

  if (!session.isAdmin) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-[calc(7.5rem+var(--app-safe-top))] pb-16 text-center">
        <Shield className="mx-auto h-10 w-10 text-zinc-500" />
        <h1 className="mt-3 text-xl font-bold text-white">Administrator Access Only</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Only the owner account can manage family profiles.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 pt-[calc(7.5rem+var(--app-safe-top))] pb-16 sm:px-8">
      {/* Header */}
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-black text-white sm:text-3xl">
            <Users className="h-6 w-6 text-violet-400" />
            Family &amp; Profiles
          </h1>
          <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
            Each family member gets their own Continue Watching &amp; My List. Only{' '}
            <span className="font-semibold text-violet-300">{session.username}</span> stays Admin.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-600/25 transition hover:from-violet-500 hover:to-indigo-500"
          >
            <UserPlus className="h-4 w-4" />
            Add Family Member
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-5 flex items-center justify-between rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-3 text-xs font-semibold text-emerald-200">
          <span className="flex items-center gap-2">
            <Check className="h-4 w-4" />
            {notice}
          </span>
          <button onClick={() => setNotice(null)} className="text-emerald-300 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="mb-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-3 text-xs text-red-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Add Family Member Drawer */}
      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="mb-8 rounded-2xl border border-violet-500/35 bg-surface/95 p-5 shadow-2xl animate-fade-in"
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">New Family Member</h2>
              <p className="text-xs text-zinc-400">
                Created as a standard viewer (Admin &amp; Delete permissions permanently disabled).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Username
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. mama, andrei, kids"
                autoCapitalize="none"
                autoCorrect="off"
                required
                className="w-full rounded-xl border border-white/10 bg-obsidian/80 px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Password (min 4 chars)
              </label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Choose a simple family password"
                autoCapitalize="none"
                autoCorrect="off"
                required
                minLength={4}
                className="w-full rounded-xl border border-white/10 bg-obsidian/80 px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Content Access
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'adult', label: 'Adult', desc: 'All titles' },
                    { id: 'teen', label: 'Teen', desc: 'Up to PG-13' },
                    { id: 'kids', label: 'Kids', desc: 'PG & G only' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setNewTier(opt.id)}
                    className={`rounded-xl border px-2.5 py-2 text-left transition ${
                      newTier === opt.id
                        ? 'border-violet-400 bg-violet-600/25 text-white'
                        : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-xs font-bold">{opt.label}</div>
                    <div className="text-[10px] text-zinc-400">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Max Simultaneous Streams
              </label>
              <select
                value={newMaxStreams}
                onChange={(e) => setNewMaxStreams(Number(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-obsidian/80 px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-500"
              >
                <option value={1}>1 stream at a time (best for kids/mobile)</option>
                <option value={2}>2 streams at a time (recommended)</option>
                <option value={3}>3 streams at a time</option>
                <option value={0}>Unlimited</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-white/10 pt-4 text-xs text-zinc-300">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={newAllowTranscode}
                onChange={(e) => setNewAllowTranscode(e.target.checked)}
                className="h-4 w-4 rounded accent-violet-500"
              />
              <span>Allow video transcoding (needed for mobile 720p/480p)</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={newShowOnSharedLogin}
                onChange={(e) => setNewShowOnSharedLogin(e.target.checked)}
                className="h-4 w-4 rounded accent-violet-500"
              />
              <span>Show avatar on &ldquo;Who&apos;s Watching?&rdquo; picker</span>
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {creating ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      )}

      {/* Live Watching Now */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <Activity className="h-4 w-4 text-emerald-400" />
          Watching Now ({streams.length})
        </h2>
        {streams.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-surface/60 px-5 py-4 text-xs text-zinc-400">
            No active streams right now — server CPU is idle.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {streams.map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-surface/85 p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{s.username}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        s.playMethod === 'Transcode'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {s.playMethod === 'Transcode' ? 'Transcode' : 'Direct Play'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-200">{s.nowPlayingTitle}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    {s.deviceName} · {s.client}
                  </p>
                </div>
                <span className="mt-0.5 text-zinc-400">
                  {s.isPaused ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 text-emerald-400" />}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Family Members Grid */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
          Accounts ({users.length})
        </h2>

        {loading && users.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-400">Loading family accounts...</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {users.map((user) => {
              const isBusy = busyUserId === user.id;
              const isSelf = user.id === session.userId;

              return (
                <div
                  key={user.id}
                  className={`rounded-2xl border p-4 transition ${
                    user.isDisabled
                      ? 'border-red-500/25 bg-surface/50 opacity-75'
                      : 'border-white/10 bg-surface/90'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${getAvatarGradient(
                          user.name
                        )} text-base font-black text-white shadow-lg`}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="truncate text-sm font-bold text-white">{user.name}</h3>
                          {user.isAdmin && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                              <Crown className="h-3 w-3" />
                              Admin
                            </span>
                          )}
                          {user.parentalTier === 'kids' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                              <Baby className="h-3 w-3" />
                              Kids
                            </span>
                          )}
                          {user.parentalTier === 'teen' && (
                            <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                              Teen (PG-13)
                            </span>
                          )}
                          {user.isDisabled && (
                            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300">
                              Paused
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-zinc-400">
                          {formatLastSeen(user.lastActivityDate)}
                          {user.maxActiveSessions > 0 && ` · Max ${user.maxActiveSessions} streams`}
                        </p>
                      </div>
                    </div>

                    {!user.isAdmin && !isSelf && (
                      <div className="flex items-center gap-1">
                        <button
                          disabled={isBusy}
                          onClick={async () => {
                            const inviteText = `Qualiadept Stream\nWeb: https://stream.qualiadept.eu\nAndroid APK: https://github.com/gdatcu/qualiadept-stream/releases/latest\nUsername: ${user.name}`;
                            try {
                              if (navigator.share) {
                                await navigator.share({
                                  title: 'Qualiadept Stream Invite',
                                  text: inviteText,
                                });
                                return;
                              }
                            } catch {
                              // User cancelled or share unavailable — fall through to clipboard
                            }
                            try {
                              await navigator.clipboard.writeText(inviteText);
                              flashNotice(`Copied invite details for "${user.name}".`);
                            } catch {
                              flashNotice(`Username: ${user.name} · https://stream.qualiadept.eu`);
                            }
                          }}
                          title="Share or copy invite"
                          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-violet-500/20 hover:text-violet-300"
                        >
                          <Share2 className="h-4 w-4" />
                        </button>
                        <button
                          disabled={isBusy}
                          onClick={() => {
                            setResetUserId(resetUserId === user.id ? null : user.id);
                            setResetPwValue('');
                            setConfirmDeleteId(null);
                          }}
                          title="Reset password"
                          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          disabled={isBusy}
                          onClick={() => {
                            setConfirmDeleteId(confirmDeleteId === user.id ? null : user.id);
                            setResetUserId(null);
                          }}
                          title="Delete account"
                          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-500/20 hover:text-red-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Quick Settings for Non-Admin Family Members */}
                  {!user.isAdmin && (
                    <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                      <select
                        disabled={isBusy}
                        value={user.parentalTier}
                        onChange={(e) =>
                          handleUpdatePolicy(
                            user,
                            { parentalTier: e.target.value as ParentalTier },
                            `Updated content rating for "${user.name}".`
                          )
                        }
                        className="rounded-lg border border-white/10 bg-obsidian/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 outline-none focus:border-violet-500"
                      >
                        <option value="adult">Adult (All)</option>
                        <option value="teen">Teen (PG-13)</option>
                        <option value="kids">Kids (PG &amp; G)</option>
                      </select>

                      <button
                        disabled={isBusy}
                        onClick={() =>
                          handleUpdatePolicy(
                            user,
                            { allowTranscoding: !user.allowTranscoding },
                            `${user.allowTranscoding ? 'Disabled' : 'Enabled'} transcoding for "${user.name}".`
                          )
                        }
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                          user.allowTranscoding
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-white/10 bg-white/5 text-zinc-400'
                        }`}
                      >
                        {user.allowTranscoding ? 'Transcode: On' : 'Direct Play Only'}
                      </button>

                      <button
                        disabled={isBusy}
                        onClick={() =>
                          handleUpdatePolicy(
                            user,
                            { showOnSharedLogin: user.isHidden },
                            `${user.isHidden ? 'Shown' : 'Hidden'} "${user.name}" on Who's Watching picker.`
                          )
                        }
                        className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-white/10"
                      >
                        {user.isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        {user.isHidden ? 'Hidden' : 'On Picker'}
                      </button>

                      <button
                        disabled={isBusy}
                        onClick={() =>
                          handleUpdatePolicy(
                            user,
                            { isDisabled: !user.isDisabled },
                            `${user.isDisabled ? 'Re-enabled' : 'Paused'} "${user.name}".`
                          )
                        }
                        className={`ml-auto rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                          user.isDisabled
                            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200'
                            : 'border-white/10 bg-white/5 text-zinc-400 hover:text-amber-300'
                        }`}
                      >
                        {user.isDisabled ? 'Unpause' : 'Pause'}
                      </button>
                    </div>
                  )}

                  {/* Inline Reset Password */}
                  {resetUserId === user.id && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-violet-500/30 bg-obsidian/80 p-2.5">
                      <input
                        type="text"
                        value={resetPwValue}
                        onChange={(e) => setResetPwValue(e.target.value)}
                        placeholder="New password (min 4 chars)"
                        autoCapitalize="none"
                        autoCorrect="off"
                        className="min-w-0 flex-1 bg-transparent px-2 text-xs text-white placeholder-zinc-500 outline-none"
                      />
                      <button
                        disabled={isBusy || resetPwValue.length < 4}
                        onClick={() => handleResetPassword(user)}
                        className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {/* Inline Delete Confirmation */}
                  {confirmDeleteId === user.id && (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs">
                      <span className="text-red-200">Delete &ldquo;{user.name}&rdquo;?</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg bg-white/10 px-2.5 py-1 text-zinc-200"
                        >
                          Cancel
                        </button>
                        <button
                          disabled={isBusy}
                          onClick={() => handleDelete(user)}
                          className="rounded-lg bg-red-600 px-3 py-1 font-bold text-white hover:bg-red-500"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};
