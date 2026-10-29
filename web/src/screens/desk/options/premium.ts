import { NOT_SERVED, grouped, isFiniteNumber } from "../kit/format";

/** An option's price per share: cents, or the decimals the served price carries, up to four ($0.90, $0.875).
 *  Shared by the Finder and the Position Monitor's option subject, so a saved fill reads as the Finder showed it
 *  (Codex S-15). */
export function premium(x: number | null | undefined): string {
  if (!isFiniteNumber(x)) return NOT_SERVED;
  const d = [2, 3, 4].find((k) => Number(x.toFixed(k)) === x) ?? 4;
  return grouped(x, d);
}
