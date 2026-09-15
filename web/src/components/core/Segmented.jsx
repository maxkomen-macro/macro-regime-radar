import React, { useRef } from "react";
import { useBreakpoint } from "../../lib/useBreakpoint";

/* Arrow keys move focus between enabled options without changing the value
   (checklist 02 B.8: an aria-pressed group, never a radiogroup). */
const STEP = { ArrowRight: 1, ArrowLeft: -1 };

function optionId(o) {
  return o.id != null ? o.id : o.value;
}

/**
 * Segmented control: `<div role="group" aria-label class="mrr-seg">` with one
 * `<button type="button" aria-pressed>` per option. Text variant (12.5px Plex
 * Sans) or `mono` (11px Plex Mono, uppercase, .08em). Buttons stay in the Tab
 * order natively; hover colour lives in app.css (`.mrr-seg button:hover`).
 */
export function Segmented({
  options = [],
  value,
  onChange,
  label,
  mono = false,
  variant,
  size, // reserved: only "md" (28px) exists
  className,
  style,
  ...rest
}) {
  void size;
  const { isNarrow } = useBreakpoint();
  const isMono = mono || variant === "mono";
  const touch = isNarrow ? "true" : undefined;
  const groupRef = useRef(null);

  const onKeyDown = (e) => {
    const key = e.key;
    if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "Home" && key !== "End") return;
    const items = Array.from(groupRef.current?.querySelectorAll("button:not([disabled])") ?? []);
    const i = items.indexOf(e.currentTarget);
    if (!items.length || i < 0) return;
    e.preventDefault();
    const next =
      key === "Home" ? items[0] : key === "End" ? items[items.length - 1] : items[(i + STEP[key] + items.length) % items.length];
    next.focus();
  };

  return (
    <div
      {...rest}
      ref={groupRef}
      role="group"
      aria-label={label}
      className={["mrr-seg", className].filter(Boolean).join(" ")}
      data-mono={isMono ? "true" : undefined}
      data-touch={touch}
      style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap", ...style }}
    >
      {options.map((o) => {
        const id = optionId(o);
        const on = id === value;
        const disabled = Boolean(o.disabled);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            disabled={disabled || undefined}
            title={o.title}
            data-touch={touch}
            onClick={disabled ? undefined : () => onChange?.(id)}
            onKeyDown={onKeyDown}
            style={{
              whiteSpace: "nowrap",
              height: 28,
              minHeight: touch ? 40 : undefined,
              padding: touch ? "0 14px" : isMono ? "0 11px" : "0 16px",
              borderRadius: "var(--r-badge)",
              fontFamily: isMono ? "var(--font-mono)" : "var(--font-ui)",
              fontSize: isMono ? "11px" : "12.5px",
              fontWeight: 400,
              letterSpacing: isMono ? ".08em" : undefined,
              textTransform: isMono ? "uppercase" : undefined,
              lineHeight: 1,
              // --seg-fg is set by app.css on hover (.mrr-seg button:hover) so the
              // unpressed colour can brighten past this inline value.
              color: on ? "#fff" : disabled ? "var(--text-4)" : "var(--seg-fg, var(--text-2))",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: on ? "var(--line-strong)" : "transparent",
              background: on ? "linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03))" : "none",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
