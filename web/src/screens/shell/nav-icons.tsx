/**
 * Shell icons (redesign Phase 1). Hand-drawn inline SVGs copied verbatim from
 * the approved mockups (docs/redesign-v2/regime-lab.html, watchlist.html); no
 * icon library, per spec §0. Every icon is decorative (aria-hidden): the text
 * next to it carries the meaning.
 */

import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

/** Wordmark mountain mark, 48×26; stroke follows `color` (the wordmark tint). */
export function MountainMark(props: IconProps) {
  return (
    <svg width="48" height="26" viewBox="0 0 48 26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M2 24 15 4l13 20" />
      <path d="M14 24 27 4l13 20" />
      <path d="M8.5 14h13" />
    </svg>
  );
}

function TabIcon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <TabIcon {...props}>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h4.5v-6h4v6h4.5V9.5" />
    </TabIcon>
  );
}

export function RegimeLabIcon(props: IconProps) {
  return (
    <TabIcon {...props}>
      <path d="M9 3h6" />
      <path d="M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.2V3" />
      <path d="M7.2 15h9.6" />
    </TabIcon>
  );
}

export function MarketsIcon(props: IconProps) {
  return (
    <TabIcon {...props}>
      <path d="M4 20V14" />
      <path d="M9 20V10" />
      <path d="M14 20v-7" />
      <path d="M19 20V6" />
      <path d="m4 10 5-4 5 3 6-5" />
    </TabIcon>
  );
}

export function CreditIcon(props: IconProps) {
  return (
    <TabIcon {...props}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13" />
      <path d="M4.5 10c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
      <path d="M4.5 14.3c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
    </TabIcon>
  );
}

export function RecessionIcon(props: IconProps) {
  return (
    <TabIcon {...props}>
      <path d="M3 3v18h18" />
      <path d="m6 7 4 5 3-2 6 7" />
      <path d="M15.5 17H19v-3.5" />
    </TabIcon>
  );
}

export function NewsIcon(props: IconProps) {
  return (
    <TabIcon {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
    </TabIcon>
  );
}

export function ToolsIcon(props: IconProps) {
  return (
    <TabIcon {...props}>
      <path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 1.4-1.4" />
      <path d="M14.7 6.3 10 11" />
      <path d="m3 21 7.5-7.5" />
      <path d="M14.7 6.3A4 4 0 0 1 17.7 3l-2 2.6.6 2 2 .6L21 6.3a4 4 0 0 1-3.3 3" />
    </TabIcon>
  );
}

/** Methodology book, 18×18 (no linecap attributes, as drawn). */
export function MethodologyIcon(props: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
    </svg>
  );
}

/** Palette trigger magnifier, 18×18. */
export function SearchIcon(props: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** Alerts bell, 24×24; stroke follows `color` (--text-2 on the trigger). */
export function BellIcon(props: IconProps) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" {...props}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** Watchlist drag handle, 10×14: six dots in --text-4. */
export function DragHandleIcon(props: IconProps) {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="var(--text-4, #5f6c78)" aria-hidden="true" {...props}>
      <circle cx="2.5" cy="2.5" r="1.3" />
      <circle cx="7.5" cy="2.5" r="1.3" />
      <circle cx="2.5" cy="7" r="1.3" />
      <circle cx="7.5" cy="7" r="1.3" />
      <circle cx="2.5" cy="11.5" r="1.3" />
      <circle cx="7.5" cy="11.5" r="1.3" />
    </svg>
  );
}

/** Watchlist remove ×, 12×12. */
export function RemoveIcon(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** Icon per tab slug (sections.ts). Unknown slugs render nothing. */
export const NAV_ICONS: Record<string, (props: IconProps) => JSX.Element> = {
  dashboard: DashboardIcon,
  "regime-lab": RegimeLabIcon,
  markets: MarketsIcon,
  credit: CreditIcon,
  recession: RecessionIcon,
  news: NewsIcon,
  tools: ToolsIcon,
  methodology: MethodologyIcon,
};

export function NavIcon({ slug }: { slug: string }) {
  const Icon = NAV_ICONS[slug];
  return Icon ? <Icon /> : null;
}
