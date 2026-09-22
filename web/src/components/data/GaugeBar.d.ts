export type GaugeTone = "clear" | "watch" | "alert" | "info" | "neutral" | "pos" | "neg";

export interface GaugeScale {
  left?: React.ReactNode;
  mid?: React.ReactNode;
  right?: React.ReactNode;
}

export interface GaugeBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "color"> {
  /** 0–100. Clamped; NaN renders 0. */
  pct?: number;
  /** Caption above the bar (13px --text-2), e.g. "20-year percentile". */
  caption?: React.ReactNode;
  /** Status tone: clear --mint, watch --amber, alert --neg, info --link,
   *  neutral --text-3, pos --pos, neg --neg. Without `tone` or `color` the
   *  legacy four-step ramp (`rampColor`) applies. */
  tone?: GaugeTone;
  /** Any colour; wins over `tone` (regime hues, custom paints). */
  color?: string;
  /** Track height in px. Default 5 (was 4 before Phase 2). */
  height?: number;
  /** Fill from 40% alpha to the full colour (mockup cycle meter). */
  gradient?: boolean;
  /** A 1px marker at this percent, overshooting the track by 4px each side. */
  tick?: number;
  /** Middle entry of the scale row when `scale` is absent (e.g. "avg 26.3 mo"). */
  tickLabel?: React.ReactNode;
  /** Mono 10.5px row under the track: left / mid (--text-2) / right. */
  scale?: GaugeScale;
  /** When set the track gets role="img" and this label; default is decorative. */
  ariaLabel?: string;
  /** Keep the 8px gutter under the track (default true). MeterRow passes false. */
  gutter?: boolean;
  style?: React.CSSProperties;
}

/** 5px meter on --track; colour by tone, custom colour, or the legacy ramp. */
export function GaugeBar(props: GaugeBarProps): JSX.Element;

/** Returns the ramp token for a 0–100 fill percentage. */
export function rampColor(pct: number): string;

export interface MeterRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "color"> {
  label: React.ReactNode;
  /** 0–100 fill. */
  pct: number;
  tone?: GaugeTone;
  color?: string;
  gradient?: boolean;
  /** Right-aligned value (UI face, 500). */
  value: React.ReactNode;
  /** Optional mono 11px trailing column, e.g. "+6 pts". */
  delta?: React.ReactNode;
  /** "watch" paints the delta amber; default --text-4. */
  deltaTone?: "watch" | "neutral";
  /** 8x8 swatch (regime hue) before the label, inside the label cell. */
  swatch?: string;
  /** "sm" renders the value at 13px (late-cycle rows); default 14px. */
  valueSize?: "md" | "sm";
  labelWidth?: number;
  valueWidth?: number;
  height?: number;
  style?: React.CSSProperties;
}

/** Grid row: [swatch] label · meter · value · [delta]. */
export function MeterRow(props: MeterRowProps): JSX.Element;

export interface DivergingBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Signed value; negative extends left of the centre tick, positive right. */
  value: number;
  /** Full-scale magnitude (|value| / max fills half the bar). Defaults to |value|. */
  max?: number;
  /** Colour for values > 0. Default --neg ("raises odds"). */
  positiveColor?: string;
  /** Colour for values < 0. Default --mint ("lowers odds"). */
  negativeColor?: string;
  /** CSS width; default 100%. Surprise tables pass 120. */
  width?: number | string;
  style?: React.CSSProperties;
}

/** Centre-anchored signed bar, 10px tall with an 8px bar and a centre tick. */
export function DivergingBar(props: DivergingBarProps): JSX.Element;
