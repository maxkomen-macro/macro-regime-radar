/**
 * Markdown — a deliberately small renderer for the AI analyst's replies
 * (2026-09-05). The model writes GitHub-flavoured prose: headings, bold and
 * italic emphasis, inline code, fenced code, bullet and numbered lists, and
 * links. Everything is built as React elements (never innerHTML), so model
 * output can not inject markup, and literal Markdown syntax never reaches the
 * reader. Anything the grammar does not cover renders as a plain paragraph.
 *
 * Two blocks are opt-in, for a page that renders a file it owns (Desk Build
 * Notes, DESK_FRAME3_SPEC §11) and never for model output: pipe tables
 * (`tables`), and an image alone on its line (`figure`), shown only when the
 * page resolves its path to a file in its own build, else named in words.
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

// An underscore opens and closes emphasis only at a word's edge, as in GitHub's Markdown, so
// snake_case and FILE_NAMES print as written.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|(?<![\p{L}\p{N}])_[^_\s][^_]*_(?![\p{L}\p{N}])|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/gu;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`"))
      out.push(
        <code key={k} className="mrr-md-code">
          {tok.slice(1, -1)}
        </code>,
      );
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]("));
      const href = m[2];
      out.push(
        <a key={k} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = start + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "img"; alt: string; src: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "hr" };

/** An image alone on its line: `![alt](path)`. */
const IMAGE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
/** A pipe table's second line: `|---|:---:|`. */
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** A table row's cells: the text between unescaped pipes, trimmed. */
function cells(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

interface Options {
  tables: boolean;
  figures: boolean;
}

function parse(src: string, opt: Options): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const tableAt = (k: number) => opt.tables && /^\s*\|/.test(lines[k]) && k + 1 < lines.length && TABLE_RULE.test(lines[k + 1]);
  const imageAt = (k: number) => opt.figures && IMAGE.test(lines[k]);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (imageAt(i)) {
      const m = IMAGE.exec(line)!;
      blocks.push({ kind: "img", alt: m[1], src: m[2] });
      i++;
      continue;
    }
    if (tableAt(i)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push({ kind: "ol", items });
      continue;
    }
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("```") &&
      !imageAt(i) &&
      !tableAt(i)
    )
      buf.push(lines[i++]);
    blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

/** A region that scrolls sideways inside itself, never the page; it is a tab stop (so a keyboard can
 * scroll it) only while its content is wider than it. */
function Scroller({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} role="region" aria-label={label} tabIndex={scrolls ? 0 : undefined}>
      {children}
    </div>
  );
}

/** A cell's words for a label: the Markdown marks dropped. */
const plainWords = (t: string) => t.replace(/\*\*|[*`]/g, "").replace(/(^|\s)_|_(\s|$)/g, "$1$2").trim();

export default function Markdown({
  text,
  headingLevel = 3,
  tables = false,
  figure,
}: {
  text: string;
  headingLevel?: 2 | 3;
  /** Render pipe tables (a page's own file only). */
  tables?: boolean;
  /** Resolve an image's path to a file in this build, or null; without it images are plain text. */
  figure?: (src: string) => string | null;
}) {
  const blocks = parse(text, { tables, figures: !!figure });
  return (
    <div className="mrr-md">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h": {
            // Model headings never outrank the panel's own h2 (headingLevel 3,
            // the default); a page that owns its h1 (Desk Build Notes) starts
            // its sections at h2.
            const Tag = (b.level <= 2 ? `h${headingLevel}` : `h${headingLevel + 1}`) as "h2" | "h3" | "h4";
            return <Tag key={i}>{inline(b.text, `h${i}`)}</Tag>;
          }
          case "ul":
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `u${i}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `o${i}-${j}`)}</li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={i}>
                <code>{b.text}</code>
              </pre>
            );
          case "hr":
            return <hr key={i} />;
          case "img": {
            const url = figure?.(b.src) ?? null;
            // A figure keeps its own size, so its words stay readable; a wide one scrolls in its region.
            return url ? (
              <figure key={i} className="mrr-md-figure">
                <Scroller className="mrr-md-figure-scroll" label={b.alt || "Figure"}>
                  <img src={url} alt={b.alt} />
                </Scroller>
              </figure>
            ) : (
              <p key={i} className="mrr-md-figure-missing">
                {b.alt ? `Figure: ${b.alt} (not in this build)` : "A figure not in this build"}
              </p>
            );
          }
          case "table":
            return (
              // A wide table scrolls inside its own region, never the page.
              <Scroller key={i} className="mrr-md-table" label={b.head.map(plainWords).join(", ")}>
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} scope="col">
                          {inline(c, `t${i}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {b.head.map((_, k) => (
                          <td key={k}>{inline(r[k] ?? "", `t${i}-${j}-${k}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroller>
            );
          default:
            return <p key={i}>{inline(b.text, `p${i}`)}</p>;
        }
      })}
      <Fragment />
    </div>
  );
}
