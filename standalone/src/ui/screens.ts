// Menu screens are plain HTML (see index.html). This shows one at a time, routes
// `data-action` clicks to handlers, and provides focus navigation for keyboard and gamepad.

export type ScreenId = 'loading' | 'menu' | 'levels' | 'pause' | 'results' | 'settings' | 'mp' | 'lobby' | 'mp-results' | 'customize' | 'leaderboard' | 'shop';
type Actions = Record<string, () => void>;

const FOCUSABLE = 'button:not([hidden]), input, select';

export class Screens {
  current: ScreenId | null = 'loading';
  private handlers: Partial<Record<ScreenId, Actions>> = {};

  constructor() {
    document.addEventListener('click', (e) => {
      const el = (e.target as Element).closest<HTMLElement>('[data-action]');
      const screen = el?.closest<HTMLElement>('.screen');
      if (!el || !screen) return;
      this.handlers[screen.id as ScreenId]?.[el.dataset.action!]?.();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.current) return;
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        this.moveFocus(e.code === 'ArrowDown' ? 1 : -1);
      } else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && document.activeElement instanceof HTMLSelectElement) {
        e.preventDefault();
        this.adjust(e.code === 'ArrowRight' ? 1 : -1);
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.back();
      }
    });
  }

  /** Registers click handlers for a screen's `data-action` buttons. `back` also runs on Esc / B. */
  on(screen: ScreenId, actions: Actions) {
    this.handlers[screen] = { ...this.handlers[screen], ...actions };
  }

  show(id: ScreenId | null) {
    this.current = id;
    for (const el of document.querySelectorAll<HTMLElement>('.screen')) el.classList.toggle('show', el.id === id);
    if (!id) {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    const first = this.focusables()[0];
    first?.focus({ preventScroll: true });
  }

  back() {
    const h = this.current && this.handlers[this.current];
    (h?.back ?? h?.resume)?.();
  }

  moveFocus(delta: number) {
    const items = this.focusables();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + delta + items.length) % items.length];
    next.focus({ preventScroll: false });
  }

  /** Left/right on the focused control: sliders step, dropdowns cycle, checkboxes toggle. */
  adjust(delta: number) {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const step = Number(el.step) || 1;
      el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + step * delta)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el instanceof HTMLSelectElement) {
      el.selectedIndex = (el.selectedIndex + delta + el.options.length) % el.options.length;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      el.click();
    } else {
      this.moveFocus(delta);
    }
  }

  /** Gamepad A: press the focused control. */
  activate() {
    const el = document.activeElement;
    if (el instanceof HTMLButtonElement || (el instanceof HTMLInputElement && el.type === 'checkbox')) el.click();
  }

  private focusables(): HTMLElement[] {
    if (!this.current) return [];
    const root = document.getElementById(this.current);
    return root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null) : [];
  }
}
