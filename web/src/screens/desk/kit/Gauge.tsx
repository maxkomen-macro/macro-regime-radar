/**
 * The Desk v2 band gauge (DESK_FRAME3_SPEC §3 skew and RSI, §5 recession,
 * §6 credit): a track split into three named bands, the band names above
 * (the ends in their tone, the middle gray), optional tick values under the
 * track, and a white needle at the served value with its caption under it.
 * `thick` is the Technicals track (22 px); the thin one is the Regime and
 * Macro gauge. Tones follow §1.3: green for the good end, amber for the
 * caution end (a limit), a neutral middle.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

export interface GaugeBand {
  label: ReactNode;
  /** Band end on the gauge's own scale; the first band starts at `min`. */
  to: number;
  tone: "green" | "amber" | "neutral";
}

export default function Gauge({
  min,
  max,
  bands,
  value,
  caption,
  ticks,
  thick = false,
  label,
}: {
  min: number;
  max: number;
  bands: GaugeBand[];
  value: number;
  /** Under the needle ("74th pct", "58"). */
  caption?: ReactNode;
  ticks?: number[];
  thick?: boolean;
  /** The gauge's accessible description. */
  label: string;
}) {
  const frac = (v: number) => (Math.min(max, Math.max(min, v)) - min) / (max - min || 1);
  const pos = (v: number) => `${frac(v) * 100}%`;
  let from = min;
  const segs = bands.map((b) => {
    const to = Math.max(from, Math.min(max, b.to));
    const s = { ...b, from, width: ((to - from) / (max - min || 1)) * 100 };
    from = to;
    return s;
  });
  // The caption keeps inside the track: its center is clamped by its own
  // measured width (verifier T-11); a tick label it would cover is left out.
  const at = frac(value);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const capRef = useRef<HTMLSpanElement | null>(null);
  const [capLeft, setCapLeft] = useState<string>(pos(value));
  useLayoutEffect(() => {
    const W = trackRef.current?.getBoundingClientRect().width ?? 0;
    const w = capRef.current?.getBoundingClientRect().width ?? 0;
    if (!W || !w) return setCapLeft(pos(value));
    const x = Math.min(W - w / 2, Math.max(w / 2, at * W));
    setCapLeft(`${x}px`);
  }, [at, value, caption]);
  const shown = (ticks ?? []).filter((t) => !caption || Math.abs(frac(t) - at) > 0.08);
  return (
    <div className={cx("dk-gauge", thick && "dk-gauge-thick")} role="img" aria-label={label}>
      <div className="dk-gauge-names" aria-hidden="true">
        {segs.map((s, i) => (
          <span key={i} data-tone={s.tone} style={{ width: `${s.width}%`, textAlign: i === 0 ? "left" : i === segs.length - 1 ? "right" : "center" }}>
            {s.label}
          </span>
        ))}
      </div>
      <div className="dk-gauge-track" aria-hidden="true" ref={trackRef}>
        {segs.map((s, i) => (
          <span key={i} data-tone={s.tone} style={{ width: `${s.width}%` }} />
        ))}
        <span className="dk-gauge-needle" style={{ left: pos(value) }} />
      </div>
      {ticks?.length || caption ? (
        <div className="dk-gauge-under" aria-hidden="true">
          {shown.map((t) => (
            <span key={t} className="dk-gauge-tick" style={{ left: pos(t) }} data-edge={t === min ? "start" : t === max ? "end" : undefined}>
              {t}
            </span>
          ))}
          {caption ? (
            <span className="dk-gauge-caption" style={{ left: capLeft }} ref={capRef}>
              {caption}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
