/**
 * Where each live item is: §1.0.1's "Live" list doubles as the Desk's guide to what is available and
 * where, so each item's page name (the words before its first colon) links to that page. The item's
 * words stay §1.0.1's, word for word; only the name becomes a link. A name is matched to a listed Desk
 * page by its title or nav label (desk-sections.ts), so an unlisted page (the Options Finder) never gets
 * a link here, and a renamed page fails BuildNotesPage.test.tsx instead of linking nowhere. The Client
 * view is the Desk's other view, not a page: it opens on the Event Study, where the current study is.
 */

import { DESK_PAGES } from "../desk-sections";
import { withView } from "../desk-view";

/** The Client view's item opens the Event Study in the client view. */
export const CLIENT_VIEW_NAME = "Client view";
export const CLIENT_VIEW_SLUG = "event-study";

export interface ScopeLink {
  /** The item's page name, the link's text: the words before its first colon. */
  name: string;
  /** The rest of the item, from the colon on, printed after the link unchanged. */
  rest: string;
  /** The Desk page's slug. */
  slug: string;
  /** True for the Client view's item, whose link opens the page in the client view. */
  client: boolean;
}

/** Pure: an item's page link, or null when its name is no listed Desk page. */
export function scopeLink(item: string): ScopeLink | null {
  const at = item.indexOf(":");
  if (at <= 0) return null;
  const name = item.slice(0, at);
  const rest = item.slice(at);
  if (name === CLIENT_VIEW_NAME) return { name, rest, slug: CLIENT_VIEW_SLUG, client: true };
  const page = DESK_PAGES.find((p) => (p.title ?? p.label) === name || p.label === name);
  return page ? { name, rest, slug: page.slug, client: false } : null;
}

/** Pure: the link's address. A page link carries the reader's current view; the Client view's opens the client view. */
export function scopeHref(link: ScopeLink, pathTo: (slug: string) => string): string {
  return link.client ? withView(`/desk/${link.slug}`, "client") : pathTo(link.slug);
}
