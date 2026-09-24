/**
 * Build Notes (DESK_FRAME3_SPEC §11, screens/11-build-notes.png): the page
 * renders docs/desk/BUILD_NOTES.md, nothing hardcoded but the byline §11
 * names and the line saying where the text comes from. The contents list is
 * the file's own `##` sections, the article its title, lead and sections
 * through the app's Markdown renderer. A sentence using a word the Desk never
 * prints is held with a marker (./notes.ts); the report records how many.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import Markdown from "../../shell/Markdown";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { readNotes } from "./notes";
import "./notes.css";

/** The notes file, read at build time. A build context that holds only web/
 * (the Docker image) finds no file and the page says so; it never fails the build. */
const FILES = import.meta.glob<string>("../../../../../docs/desk/BUILD_NOTES.md", { query: "?raw", import: "default", eager: true });
export const NOTES_MD: string = Object.values(FILES)[0] ?? "";

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

export function BuildNotesView({ page, md }: { page: DeskPage; md: string }) {
  const notes = readNotes(md);
  const { hash } = useLocation();
  const { active, jump } = useReading(
    notes.sections.map((s) => s.id),
    hash,
  );
  const missing = !md.trim();
  return (
    <div className="bn">
      <PageTitle page={page} />
      <div className="bn-grid">
        <aside className="bn-side">
          {notes.sections.length ? (
            <nav aria-label="Contents">
              <ul className="bn-toc">
                {notes.sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} aria-current={active === s.id ? "location" : undefined} onClick={() => jump(s.id)}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <span />
          )}
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
          {notes.lead ? <Markdown text={notes.lead} headingLevel={3} /> : null}
          {notes.sections.map((s) => (
            <section key={s.id} id={s.id} className="bn-section" aria-labelledby={`${s.id}--h`}>
              <h3 id={`${s.id}--h`}>{s.title}</h3>
              <Markdown text={s.body} headingLevel={3} />
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

export default function BuildNotesPage({ page }: { page: DeskPage }) {
  return <BuildNotesView page={page} md={NOTES_MD} />;
}
