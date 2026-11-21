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
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  // Computed pointer-events inherits from ancestors while honoring pointer-events-auto on the button itself
  const elStyle = window.getComputedStyle(el);
  if (elStyle.pointerEvents === 'none' || elStyle.visibility === 'hidden') return false;
  // Walk ancestors to ignore elements inside hidden overlays (opacity-0 / display: none)
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity || '1') < 0.05
    ) {
      return false;
    }
    cur = cur.parentElement;
  }
  return true;
}

export function moveTvFocus(direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): boolean {
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

  if (candidates.length === 0) return false;

  if (!active || !isVisible(active) || active === document.body || (playerMenu && !playerMenu.contains(active))) {
    const preferred =
      (root.querySelector('[data-tv-default-focus="true"]') as HTMLElement | null) || candidates[0];
    const target = preferred && isVisible(preferred) ? preferred : candidates[0];
    target.focus();
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    return true;
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
    return true;
  }
  return false;
}

export function initTvNavigation(): () => void {
  const onTv = isTizenTv();
  if (onTv) {
    document.documentElement.classList.add('tizen-tv');
  }

  // Register Samsung Tizen Smart TV remote media keys INDIVIDUALLY.
  // (Calling registerKeyBatch can fail completely on some TV models if any single key is unsupported!)
  const tizen = getTizen();
  if (tizen?.tvinputdevice?.registerKey) {
    const mediaKeys = [
      'MediaPlayPause',
      'MediaPlay',
      'MediaPause',
      'MediaStop',
      'MediaFastForward',
      'MediaRewind',
      'ColorF0Red',
      'ColorF1Green',
      'ColorF2Yellow',
      'ColorF3Blue',
    ];
    for (const key of mediaKeys) {
      try {
        tizen.tvinputdevice.registerKey(key);
      } catch {
        // Ignore unsupported key on this TV model
      }
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const isInput = Boolean(
      target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    );
    const inputType = isInput && target?.tagName === 'INPUT' ? (target as HTMLInputElement).type : '';
    const isRangeInput = inputType === 'range';

    // Samsung Tizen IME on-screen keyboard Done (65376) / Cancel (65385)
    if (isInput && (e.keyCode === 65376 || e.keyCode === 65385)) {
      e.preventDefault();
      target?.blur();
      if (e.keyCode === 65376) {
        moveTvFocus('ArrowDown');
      }
      return;
    }

    // Samsung Tizen Remote Back button (keyCode 10009)
    if (e.keyCode === 10009 || e.key === 'XF86Back' || e.key === 'GoBack') {
      e.preventDefault();
      e.stopImmediatePropagation();
      // If user is typing in a text field, Back dismisses the Samsung keyboard cleanly instead of exiting the page
      if (isInput && !isRangeInput) {
        target?.blur();
        return;
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }

    const isArrow =
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight';

    // Inside a text/password/search/range <input>:
    // - ArrowLeft / ArrowRight stays inside the input (cursor movement or timeline scrubbing),
    //   except ArrowRight at the very end of text/password/search lets you hop to adjacent icons (e.g. Show/Hide Password)
    // - ArrowUp / ArrowDown cleanly leaves the input and moves spatial focus so users NEVER get trapped!
    if (isInput) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (target?.tagName !== 'TEXTAREA' && target?.tagName !== 'SELECT') {
          e.preventDefault();
          const currentEl = target;
          const moved = moveTvFocus(e.key);
          if (!moved) {
            currentEl?.blur();
          }
          return;
        }
      }
      if (e.key === 'ArrowRight' && !isRangeInput && target?.tagName === 'INPUT') {
        const inputEl = target as HTMLInputElement;
        const atEnd =
          inputEl.selectionStart === null ||
          (inputEl.selectionStart === inputEl.value.length &&
            inputEl.selectionEnd === inputEl.value.length);
        if (atEnd) {
          if (moveTvFocus('ArrowRight')) {
            e.preventDefault();
            return;
          }
        }
      }
      return;
    }

    // Inside the fullscreen video player:
    // - When controls are HIDDEN (and no menu is open), let VideoPlayer handle the first D-pad press (wake HUD / seek)
    // - When controls ARE VISIBLE or a menu is open, enable full spatial D-pad navigation across ALL buttons!
    const playerEl = document.querySelector('[data-tv-player="true"]') as HTMLElement | null;
    const inPlayerMenu = Boolean(document.querySelector('[data-tv-player-menu="true"]'));
    if (playerEl && !inPlayerMenu) {
      const controlsVisible = playerEl.getAttribute('data-tv-controls-visible') === 'true';
      if (!controlsVisible) {
        return;
      }
    }

    if (isArrow) {
      e.preventDefault();
      moveTvFocus(e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
    }
  };

  window.addEventListener('keydown', onKeyDown, true);
  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    if (onTv) {
      document.documentElement.classList.remove('tizen-tv');
    }
  };
}
