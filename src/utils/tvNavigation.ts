// Spatial D-pad & Samsung SolarCell Remote navigation for Samsung Smart TV (Tizen) & Android TV

interface TizenGlobal {
  tvinputdevice?: {
    registerKeyBatch?: (keys: string[]) => void;
    registerKey?: (key: string) => void;
  };
  application?: {
    getCurrentApplication?: () => { exit?: () => void };
  };
}

function getTizen(): TizenGlobal | null {
  try {
    return (window as unknown as { tizen?: TizenGlobal }).tizen ?? null;
  } catch {
    return null;
  }
}

export function isTizenTv(): boolean {
  return Boolean(getTizen()) || /Tizen/i.test(navigator.userAgent);
}

export function exitTizenApp(): void {
  try {
    getTizen()?.application?.getCurrentApplication?.()?.exit?.();
  } catch {
    // Ignore outside Tizen
  }
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function moveFocus(direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') {
  const active = document.activeElement as HTMLElement | null;

  // Prefer open player menus (Subtitles / Audio / Quality), then modals, then full document
  const playerMenu = document.querySelector('[data-tv-player-menu="true"]') as HTMLElement | null;
  const activeOverlay = active?.closest('[data-tv-scope="modal"]') as HTMLElement | null;
  const root: ParentNode =
    playerMenu ||
    activeOverlay ||
    (document.querySelector('[data-tv-scope="modal"]') as HTMLElement | null) ||
    document;

  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el !== active && isVisible(el)
  );

  if (candidates.length === 0) return;

  if (!active || !isVisible(active) || active === document.body || (playerMenu && !playerMenu.contains(active))) {
    candidates[0].focus();
    candidates[0].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    return;
  }

  const from = active.getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const toX = rect.left + rect.width / 2;
    const toY = rect.top + rect.height / 2;
    const dx = toX - fromX;
    const dy = toY - fromY;

    if (direction === 'ArrowRight' && dx <= 8) continue;
    if (direction === 'ArrowLeft' && dx >= -8) continue;
    if (direction === 'ArrowDown' && dy <= 8) continue;
    if (direction === 'ArrowUp' && dy >= -8) continue;

    // Heavily prefer elements aligned along the travel axis
    const primary =
      direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(dx) : Math.abs(dy);
    const secondary =
      direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx);

    const score = primary + secondary * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (best) {
    best.focus();
    best.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}

export function initTvNavigation(): () => void {
  // Register Samsung Tizen Smart TV remote media keys (required on Tizen 4–8 including 2024 Q60D)
  const tizen = getTizen();
  if (tizen?.tvinputdevice) {
    const mediaKeys = [
      'MediaPlayPause',
      'MediaPlay',
      'MediaPause',
      'MediaStop',
      'MediaFastForward',
      'MediaRewind',
    ];
    try {
      if (tizen.tvinputdevice.registerKeyBatch) {
        tizen.tvinputdevice.registerKeyBatch(mediaKeys);
      } else if (tizen.tvinputdevice.registerKey) {
        for (const k of mediaKeys) tizen.tvinputdevice.registerKey(k);
      }
    } catch {
      // Ignore if running in browser emulator
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // Samsung Tizen Remote Back button (keyCode 10009) -> dispatch Escape
    if (e.keyCode === 10009 || e.key === 'XF86Back' || e.key === 'GoBack') {
      e.preventDefault();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }

    // Inside the fullscreen video player, allow D-pad navigation when Quality/Subtitle menu is open;
    // otherwise let VideoPlayer handle Left/Right (±10s seek) and media keys directly.
    const inPlayer = Boolean(document.querySelector('[data-tv-player="true"]'));
    const inPlayerMenu = Boolean(document.querySelector('[data-tv-player-menu="true"]'));
    if (inPlayer && !inPlayerMenu) return;

    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }

    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      e.preventDefault();
      moveFocus(e.key);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
