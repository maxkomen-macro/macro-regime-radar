/**
 * Stale chunks after a deploy (launch-1, item 3). The screens are code-split,
 * and a tab opened before a deploy still asks for the old content-hashed
 * chunks, which the new deploy no longer has (vercel.json answers a 404 for a
 * missing /assets/ file). Vite reports that as `vite:preloadError`; the page
 * reloads once to pick up the new shell. At most once a minute, so a deploy
 * that is itself broken cannot put the tab in a reload loop.
 */
const KEY = "mrr:stale-chunk-reload-at";
const ONCE_PER_MS = 60_000;

export function installStaleChunkReload(win: Window = window, now: () => number = Date.now): void {
  win.addEventListener("vite:preloadError", (event: Event) => {
    let last = 0;
    try {
      last = Number(win.sessionStorage.getItem(KEY) ?? 0) || 0;
    } catch {
      last = 0;
    }
    const t = now();
    if (t - last < ONCE_PER_MS) return;
    try {
      win.sessionStorage.setItem(KEY, String(t));
    } catch {
      // storage blocked: reload anyway; the browser's own cache stops a loop
    }
    event.preventDefault();
    win.location.reload();
  });
}
