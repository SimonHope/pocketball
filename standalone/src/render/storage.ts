// Browser storage keys keep the game's original 'hamball.' prefix on purpose: renaming them
// would wipe everyone's saved best times, settings and look. Players never see them.
/** The level being edited; the game playtests it with `?play=draft`. */
export const DRAFT_KEY = 'hamball.editor.draft';

// localStorage can throw (private mode, blocked storage), so every access is guarded.

export function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
