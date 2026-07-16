# Acreline

Property intelligence, with receipts. Acreline imports bulk owner/property records, researches public sources, verifies contact points against the source page, scores identity confidence, and keeps a reviewable evidence trail.

## What is included

- A responsive Vinext/React workspace with real CSV, TSV and XLSX parsing, automatic column mapping, table search/filtering, evidence inspection and CSV export.
- Supabase passwordless authentication, private file storage, five owner-scoped application tables, twenty row-level-security policies, and four storage policies.
- A containerized Python enrichment worker using OpenAI Responses + web search for source discovery and Scrapling 0.4.8 for independent page verification.
- Cost controls: deterministic spreadsheet parsing, one short AI discovery call per uncached record, low search context, low reasoning effort, compact structured output, a 30-day fingerprint cache, bounded concurrency and token accounting.
- Safety controls: public-web-only URL validation, SSRF/private-network blocking, safe redirects, source provenance, confidence thresholds and human review states.

## Architecture

```text
Browser (publishable key)
  ├─ Supabase Auth
  ├─ Private Storage: imports/{user_id}/{dataset_id}/file
  └─ RLS-protected datasets, leads, sources and jobs
            │
            ▼
Server job route (verifies user JWT)
            │ shared secret
            ▼
Python worker
  ├─ OpenAI web search → candidate public sources
  ├─ URL policy → blocks private/unsafe targets
  ├─ Scrapling static fetcher → verifies page evidence
  └─ Supabase service role → writes results + provenance
```

## Local setup

1. Copy `.env.example` to `.env.local` and set the Supabase publishable values. The current local workspace is already connected; `.env.local` is ignored by Git.
2. Run `npm install`, then `npm run dev`.
3. For the worker, copy `enrichment-worker/.env.example` to `enrichment-worker/.env`, set a newly rotated OpenAI key and the Supabase service-role key, then build/run the Docker image.
4. Set `WORKER_URL` and the same `WORKER_SHARED_SECRET` in the web runtime.

The database definitions are saved under `supabase/migrations/` and have also been applied to the connected `ppre-tool` Supabase project.

## Scrapling audit decision

The integration is pinned to Scrapling `0.4.8`. Before integration, the tagged source and PyPI wheel were inspected without executing the package. The wheel's Python package matched the release source, its SHA-256 was recorded during the audit, the release commit is GitHub-verified, and no unexplained telemetry endpoint was found in the package code. Scrapling is a network automation library, so this is not a blanket guarantee of safety; Acreline deliberately uses only the static fetcher in an isolated worker and does not install or expose its browser/CDP features.

Always follow applicable privacy law, site terms and robots policies. Do not use Acreline for restricted, deceptive or sensitive-personal-data collection.
