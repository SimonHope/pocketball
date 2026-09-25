import express, { type NextFunction, type Request, type Response } from 'express';
import { findLevel } from '../../src/levels';
import type { MetaService } from './service';
import { createCheckout, verifyWebhook } from './stripe';

// The account API: /api/... on the game server. Tokens travel in the Authorization header
// (no cookies), so any origin may call it.

export interface ApiOptions {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  /** Grant packs instantly without payment (local testing only). */
  shopDev?: boolean;
  /** Where the game is served, for Stripe's return links. */
  publicUrl?: string;
  /** New guest accounts per IP per minute (default 10; the browser tests create more). */
  guestsPerMinute?: number;
}

type AuthedRequest = Request & { accountId?: string };

/** Small fixed-window rate limit per IP (in memory; fine for one server process). */
function rateLimit(perMinute: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now > h.reset) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > perMinute) return res.status(429).json({ error: 'slow down' });
    next();
  };
}

export function apiRouter(meta: MetaService, opts: ApiOptions = {}) {
  const r = express.Router();

  r.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Stripe needs the exact raw body to check its signature, so this comes before json().
  r.post('/shop/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    if (!opts.stripeWebhookSecret) return res.sendStatus(404);
    const event = verifyWebhook(req.body.toString('utf8'), req.header('stripe-signature'), opts.stripeWebhookSecret);
    if (!event) return res.status(400).json({ error: 'bad signature' });
    const s = event.data.object;
    if (event.type === 'checkout.session.completed' && s.payment_status === 'paid' && s.client_reference_id && s.metadata?.sku) {
      meta.grantSku(s.client_reference_id, s.metadata.sku, s.id);
    }
    res.json({ received: true });
  });

  r.use(express.json({ limit: '1mb' }));

  const auth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const id = meta.authenticate(token);
    if (!id) return res.status(401).json({ error: 'sign in again' });
    req.accountId = id;
    next();
  };

  r.get('/health', (_req, res) => { res.json({ ok: true }); });

  r.post('/guest', rateLimit(opts.guestsPerMinute ?? 10), (req, res) => {
    const g = meta.createGuest(req.body?.name);
    res.json({ token: g.token, recoveryCode: g.recoveryCode, profile: meta.profile(g.accountId) });
  });

  r.post('/restore', rateLimit(10), (req, res) => {
    const found = meta.restore(req.body?.code);
    if (!found) return res.status(404).json({ error: 'no account with that code' });
    res.json({ token: found.token, profile: meta.profile(found.accountId) });
  });

  r.get('/me', auth, (req: AuthedRequest, res) => { res.json(meta.profile(req.accountId!)); });

  // Right to erasure: works with or without an account (anonymous stats only).
  r.post('/me/delete', rateLimit(10), (req, res) => {
    const id = meta.authenticate(req.header('authorization')?.replace(/^Bearer\s+/i, ''));
    meta.deleteAccount(id, req.body?.anonId);
    res.json({ deleted: true });
  });

  r.post('/me/look', auth, (req: AuthedRequest, res) => {
    meta.setLook(req.accountId!, req.body?.look);
    res.json(meta.profile(req.accountId!));
  });

  r.post('/me/name', auth, (req: AuthedRequest, res) => {
    if (!meta.setName(req.accountId!, req.body?.name)) return res.status(400).json({ error: 'names come from the name generator' });
    res.json(meta.profile(req.accountId!));
  });

  r.post('/me/buy', auth, (req: AuthedRequest, res) => {
    const result = meta.buy(req.accountId!, req.body?.cat, req.body?.index);
    if (!result.ok) return res.status(400).json(result);
    res.json(meta.profile(req.accountId!));
  });

  r.post('/solo', auth, rateLimit(30), (req: AuthedRequest, res) => {
    const result = meta.recordSolo(req.accountId!, req.body?.level, req.body?.trace);
    if ('error' in result) return res.status(400).json(result);
    res.json({ result, profile: meta.profile(req.accountId!) });
  });

  r.post('/rewards/ad-double', auth, (req: AuthedRequest, res) => {
    const result = meta.adDouble(req.accountId!, req.body?.claimId);
    if (!result.ok) return res.status(400).json(result);
    res.json({ coins: result.coins, profile: meta.profile(req.accountId!) });
  });

  r.get('/leaderboard/:level', (req, res) => {
    if (!findLevel(req.params.level)) return res.status(404).json({ error: 'unknown course' });
    const id = meta.authenticate(req.header('authorization')?.replace(/^Bearer\s+/i, ''));
    res.json(meta.leaderboard(req.params.level, id));
  });

  r.post('/shop/checkout', auth, async (req: AuthedRequest, res) => {
    const sku = String(req.body?.sku ?? '');
    if (opts.shopDev) {
      meta.grantSku(req.accountId!, sku, `dev-${Date.now()}`);
      return res.json({ granted: true, profile: meta.profile(req.accountId!) });
    }
    if (!opts.stripeSecretKey || !opts.stripeWebhookSecret) return res.status(503).json({ error: 'The shop is not open yet.' });
    try {
      const base = opts.publicUrl ?? 'http://localhost:5173';
      const url = await createCheckout({
        secretKey: opts.stripeSecretKey, sku, accountId: req.accountId!,
        successUrl: `${base}/?purchase=success`, cancelUrl: `${base}/?purchase=cancelled`,
      });
      res.json({ url });
    } catch (e) {
      res.status(502).json({ error: String((e as Error).message) });
    }
  });

  // Analytics and error reports: anonymous (a random id per browser), no personal data.
  r.post('/events', rateLimit(60), (req, res) => {
    res.json({ stored: meta.logEvents(req.body?.anonId, req.body?.session, req.body?.events) });
  });
  r.post('/errors', rateLimit(30), (req, res) => {
    meta.logError(req.body?.message, req.body?.stack, req.body?.url);
    res.json({ ok: true });
  });

  return r;
}
