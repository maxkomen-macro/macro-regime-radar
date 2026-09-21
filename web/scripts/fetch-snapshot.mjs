/**
 * web/scripts/fetch-snapshot.mjs — put the last validated snapshot in the bundle.
 *
 * The site paints from `public/snapshot/latest.json` before the first API call
 * answers, and falls back to it when the API is unreachable. The file is
 * gitignored (it is data, not source), so a build from a git checkout has none
 * unless it fetches one: that is what this does, from the private repo's
 * `data-latest` release, with a read-only token.
 *
 * Run by the Vercel build command (web/vercel.json) ahead of `vite build`, and
 * usable locally:  GH_SNAPSHOT_TOKEN=… node scripts/fetch-snapshot.mjs
 *
 * Without a token it leaves any existing file alone and exits 0: a build must
 * not fail because the fallback could not be refreshed, and the site works
 * without it as long as the API answers.
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO = process.env.SNAPSHOT_REPO ?? "maxkomen-macro/macro-regime-radar";
const TAG = process.env.SNAPSHOT_TAG ?? "data-latest";
const ASSET = process.env.SNAPSHOT_ASSET ?? "snapshot-latest.json";
const OUT_DIR = join(process.cwd(), "public", "snapshot");
const OUT = join(OUT_DIR, "latest.json");
const token = process.env.GH_SNAPSHOT_TOKEN ?? process.env.GH_TOKEN ?? "";

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "macro-regime-radar-build",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function existing() {
  try {
    const s = await stat(OUT);
    return s.size;
  } catch {
    return 0;
  }
}

function fail(reason) {
  // Never fail the build: the bundle is still correct, it just starts without
  // a pre-seeded snapshot.
  console.warn(`[snapshot] ${reason} — building without a refreshed snapshot`);
  process.exit(0);
}

const had = await existing();
if (!token) fail(had ? `no GH_SNAPSHOT_TOKEN; keeping the ${had}-byte file already in public/snapshot` : "no GH_SNAPSHOT_TOKEN");

const relUrl = `https://api.github.com/repos/${REPO}/releases/tags/${TAG}`;
const rel = await fetch(relUrl, { headers }).catch((e) => fail(`release lookup failed (${e.name})`));
if (!rel.ok) fail(`release lookup answered ${rel.status}`);
const meta = await rel.json();
const asset = (meta.assets ?? []).find((a) => a.name === ASSET);
if (!asset) fail(`release ${TAG} carries no ${ASSET}`);

const dl = await fetch(asset.url, { headers: { ...headers, Accept: "application/octet-stream" } }).catch((e) =>
  fail(`download failed (${e.name})`),
);
if (!dl.ok) fail(`download answered ${dl.status}`);
const text = await dl.text();

let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  fail("the downloaded snapshot is not JSON");
}
if (!parsed?.entries || !parsed?.generated_at) fail("the downloaded snapshot has no entries");

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, text);
console.log(
  `[snapshot] ${ASSET} → public/snapshot/latest.json (${text.length} bytes, generated ${parsed.generated_at}, ` +
    `${Object.keys(parsed.entries).length} entries)`,
);
