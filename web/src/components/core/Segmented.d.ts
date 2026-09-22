export interface SegmentedOption {
  /** Option key passed to `onChange`. (`value` is accepted as an alias.) */
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
  /** Native tooltip on the button. */
  title?: string;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  /** The pressed option's id. */
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the group (`aria-label`). */
  label: string;
  /** Mono variant: 11px Plex Mono, uppercase, .08em, 11px side padding (range pickers, filters). */
  mono?: boolean;
  /** Alias of `mono`: `variant="mono"`. */
  variant?: "text" | "mono";
  /** Reserved; only `md` (28px) exists. */
  size?: "md";
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  /** `aria-*`, `data-*` and any other DOM attribute spread onto the group. */
  [key: string]: unknown;
}

/**
 * `<div role="group" aria-label class="mrr-seg" data-mono data-touch>` with one
 * `<button type="button" aria-pressed>` per option. Arrow keys move focus only.
 */
export function Segmented(props: SegmentedProps): JSX.Element;
