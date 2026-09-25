import { sanitizeLook, type Look } from '../cosmetics';
import { load, save } from './storage';

// The player's chosen look, remembered in the browser (cloud saves and unlocks come in M4).

const KEY = 'hamball.look';

export function loadLook(): Look {
  try { return sanitizeLook(JSON.parse(load(KEY) ?? '{}')); } catch { return sanitizeLook({}); }
}

export function saveLook(look: Look) {
  save(KEY, JSON.stringify(look));
}
