# Security policy

## Data boundary

Acreline is designed for lawful research of public, professional contact information. It must not be used to obtain credentials, private account data, sensitive personal data, or information behind authentication barriers.

## Architecture controls

- Browser clients receive only the Supabase publishable key. Service-role and OpenAI keys are worker-only secrets.
- Every application table has row-level security and owner-scoped policies.
- Import files are stored in a private bucket under the authenticated user's ID.
- The worker accepts only authenticated server-to-server job triggers.
- Scraping accepts HTTP(S) on standard ports only, resolves DNS before access, blocks private/reserved networks, rejects credential-bearing URLs, and uses Scrapling's safe redirect mode.
- The integration uses Scrapling's static fetcher. Remote browser/CDP control, local Chrome profiles, stealth browsing, and automatic browser downloads are not enabled.
- Results retain source URLs, evidence snippets, capture time, and confidence. Ambiguous identities are routed to review.

## Secret handling

Never commit `.env` files. Rotate a key immediately if it appears in a chat, log, issue, screenshot, or commit. Use a platform secret manager in production.

## Reporting

Report vulnerabilities privately to the repository owner. Do not include live personal data or credentials in a report.
