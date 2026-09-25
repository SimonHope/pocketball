import type { Category, Look } from '../cosmetics';
import { API_URL } from '../net/endpoints';
import type { BallUpdate } from '../net/protocol';
import { load, save } from '../render/storage';
import type { Leaderboard, Profile, SoloResult } from './api';

// The player's account in the browser: a guest token (+ recovery code) in localStorage and
// the profile from the server. Everything degrades gracefully offline: the game still plays,
// progress just isn't saved.

const TOKEN_KEY = 'hamball.token';
const RECOVERY_KEY = 'hamball.recovery';

export class Account {
  profile: Profile | null = null;
  private listeners: ((p: Profile | null) => void)[] = [];

  get token(): string | null { return load(TOKEN_KEY); }
  get recoveryCode(): string | null { return load(RECOVERY_KEY); }
  get online(): boolean { return this.profile !== null; }

  /** Sign in with the saved token, or create a guest account. Never throws. */
  async init(name?: string): Promise<Profile | null> {
    try {
      if (this.token) {
        const me = await this.call<Profile>('/me');
        if (me.ok) return this.set(me.data);
        if (me.status !== 401) return this.set(null);
      }
      const guest = await this.call<{ token: string; recoveryCode: string; profile: Profile }>('/guest', { name });
      if (!guest.ok) return this.set(null);
      save(TOKEN_KEY, guest.data.token);
      save(RECOVERY_KEY, guest.data.recoveryCode);
      return this.set(guest.data.profile);
    } catch {
      return this.set(null);
    }
  }

  subscribe(fn: (p: Profile | null) => void) {
    this.listeners.push(fn);
    fn(this.profile);
  }

  private set(p: Profile | null): Profile | null {
    this.profile = p;
    for (const fn of this.listeners) fn(p);
    return p;
  }

  /** JSON request to the API; never throws for HTTP errors. */
  async call<T>(path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: (data as { error?: string }).error ?? `Error ${res.status}` };
      return { ok: true, data: data as T };
    } catch {
      return { ok: false, status: 0, error: 'Offline — progress isn\'t being saved.' };
    }
  }

  async refresh() {
    const me = await this.call<Profile>('/me');
    if (me.ok) this.set(me.data);
  }

  async equip(look: Look) {
    const r = await this.call<Profile>('/me/look', { look });
    if (r.ok) this.set(r.data);
  }

  async rename(name: string) {
    const r = await this.call<Profile>('/me/name', { name });
    if (r.ok) this.set(r.data);
  }

  async buy(cat: Category, index: number): Promise<string | null> {
    const r = await this.call<Profile>('/me/buy', { cat, index });
    if (!r.ok) return r.error;
    this.set(r.data);
    return null;
  }

  async submitSolo(level: string, trace: BallUpdate[]): Promise<SoloResult | { error: string }> {
    const r = await this.call<{ result: SoloResult; profile: Profile }>('/solo', { level, trace });
    if (!r.ok) return { error: r.error };
    this.set(r.data.profile);
    return r.data.result;
  }

  async adDouble(claimId: string): Promise<number | string> {
    const r = await this.call<{ coins: number; profile: Profile }>('/rewards/ad-double', { claimId });
    if (!r.ok) return r.error;
    this.set(r.data.profile);
    return r.data.coins;
  }

  async leaderboard(level: string): Promise<Leaderboard | null> {
    const r = await this.call<Leaderboard>(`/leaderboard/${level}`);
    return r.ok ? r.data : null;
  }

  /** "Delete my data": the account (if any) and this browser's anonymous stats. */
  async deleteEverything(anonId: string): Promise<string | null> {
    const r = await this.call<{ deleted: boolean }>('/me/delete', { anonId });
    if (!r.ok) return r.error;
    save(TOKEN_KEY, '');
    save(RECOVERY_KEY, '');
    this.set(null);
    return null;
  }

  /** Move progress to this device. */
  async restore(code: string): Promise<string | null> {
    const r = await this.call<{ token: string; profile: Profile }>('/restore', { code });
    if (!r.ok) return r.status === 404 ? 'No account with that code.' : r.error;
    save(TOKEN_KEY, r.data.token);
    save(RECOVERY_KEY, code.toUpperCase());
    this.set(r.data.profile);
    return null;
  }

  /** Real-money pack: returns a checkout URL to go to, or null if granted straight away (dev). */
  async checkout(sku: string): Promise<{ url?: string; error?: string }> {
    const r = await this.call<{ url?: string; granted?: boolean; profile?: Profile }>('/shop/checkout', { sku });
    if (!r.ok) return { error: r.error };
    if (r.data.profile) this.set(r.data.profile);
    return { url: r.data.url };
  }
}
