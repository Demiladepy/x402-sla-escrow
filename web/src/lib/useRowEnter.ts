import { useLayoutEffect, useRef } from "react";
import { DUR, EASE, gsap, reducedMotion } from "./motion";

/**
 * Fades in ledger rows that arrived after the first paint.
 *
 * The first batch is the history of a running system and should simply be
 * there. Rows that appear later — one every few seconds — are the live
 * instrument, and those are the ones that announce themselves. Opacity only:
 * transforming a table row is inconsistently honoured across browsers, and
 * a sliding row would also fight the still-foreground rule.
 */
export function useRowEnter<T extends { requestId: string }>(rows: T[]) {
  const body = useRef<HTMLTableSectionElement>(null);
  const seen = useRef(new Set<string>());
  const primed = useRef(false);

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;

    if (!primed.current) {
      for (const row of rows) seen.current.add(row.requestId);
      primed.current = true;
      return;
    }

    const fresh = rows.filter((row) => !seen.current.has(row.requestId));
    for (const row of fresh) seen.current.add(row.requestId);
    if (fresh.length === 0 || reducedMotion()) return;

    const nodes = fresh
      .map((row) => el.querySelector(`[data-rid="${CSS.escape(row.requestId)}"]`))
      .filter((node): node is HTMLElement => node instanceof HTMLElement);

    if (nodes.length === 0) return;

    gsap.fromTo(
      nodes,
      { opacity: 0 },
      { opacity: 1, duration: DUR.fast, stagger: 0.05, ease: EASE, overwrite: true },
    );
  }, [rows]);

  return body;
}
