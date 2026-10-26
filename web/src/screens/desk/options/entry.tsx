/**
 * The ways into the Options Finder (Options Finder Build Plan step 6; the lens link and the address are in
 * ./lens-link.tsx, which the Markets tab imports without the Desk's data layer), each drawn only once the Finder is listed
 * (./flag.ts): the Options lens's "Find a contract for a view →" with the ticker filled in; Event Study's "Express
 * this view with options →" when the study's target maps to a listed ETF; the command palette's entry
 * (screens/shell/sections.ts).
 *
 * Event Study's targets are indices, which have no options here: an S&P 500 study maps to SPY, its target being
 * SPY's last close moved by the study's median at the selected horizon. The median is a log return, so the target is
 * close × e^median; the link carries the arithmetic's inputs, and the Finder states them under the form.
 */

import { Link } from "react-router-dom";
import { useTechnicals } from "../data/api";
import type { StudyResponse } from "../data/types";
import { dayLong, isFiniteNumber, pct, priceText } from "../kit/format";
import { OPTIONS_FINDER_LISTED } from "./flag";
import { STUDY_ETF, finderHref } from "./lens-link";

/** What Event Study carries into the Finder: the ETF, the direction and target price, and the arithmetic's inputs. */
export function studyCarry(study: Pick<StudyResponse, "question" | "horizons" | "selected_horizon" | "label">, close: number, closeDate: string): Record<string, string> | null {
  const etf = STUDY_ETF[study.question?.target ?? ""];
  const h = (Array.isArray(study.horizons) ? study.horizons : []).find((x) => x.h === study.selected_horizon);
  if (!etf || !h || !isFiniteNumber(h.median) || h.median === 0 || !isFiniteNumber(close) || close <= 0) return null;
  const target = close * Math.exp(h.median);
  return {
    symbol: etf,
    direction: h.median > 0 ? "up" : "down",
    target: target.toFixed(2),
    es_study: study.label ?? "",
    es_h: String(h.h),
    es_move: String(h.median),
    es_close: String(close),
    es_date: closeDate,
  };
}

/** Event Study's link, under the answer: drawn only when listed, for a target with an ETF, once SPY's close is served. */
export function StudyFinderLink({ study }: { study: StudyResponse }) {
  const etf = STUDY_ETF[study.question?.target ?? ""];
  if (!OPTIONS_FINDER_LISTED || !etf) return null;
  return <StudyFinderLinkFor study={study} etf={etf} />;
}

function StudyFinderLinkFor({ study, etf }: { study: StudyResponse; etf: string }) {
  const t = useTechnicals({ symbol: etf });
  const close = t.data?.price;
  const date = t.data?.date;
  if (!isFiniteNumber(close) || !date) return null;
  const carry = studyCarry(study, close, date);
  if (!carry) return null;
  return (
    <p className="es-note" data-testid="study-finder-link">
      <Link className="dk-link" to={finderHref(carry)}>
        Express this view with options →
      </Link>{" "}
      {etf} at ${carry.target}: its {dayLong(date)} close ${priceText(close)} moved by the study's median ({pct(Number(carry.es_move))}, a log return).
    </p>
  );
}

/** The Finder's note on a view carried from Event Study, from the address; null when the address carries none. */
export function carriedNote(search: URLSearchParams): string | null {
  const move = Number(search.get("es_move"));
  const close = Number(search.get("es_close"));
  const h = search.get("es_h");
  const symbol = search.get("symbol");
  const target = search.get("target");
  if (!search.get("es_move") || !isFiniteNumber(move) || !isFiniteNumber(close) || !h || !symbol || !target) return null;
  const study = search.get("es_study");
  return (
    `Carried from Event Study${study ? ` (${study})` : ""}: the S&P 500's median move ${h} sessions after the event was ${pct(move)} (a log return). ` +
    `${symbol}'s ${dayLong(search.get("es_date"))} close $${priceText(close)} × e^${move.toFixed(4)} = $${target}. The study names no date: pick the one your view runs to.`
  );
}
