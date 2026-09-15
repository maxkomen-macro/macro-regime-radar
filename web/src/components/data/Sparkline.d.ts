export interface SparklineProps
  extends Omit<React.SVGAttributes<SVGSVGElement>, "values" | "width" | "height" | "color" | "fill" | "strokeWidth" | "style"> {
  /** Oldest → newest. Fewer than 2 points renders an empty box. */
  values?: number[];
  width?: number;
  height?: number;
  /** Line colour; default the brand accent. Pass --pos / --neg / --mint / --amber when direction carries meaning. */
  color?: string;
  /** 10%-opacity flat area under the line. Default true. */
  fill?: boolean;
  /** Area fades from `gradientOpacity` at the line to 0 at the base (mockup sparklines). */
  gradient?: boolean;
  /** Top stop opacity of the gradient. Default .28 (hero areas use .22). */
  gradientOpacity?: number;
  /** Line width. Default 1.5 (signal cards 1.4, tape and watchlist 1.3). */
  strokeWidth?: number;
  /** A 3px dot on the last point in `color` (hero-chart convention). */
  endDot?: boolean;
  style?: React.CSSProperties;
}

/** Inline SVG micro-chart, no axes; flat or gradient area with unique gradient ids per instance. */
export function Sparkline(props: SparklineProps): JSX.Element;
