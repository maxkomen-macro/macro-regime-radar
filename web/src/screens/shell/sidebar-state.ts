/**
 * Collapsible sidebar state (Iteration 1, S3). The second per-visitor
 * preference kept in the browser, beside the watchlist: a localStorage
 * document `{ version: 1, collapsed: boolean }` under `mrr.sidebar.v1`.
 * Missing or corrupt data reads as expanded; a storage that throws on read or
 * write (private mode, blocked storage) keeps the state in memory. Every
 * storage access is wrapped, as in watchlist/storage.ts.
 *
 * Also here: the Ctrl+\ / ⌘+\ shortcut test and its platform label, shared
 * by AppShell (the key handler), the toggle's title and the palette entry.
 */

import { useCallback, useState } from "react";
import { localStorageOrNull } from "./watchlist/storage";

export const SIDEBAR_KEY = "mrr.sidebar.v1";

export interface SidebarFile {
  version: 1;
  collapsed: boolean;
}

/** `null` (first visit), malformed JSON, an unknown version or a non-boolean
 * `collapsed` all read as expanded. */
export function parseSidebar(raw: string | null): boolean {
  if (raw == null) return false;
  try {
    const doc: unknown = JSON.parse(raw);
    if (doc == null || typeof doc !== "object" || Array.isArray(doc)) return false;
    const file = doc as { version?: unknown; collapsed?: unknown };
    return file.version === 1 && file.collapsed === true;
  } catch {
    return false;
  }
}

export function serializeSidebar(collapsed: boolean): string {
  const file: SidebarFile = { version: 1, collapsed };
  return JSON.stringify(file);
}

/** Read and validate; a storage that throws reads as expanded. */
export function readSidebarCollapsed(storage: Pick<Storage, "getItem"> | null = localStorageOrNull()): boolean {
  if (!storage) return false;
  try {
    return parseSidebar(storage.getItem(SIDEBAR_KEY));
  } catch {
    return false;
  }
}

/** False when the write is refused (quota, private mode, SecurityError). Never throws. */
export function writeSidebarCollapsed(collapsed: boolean, storage: Pick<Storage, "setItem"> | null = localStorageOrNull()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SIDEBAR_KEY, serializeSidebar(collapsed));
    return true;
  } catch {
    return false;
  }
}

/** [collapsed, toggle]. The state always changes in memory; the write is best effort. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => readSidebarCollapsed());
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      writeSidebarCollapsed(!c);
      return !c;
    });
  }, []);
  return [collapsed, toggle];
}

/* ── Shortcut ────────────────────────────────────────────────────────────── */

/** True on macOS and iOS, where the shortcut reads ⌘\. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** "⌘\" on a Mac, "Ctrl+\" elsewhere. */
export function sidebarShortcutLabel(mac: boolean = isMacPlatform()): string {
  return mac ? "⌘\\" : "Ctrl+\\";
}

/** Ctrl+\ or ⌘+\ (the key, not the code, so every layout that types a
 * backslash works). */
export function isSidebarShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">): boolean {
  return (e.ctrlKey || e.metaKey) && e.key === "\\";
}

/** Focus sits where a backslash is text: the shortcut stays out of the way. */
export function isEditableTarget(el: EventTarget | Element | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.closest("[contenteditable]:not([contenteditable='false'])") != null;
}
