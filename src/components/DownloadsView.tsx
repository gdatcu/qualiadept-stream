import React, { useEffect, useState } from 'react';
import { Download, HardDrive, Play, Trash2, WifiOff, X } from 'lucide-react';
import {
  cancelOfflineDownload,
  clearAllOfflineDownloads,
  deleteOfflineDownload,
  formatBytes,
  getOfflineStorageSummary,
  listActiveDownloads,
  listOfflineRecords,
  subscribeOfflineDownloads,
  type ActiveDownloadState,
  type OfflineRecord,
} from '../services/offlineDownloads';
import type { MediaItem } from '../types/media';

interface DownloadsViewProps {
  onPlayOffline: (item: MediaItem) => void;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({ onPlayOffline }) => {
  const [records, setRecords] = useState<OfflineRecord[]>(() => listOfflineRecords());
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownloadState[]>(() =>
    listActiveDownloads()
  );
  const [storage, setStorage] = useState<{
    downloadedBytes: number;
    deviceAvailableBytes: number | null;
  }>({ downloadedBytes: 0, deviceAvailableBytes: null });

  const refresh = () => {
    setRecords(listOfflineRecords());
    setActiveDownloads(listActiveDownloads());
    getOfflineStorageSummary().then(setStorage);
  };

  useEffect(() => {
    refresh();
    return subscribeOfflineDownloads(refresh);
  }, []);

  return (
    <main className="mx-auto max-w-[1400px] px-4 pt-[calc(7.5rem+var(--app-safe-top))] pb-16 sm:px-8">
      {/* Header + Storage Summary */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-black text-white sm:text-3xl">
            <HardDrive className="h-6 w-6 text-violet-400" />
            Offline Downloads
          </h1>
          <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
            Saved inside the app for instant, zero-buffering playback — even in Airplane Mode.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-xl border border-white/10 bg-surface/90 px-4 py-2 text-xs">
            <span className="font-bold text-white">{formatBytes(storage.downloadedBytes)}</span>
            <span className="text-zinc-400"> used</span>
            {storage.deviceAvailableBytes !== null && (
              <span className="text-zinc-500">
                {' '}
                · {formatBytes(storage.deviceAvailableBytes)} free
              </span>
            )}
          </div>
          {records.length > 0 && (
            <button
              onClick={() => clearAllOfflineDownloads()}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/20"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Active Downloads */}
      {activeDownloads.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-violet-300">
            Downloading Now ({activeDownloads.length})
          </h2>
          <div className="space-y-3">
            {activeDownloads.map((dl) => (
              <div
                key={dl.itemId}
                className="rounded-2xl border border-violet-500/30 bg-surface/90 p-4 shadow-lg"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-white">
                      {dl.item.seriesName
                        ? `${dl.item.seriesName} · S${dl.item.seasonNumber}E${dl.item.episodeNumber} · `
                        : ''}
                      {dl.item.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {dl.qualityLabel} ·{' '}
                      {dl.status === 'preparing'
                        ? 'Starting stream on server...'
                        : dl.status === 'saving'
                        ? 'Finalizing offline file...'
                        : `${formatBytes(dl.bytesDownloaded)}${
                            dl.totalBytes ? ` / ~${formatBytes(dl.totalBytes)}` : ''
                          }${dl.speedMbps > 0 ? ` · ${dl.speedMbps} Mbps` : ''}`}
                    </p>
                  </div>
                  <button
                    onClick={() => cancelOfflineDownload(dl.itemId)}
                    className="flex items-center gap-1 rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-red-500/20 hover:text-red-200"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                </div>

                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-300"
                    style={{ width: `${Math.max(4, dl.percent)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Completed Offline Downloads */}
      {records.length === 0 && activeDownloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-surface/60 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-400">
            <Download className="h-7 w-7" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-white">No offline downloads yet</h2>
          <p className="mt-2 max-w-md text-xs leading-relaxed text-zinc-400 sm:text-sm">
            Open any movie or TV episode and tap <strong className="text-zinc-200">Download</strong>{' '}
            to save a compact Mobile HD copy (~1.3 GB instead of 10+ GB) for instant, buffer-free
            offline viewing.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {records.map((rec) => (
            <div
              key={rec.id}
              className="group overflow-hidden rounded-2xl border border-white/10 bg-surface transition hover:border-violet-400/50"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => onPlayOffline(rec.item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPlayOffline(rec.item);
                  }
                }}
                className="relative aspect-video cursor-pointer overflow-hidden bg-surface-elevated"
              >
                {(rec.posterDataUrl || rec.item.backdropUrl || rec.item.posterUrl) && (
                  <img
                    src={rec.posterDataUrl || rec.item.backdropUrl || rec.item.posterUrl}
                    alt={rec.item.name}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                  <span className="flex items-center gap-1 rounded-md bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold text-obsidian">
                    <WifiOff className="h-3 w-3" />
                    {rec.qualityLabel}
                  </span>
                  <span className="rounded-md bg-black/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-zinc-200 backdrop-blur-sm">
                    {formatBytes(rec.sizeBytes)}
                  </span>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-obsidian shadow-xl transition group-hover:scale-110">
                    <Play className="ml-0.5 h-5 w-5 fill-obsidian" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-white">{rec.item.name}</h3>
                  <p className="mt-0.5 truncate text-xs text-zinc-400">
                    {rec.item.seriesName
                      ? `${rec.item.seriesName} · S${rec.item.seasonNumber}E${rec.item.episodeNumber}`
                      : rec.item.year || 'Movie'}
                    {rec.subtitles.length > 0 ? ` · ${rec.subtitles.length} sub` : ''}
                  </p>
                </div>
                <button
                  onClick={() => deleteOfflineDownload(rec.id)}
                  title="Delete offline copy"
                  className="flex-shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:bg-red-500/20 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
};
