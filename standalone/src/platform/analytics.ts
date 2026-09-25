import { API_URL } from '../net/endpoints';
import { load, save } from '../render/storage';

// Anonymous analytics and error reports: a random id per browser, no personal data.
// Events are batched and sent every 10 s and when the page is hidden.
// Report: npm run analytics (retention, session length, where players quit).

const ANON_KEY = 'hamball.anon';

export function forgetAnonId() {
  save(ANON_KEY, '');
}

function anonId(): string {
  let id = load(ANON_KEY);
  if (!id) {
    id = crypto.randomUUID();
    save(ANON_KEY, id);
  }
  return id;
}

export class Analytics {
  /** Stats are only sent with the player's consent; error reports (no id) always are. */
  enabled = false;
  private queue: { name: string; t: number; props?: Record<string, unknown> }[] = [];
  private readonly session = crypto.randomUUID();
  private readonly anon = anonId();
  private errorsSent = 0;

  constructor() {
    setInterval(() => this.flush(), 10_000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(true); });
    window.addEventListener('error', (e) => this.error(e.message, e.error?.stack));
    window.addEventListener('unhandledrejection', (e) => this.error(String(e.reason?.message ?? e.reason), e.reason?.stack));
  }

  get anonymousId(): string {
    return this.anon;
  }

  track(name: string, props?: Record<string, unknown>) {
    if (!this.enabled) return;
    this.queue.push({ name, t: Date.now(), props });
    if (this.queue.length >= 50) this.flush();
  }

  private flush(leaving = false) {
    if (!this.queue.length || !this.enabled) return;
    const body = JSON.stringify({ anonId: this.anon, session: this.session, events: this.queue.splice(0) });
    if (leaving && navigator.sendBeacon) navigator.sendBeacon(`${API_URL}/events`, new Blob([body], { type: 'application/json' }));
    else void fetch(`${API_URL}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  /** Send crash reports to our server (off in the single-player build: there is no server). */
  reportErrors = true;

  private error(message: string, stack?: string) {
    if (!this.reportErrors || this.errorsSent++ >= 10) return; // don't flood on a broken loop
    void fetch(`${API_URL}/errors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack: stack ?? '', url: location.pathname }),
    }).catch(() => {});
  }
}
