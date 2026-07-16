import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("https://acreline.example/", { headers: { accept: "text/html", host: "acreline.example", "x-forwarded-proto": "https" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Acreline welcome screen and social metadata without fake records", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Acreline — Property intelligence, with receipts<\/title>/i);
  assert.match(html, /Turn bulk owner records into verified, source-backed property intelligence/);
  assert.match(html, /Turn raw records into/);
  assert.match(html, /Continue with Google|Restoring your workspace/);
  assert.match(html, /Research pipeline/);
  assert.doesNotMatch(html, /Toronto owner portfolio|Avery Morgan|Owner records/);
  assert.match(html, /https:\/\/acreline\.example\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("starter preview is fully removed and product capabilities are present", async () => {
  const [page, workspace, layout, packageJson, envExample, security] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../SECURITY.md", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<Workspace \/>/);
  assert.match(workspace, /parseDataset/);
  assert.match(workspace, /exportCsv/);
  assert.match(layout, /generateMetadata/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_OPENAI|OPENAI_API_KEY/);
  assert.match(workspace, /signInWithOAuth/);
  assert.match(security, /private-network blocking|private\/reserved networks/i);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../supabase/migrations/20260716171500_initial_acreline_schema.sql", import.meta.url));
  await access(new URL("../enrichment-worker/acreline_worker/main.py", import.meta.url));
  await access(new URL("README.md", root));
});
