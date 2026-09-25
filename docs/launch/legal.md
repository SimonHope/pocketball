# Legal handoff (for the lawyer)

**Drafts:**
- `standalone/public/privacy.html`: privacy policy
- `standalone/public/terms.html`: terms

Both describe what the game actually does. Placeholders are in [brackets].

## What the game does with data (facts for the review)

- **No sign-up.** No email, name, age, birthday or location is collected. Player names are generated from fixed word lists; there's no free text anywhere (no chat).
- **Game account:**
  - A random token and recovery code in the browser. The server stores only SHA-256 hashes of both.
  - Stored with it: generated name, XP, coins, unlocks, best times and daily-challenge progress.
- **Anonymous stats** only after the player taps **OK** on a consent notice (changeable in Settings). They're tied to a random browser ID and cover gameplay events only (course start, finish or quit, match results, ad offers, graphics tier).
- **Error reports:** message, stack trace and page, with no ID.
- **IP addresses:** seen by the server while connected and used briefly in memory for rate limiting. They're not stored.
- **Purchases (own website only):**
  - Payment is handled by Stripe; we never see card data.
  - We store the pack and Stripe's reference, which are kept after deletion (with the account link removed) for tax purposes.
- **Ads:** only on portals, served by the portal's SDK (rewarded "double coins", opt-in, at most 5 a day). We run no ad or tracking SDKs on our own site.
- **Deletion:** Settings → "Delete my data" removes the account, progress and stats (server and browser).

## Questions to answer

1. **COPPA:** With no personal information collected (and persistent identifiers used only for internal operations and anonymous analytics), is this covered by the internal-operations exception? Is the consent notice needed or sufficient for under-13s?
2. **GDPR / UK GDPR / Age Appropriate Design Code:**
   - Is the analytics consent notice right?
   - Is the random browser ID personal data here?
   - Do the retention periods fit (`privacy.html`)?
   - Do we need a DPIA for a child-directed service?
3. **Consumer law for the Starter Pack:** refunds and withdrawal rights for digital content (EU 14-day rule), price display with tax, and whether children can buy (parental consent). Should the Shop be hidden for young players, or require an adult to complete Stripe Checkout?
4. **Portals:** each portal's own terms on ads, data and in-game purchases.
5. **Name:** the trademark search for the final name (from M0) before launch.

## Age rating

Most web portals ask for an IARC rating (free). Likely answers:
- Violence: none. Cartoon balls bumping; nobody gets hurt.
- Fear, language, drugs, gambling: none.
- Players interact online: yes, but without chat or free text, only racing and generated names.
- Shares location: no.
- In-game purchases: on our own website only; cosmetic.

A lawyer or producer should fill in the actual questionnaire.
