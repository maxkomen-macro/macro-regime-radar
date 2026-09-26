/**
 * Saving a served file (Event Study's Export, Data Pipeline's CSV and DDL):
 * fetch it, check it is the type asked for, and hand it to the browser as a
 * download. A non-OK answer, another type (a JSON error answered 200) or no
 * answer within 15 seconds rejects, so the caller says nothing was saved.
 */

export async function saveServed(url: string, accept: "text/csv" | "text/plain", name: string, timeoutMs = 15_000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: accept }, signal: ctl.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith(accept)) throw new Error(`type ${type || "none"}`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([await res.text()], { type: accept }));
    a.download = name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return name;
  } finally {
    clearTimeout(timer);
  }
}
