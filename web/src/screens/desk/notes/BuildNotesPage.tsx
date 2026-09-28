/**
 * Build Notes (DESK_FRAME3_SPEC §11, screens/11-build-notes.png): the page
 * renders docs/desk/BUILD_NOTES.md, nothing hardcoded but the byline §11
 * names, the line saying where the text comes from, the section "How this
 * was built" (./built.ts, after the file's "Prototypes, and how I would
 * build them"; the file's copy of it is not printed twice) and §1.0.1's
 * section "Live / Designed, not yet served" (./scope.ts), word for word. The
 * contents list is the file's own `##` sections and that section; the
 * article is the file's title, lead and sections through the app's Markdown
 * renderer, with its tables and its figures (an image whose path is a file
 * in docs/desk/screens/ of this build; else the figure is named in words).
 * A sentence using one of the two words the Desk never prints is held with
 * a marker (./notes.ts).
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import Markdown from "../../shell/Markdown";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { readNotes } from "./notes";
import { BUILT_AFTER, BUILT_ID, BUILT_PARAGRAPHS, BUILT_TITLE } from "./built";
import { SCOPE_LISTS, SCOPE_TITLE } from "./scope";
import "./notes.css";

/** The notes file, read at build time. A build context that holds only web/
 * (the Docker image) finds no file and the page says so; it never fails the build. */
const FILES = import.meta.glob<string>("../../../../../docs/desk/BUILD_NOTES.md", { query: "?raw", import: "default", eager: true });
export const NOTES_MD: string = Object.values(FILES)[0] ?? "";

/** The notes' figures: the SVGs beside the mockups in docs/desk/screens/, as this build ships them. */
const FIGURES = import.meta.glob<string>("../../../../../docs/desk/screens/*.svg", { query: "?url", import: "default", eager: true });

/** A figure's path in the notes (`screens/<name>.svg`, relative to docs/desk/) as its URL in this build, or null. */
export function figureUrl(src: string, figures: Record<string, string> = FIGURES): string | null {
  const m = /^(?:\.\/)?screens\/([\w.-]+\.svg)$/.exec(src);
  if (!m) return null;
  const hit = Object.entries(figures).find(([path]) => path.endsWith(`/screens/${m[1]}`));
  return hit ? hit[1] : null;
}

/** The file's lead without a paragraph that only repeats §11's byline, which the page prints itself. */
export function leadWithoutByline(lead: string): string {
  return lead
    .split(/\n\s*\n/)
    .filter((para) => para.trim() !== BYLINE)
    .join("\n\n")
    .trim();
}

/** §1.0.1's section's id: outside the file sections' `bn-…` namespace. */
export const SCOPE_ID = "bnx-scope";

/** §11's byline. */
export const BYLINE = "Max Komen · September 2026";

/** At the top of the page a section is being read once its top is this far
 * or less below the top of the window. */
const READ_LINE = 120;

/** A `#…` fragment as a section id; a malformed escape is no section. */
function fragment(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

/** The section being read, from the sections' positions: the last one whose
 * top has passed the read line. Over the last screen of scroll the line
 * moves down to the foot of the window, so every section is marked on the
 * way down, the last at the foot. A jump (a click, `#…` on arrival, a
 * same-page `#…`) keeps its mark while the section is on screen, until the
 * reader scrolls by wheel, touch or key. */
function useReading(ids: string[], hash: string) {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const jumped = useRef<string | null>(null);
  const jump = (id: string) => {
    jumped.current = id;
    setActive(id);
  };
  const key = ids.join("|");
  useEffect(() => {
    let raf = 0;
    const pick = () => {
      raf = 0;
      const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
      if (!els.length) return;
      const vh = window.innerHeight;
      const j = jumped.current ? document.getElementById(jumped.current) : null;
      if (j) {
        const top = j.getBoundingClientRect().top;
        if (top >= -2 && top < vh) return setActive(j.id);
        jumped.current = null;
      }
      const max = document.documentElement.scrollHeight - vh;
      const span = Math.min(vh, max);
      const left = max - window.scrollY;
      const line = span > 0 && left < span ? READ_LINE + (1 - left / span) * (vh - READ_LINE) : READ_LINE;
      let cur = els[0].id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) cur = el.id;
      setActive(cur);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(pick);
    };
    // A scroll the reader starts ends a jump's hold on the mark.
    const release = () => {
      jumped.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) release();
    };
    // A same-page #section (typed, or back and forward) is a jump the browser scrolled itself.
    const onHash = () => {
      const t = fragment(window.location.hash);
      if (ids.includes(t)) jump(t);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    const target = fragment(hash);
    if (target && ids.includes(target)) {
      document.getElementById(target)?.scrollIntoView?.();
      jump(target);
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
      if (raf) cancelAnimationFrame(raf);
    };
    // The hash is read on arrival; later jumps come through `jump` and hashchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { active, jump };
}

/** The article's sections in order: the file's (its own copy of "How this was built" left out), the page's
 * "How this was built" after "Prototypes, and how I would build them" (else after the file's last), then §1.0.1's. */
export function sectionOrder(fileSections: readonly { id: string; title: string }[]): { id: string; title: string; built?: true }[] {
  const file = fileSections.filter((s) => s.title !== BUILT_TITLE);
  const built = { id: BUILT_ID, title: BUILT_TITLE, built: true as const };
  const at = file.findIndex((s) => s.title === BUILT_AFTER);
  return at >= 0 ? [...file.slice(0, at + 1), built, ...file.slice(at + 1)] : [...file, built];
}

export function BuildNotesView({ page, md }: { page: DeskPage; md: string }) {
  const notes = readNotes(md);
  const { hash } = useLocation();
  const order = sectionOrder(notes.sections);
  const byId = new Map(notes.sections.map((s) => [s.id, s]));
  const toc = [...order.map((s) => ({ id: s.id, title: s.title })), { id: SCOPE_ID, title: SCOPE_TITLE }];
  const { active, jump } = useReading(
    toc.map((s) => s.id),
    hash,
  );
  const missing = !md.trim();
  return (
    <div className="bn">
      <PageTitle page={page} />
      <div className="bn-grid">
        <aside className="bn-side">
          <nav aria-label="Contents">
            <ul className="bn-toc">
              {toc.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} aria-current={active === s.id ? "location" : undefined} onClick={() => jump(s.id)}>
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {missing ? null : <p className="bn-source">Rendered from docs/desk/BUILD_NOTES.md · same file in the repo</p>}
        </aside>
        {/* Fixed ids sit outside the sections' `bn-…` namespace, and a heading's id ends in `--h`,
            which no section slug can: a section titled "Title" never takes the card's id. */}
        <article className="dk-card bn-card" aria-labelledby="bnx-title">
          <h2 className="bn-title" id="bnx-title">
            {notes.title ?? page.label}
          </h2>
          <p className="bn-byline">{BYLINE}</p>
          {missing ? (
            <p className="dk-await bn-missing" role="status">
              Awaiting the notes file: docs/desk/BUILD_NOTES.md is not in this build.
            </p>
          ) : null}
          {/* §11's byline is printed once: a lead paragraph that repeats it is not printed again. */}
          {leadWithoutByline(notes.lead) ? <Markdown text={leadWithoutByline(notes.lead)} headingLevel={3} tables figure={figureUrl} /> : null}
          {order.map((o) =>
            o.built ? (
              // The page's own section (./built.ts), rendered as the file's are.
              <section key={o.id} id={o.id} className="bn-section bn-built" aria-labelledby={`${o.id}--h`}>
                <h3 id={`${o.id}--h`}>{BUILT_TITLE}</h3>
                <Markdown text={BUILT_PARAGRAPHS.join("\n\n")} headingLevel={3} />
              </section>
            ) : (
              <section key={o.id} id={o.id} className="bn-section" aria-labelledby={`${o.id}--h`}>
                <h3 id={`${o.id}--h`}>{o.title}</h3>
                <Markdown text={byId.get(o.id)?.body ?? ""} headingLevel={3} tables figure={figureUrl} />
              </section>
            ),
          )}
          {/* §1.0.1: the two lists as their own section, word for word (./scope.ts). */}
          <section id={SCOPE_ID} className="bn-section bn-scope" aria-labelledby={`${SCOPE_ID}--h`}>
            <h3 id={`${SCOPE_ID}--h`}>{SCOPE_TITLE}</h3>
            {SCOPE_LISTS.map((l) => (
              <div key={l.title} className="bn-scope-list">
                <h4>{l.title}</h4>
                <ul>
                  {l.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </article>
      </div>
    </div>
  );
}

export default function BuildNotesPage({ page }: { page: DeskPage }) {
  return <BuildNotesView page={page} md={NOTES_MD} />;
}
