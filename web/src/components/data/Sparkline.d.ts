export interface SparklineProps {
  /** Oldest → newest. Fewer than 2 points renders an empty box. */
  values?: number[];
  width?: number;
  height?: number;
  color?: string;
  /** 10%-opacity area under the line. Default true. */
  fill?: boolean;
  style?: React.CSSProperties;
}

/** Inline SVG micro-chart, 1.5px stroke, no axes. */
export function Sparkline(props: SparklineProps): JSX.Element;
