import React, { useId } from "react";
// aria-hidden on the svg (2026-08-06): the micro-chart is decorative summary;
// adjacent cells carry the numbers; screen readers skip the path soup.

/**
 * Tiny trend chart. Replaces the matplotlib base64 sparkline from
 * shared_styles.generate_sparkline_b64 with an inline SVG of the same shape:
 * 1.5px line, 10% flat fill underneath (or a 28%→0 gradient), no axes.
 */
export function Sparkline({
  values = [],
  width = 120,
  height = 30,
  color = "var(--accent)",
  fill = true,
  gradient = false,
  gradientOpacity = 0.28,
  strokeWidth = 1.5,
  endDot = false,
  style,
  ...rest
}) {
  // useId keeps gradient ids unique when several sparklines share a page;
  // React 18 ids carry colons, which url(#…) references dislike, so strip them.
  const uid = `spk${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!values || values.length < 2)
    return <svg aria-hidden="true" width={width} height={height} style={style} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 1.5;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y];
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${(width - pad).toFixed(1)} ${height} L${pad} ${height} Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg {...rest} aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", overflow: "visible", ...style }}>
      {gradient ? (
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={gradientOpacity} />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      ) : null}
      {gradient ? (
        <path d={area} fill={`url(#${uid})`} />
      ) : fill ? (
        <path d={area} fill={color} opacity="0.1" />
      ) : null}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {endDot ? <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="3" fill={color} /> : null}
    </svg>
  );
}
