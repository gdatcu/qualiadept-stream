import React, { useState } from 'react';
import { Lock, Play, Server, Sparkles, User } from 'lucide-react';
import { authenticateJellyfin, createDemoSession } from '../services/jellyfin';
import type { AuthSession } from '../types/media';
import { BrandLogo } from './BrandLogo';

interface LoginScreenProps {
  onLogin: (session: AuthSession) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [serverUrl, setServerUrl] = useState('https://media.qualiadept.eu');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleDemo = () => {
    const demo = createDemoSession();
    onLogin(demo);
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-obsidian px-4 pt-[max(1.5rem,var(--app-safe-top))] pb-[max(1.5rem,var(--app-safe-bottom))]">
      {/* Ambient HBO Max style glowing gradients */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-violet-700/25 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-indigo-600/20 blur-[140px]" />

      <div className="relative z-10 w-full max-w-md animate-fade-in">
        {/* Brand */}
        <div className="mb-8 text-center">
          <BrandLogo size="lg" stacked />
          <p className="mt-3 text-sm text-zinc-400">
            Private Cinema powered by Google Drive &amp; Oracle Cloud
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-surface/85 p-7 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Media Server URL
              </label>
              <div className="relative">
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
                  className="w-full rounded-xl border border-white/10 bg-obsidian/80 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/25"
                />
              </div>
            </div>

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
                  placeholder="Enter your Jellyfin username"
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
              {loading ? 'Connecting...' : 'Sign In to Server'}
            </button>
          </form>

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
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Hosted on <span className="text-zinc-300">qualiadept.eu</span>
        </p>
      </div>
    </div>
  );
};
