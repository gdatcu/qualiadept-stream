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

let cachedIsTizenTv: boolean | null = null;

export function isTizenTv(): boolean {
  if (cachedIsTizenTv === null) {
    cachedIsTizenTv = Boolean(getTizen()) || /Tizen/i.test(navigator.userAgent);
  }
  return cachedIsTizenTv;
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

/**
 * Per-navigation memoized visibility checker: avoids calling getComputedStyle()
 * thousands of times on shared ancestor containers during a single D-pad press.
 */
function createVisibilityChecker() {
  const ancestorCache = new WeakMap<HTMLElement, boolean>();

  const isAncestorVisible = (el: HTMLElement | null): boolean => {
    if (!el || el === document.body || el === document.documentElement) return true;
    const cached = ancestorCache.get(el);
    if (cached !== undefined) return cached;

    const style = window.getComputedStyle(el);
    const visible =
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity || '1') >= 0.05 &&
      isAncestorVisible(el.parentElement);

    ancestorCache.set(el, visible);
    return visible;
  };

  return (el: HTMLElement): boolean => {
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) {
      return false;
    }
    const elStyle = window.getComputedStyle(el);
    if (
      elStyle.pointerEvents === 'none' ||
      elStyle.visibility === 'hidden' ||
      elStyle.display === 'none' ||
      parseFloat(elStyle.opacity || '1') < 0.05
    ) {
      return false;
    }
    return isAncestorVisible(el.parentElement);
  };
}

function focusAndScrollIntoView(el: HTMLElement, horizontalOnly = false) {
  const onTv = isTizenTv();
  try {
    el.focus({ preventScroll: onTv });
  } catch {
    el.focus();
  }

  if (onTv) {
    // Fast direct scroll on horizontal row containers avoids stacked smooth-scroll frame drops on Tizen TV
    const row = el.closest('[data-tv-row]') as HTMLElement | null;
    if (row && row.scrollWidth > row.clientWidth) {
      const targetLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
      row.scrollLeft = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, targetLeft));
    }
    if (!horizontalOnly) {
      const modal = el.closest('[data-tv-scope="modal"]') as HTMLElement | null;
      if (modal && el.closest('[data-tv-modal-top="true"]')) {
        modal.scrollTop = 0;
        return;
      }
      if (!modal && (el.closest('[data-tv-hero="true"]') || el.closest('header'))) {
        window.scrollTo(0, 0);
        return;
      }
      el.scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'nearest',
      });
    }
    return;
  }

  el.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'nearest',
  });
}

function getVisibleFocusables(
  root: ParentNode,
  isVisible: (el: HTMLElement) => boolean
): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

export function moveTvFocus(direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): boolean {
  const active = document.activeElement as HTMLElement | null;
  const isVisible = createVisibilityChecker();

  // Prefer open player menus (Subtitles / Audio / Quality), then modals, then full document
  const playerMenu = document.querySelector('[data-tv-player-menu="true"]') as HTMLElement | null;
  const openModal = document.querySelector('[data-tv-scope="modal"]') as HTMLElement | null;
  const activeInModalScope = !openModal || Boolean(active && openModal.contains(active));

  // Ultra-fast horizontal path: stay inside the active [data-tv-row] without scanning the entire DOM!
  const currentRow =
    !playerMenu && activeInModalScope && active && active !== document.body
      ? (active.closest('[data-tv-row]') as HTMLElement | null)
      : null;

  if (currentRow && (direction === 'ArrowLeft' || direction === 'ArrowRight') && isVisible(active!)) {
    const rowItems = getVisibleFocusables(currentRow, isVisible);
    const idx = rowItems.indexOf(active!);
    if (idx !== -1) {
      const nextIdx = direction === 'ArrowRight' ? idx + 1 : idx - 1;
      if (nextIdx >= 0 && nextIdx < rowItems.length) {
        focusAndScrollIntoView(rowItems[nextIdx], true);
        return true;
      }
      // Stay cleanly at row edges on horizontal press inside a locked row
      return true;
    }
  }

  // Inside the VideoPlayer, Up/Down jumps cleanly between visible [data-tv-row] bands (top <-> center <-> timeline <-> bottom)
  if (currentRow && !playerMenu && (direction === 'ArrowUp' || direction === 'ArrowDown')) {
    const playerRoot = currentRow.closest('[data-tv-player="true"]') as HTMLElement | null;
    if (playerRoot) {
      const rowsWithRect = Array.from(playerRoot.querySelectorAll<HTMLElement>('[data-tv-row]'))
        .map((row) => ({ row, items: getVisibleFocusables(row, isVisible), top: row.getBoundingClientRect().top }))
        .filter((entry) => entry.items.length > 0)
        .sort((a, b) => a.top - b.top);
      const rowIdx = rowsWithRect.findIndex((r) => r.row === currentRow);
      if (rowIdx !== -1) {
        const targetRowIdx = direction === 'ArrowDown' ? rowIdx + 1 : rowIdx - 1;
        if (targetRowIdx >= 0 && targetRowIdx < rowsWithRect.length) {
          const targetItems = rowsWithRect[targetRowIdx].items;
          const activeRect = active!.getBoundingClientRect();
          const activeCenterX = activeRect.left + activeRect.width / 2;
          let closest = targetItems[0];
          let minDx = Infinity;
          for (const item of targetItems) {
            const rect = item.getBoundingClientRect();
            const dx = Math.abs(rect.left + rect.width / 2 - activeCenterX);
            if (dx < minDx) {
              minDx = dx;
              closest = item;
            }
          }
          focusAndScrollIntoView(closest);
          return true;
        }
        return true;
      }
    }
  }

  const activeOverlay = active?.closest('[data-tv-scope="modal"]') as HTMLElement | null;
  const root: ParentNode = playerMenu || activeOverlay || openModal || document;

  const allVisible = getVisibleFocusables(root, isVisible);
  if (allVisible.length === 0) return false;

  if (
    !active ||
    !isVisible(active) ||
    active === document.body ||
    !activeInModalScope ||
    (playerMenu && !playerMenu.contains(active))
  ) {
    const preferred =
      (root.querySelector('[data-tv-default-focus="true"]') as HTMLElement | null) || allVisible[0];
    const target = preferred && isVisible(preferred) ? preferred : allVisible[0];
    focusAndScrollIntoView(target);
    return true;
  }

  const from = active.getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < allVisible.length; i++) {
    const el = allVisible[i];
    if (el === active) continue;

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
    focusAndScrollIntoView(best);
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
