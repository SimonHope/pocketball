import { createHmac, timingSafeEqual } from 'node:crypto';
import { SKUS } from '../../src/cosmetics';

// Stripe Checkout over its REST API (no SDK needed). The shop is only active when
// STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set.

export async function createCheckout(opts: {
  secretKey: string; sku: string; accountId: string; successUrl: string; cancelUrl: string;
}): Promise<string> {
  const pack = SKUS[opts.sku];
  if (!pack) throw new Error('unknown pack');
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': pack.currency,
    'line_items[0][price_data][unit_amount]': String(pack.priceCents),
    'line_items[0][price_data][product_data][name]': `Pocket Ball — ${pack.label}`,
    client_reference_id: opts.accountId,
    'metadata[sku]': opts.sku,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !json.url) throw new Error(json.error?.message ?? `Stripe error ${res.status}`);
  return json.url;
}

/**
 * Checks a webhook's `Stripe-Signature` header (t=…,v1=…): an HMAC-SHA256 of "t.body" with the
 * endpoint secret, and a timestamp within 5 minutes (stops replays). Returns the event or null.
 */
export function verifyWebhook(rawBody: string, header: unknown, secret: string, nowMs = Date.now(), toleranceS = 300): StripeEvent | null {
  if (typeof header !== 'string') return null;
  const parts = header.split(',').map((kv) => kv.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowMs / 1000 - t) > toleranceS) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
  const ok = sigs.some((s) => {
    const got = Buffer.from(s);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) return null;
  try { return JSON.parse(rawBody) as StripeEvent; } catch { return null; }
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id: string; client_reference_id?: string; payment_status?: string; metadata?: Record<string, string> } };
}
