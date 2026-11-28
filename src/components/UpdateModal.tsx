import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Download, ExternalLink, Sparkles, X } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  APP_VERSION_NAME,
  dismissAppUpdate,
  openApkDownload,
  type AppUpdateInfo,
} from '../services/appUpdate';

interface UpdateModalProps {
  update: AppUpdateInfo;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ update, onClose }) => {
  const [downloadStarted, setDownloadStarted] = useState(false);
  const { lang, t } = useI18n();

  const handleUpdateNow = () => {
    openApkDownload(update);
    setDownloadStarted(true);
  };

  const handleLater = () => {
    dismissAppUpdate(update.versionCode);
    onClose();
  };

  return (
    <div
      data-tv-scope="modal"
      onClick={handleLater}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 pt-[max(1rem,var(--app-safe-top))] pb-[max(1rem,var(--app-safe-bottom))] backdrop-blur-md"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-violet-500/35 bg-surface p-6 shadow-2xl animate-fade-in"
      >
        <button
          onClick={handleLater}
          aria-label={t.close}
          className="absolute top-4 right-4 rounded-full p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-600/30">
          <Sparkles className="h-6 w-6" />
        </div>

        <h2 className="text-xl font-black text-white">{t.updateAvailable}</h2>
        <div className="mt-2 flex items-center gap-2 text-xs font-semibold">
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-zinc-300">
            v{APP_VERSION_NAME}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-violet-400" />
          <span className="rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-2.5 py-1 text-emerald-300">
            v{update.versionName}
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-zinc-300">{t.updateReadyDesc}</p>

        {downloadStarted ? (
          <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200">
            <div className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
              <span>{t.downloadStarted}</span>
            </div>
            <p className="mt-1 text-emerald-200/85">
              {lang === 'ro' ? (
                <>
                  Deschide <span className="font-semibold">{update.apkName}</span> din notificări și apasă{' '}
                  <span className="font-semibold">Actualizează</span>. Contul și descărcările offline rămân salvate.
                </>
              ) : (
                <>
                  Open <span className="font-semibold">{update.apkName}</span> from your download
                  notification and tap <span className="font-semibold">Update</span>. Your login and
                  offline downloads stay safe.
                </>
              )}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-400">
            {lang === 'ro' ? (
              <>
                Apasă <span className="font-semibold text-zinc-200">{t.updateNow}</span>, deschide fișierul
                descărcat și apasă <span className="font-semibold text-zinc-200">Actualizează</span>. Contul și
                descărcările offline rămân intacte.
              </>
            ) : (
              <>
                Tap <span className="font-semibold text-zinc-200">{t.updateNow}</span>, open the downloaded
                file, and tap <span className="font-semibold text-zinc-200">Update</span>. Your login
                and offline downloads stay intact.
              </>
            )}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <button
            onClick={handleUpdateNow}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-600/30 transition hover:from-violet-500 hover:to-indigo-500"
          >
            <Download className="h-4 w-4" />
            {downloadStarted ? t.downloadAgain : t.updateNow}
          </button>
          <button
            onClick={handleLater}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            {t.later}
          </button>
        </div>

        <div className="mt-4 text-center">
          <a
            href={update.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-violet-300"
          >
            <span>{t.openReleasePage}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
