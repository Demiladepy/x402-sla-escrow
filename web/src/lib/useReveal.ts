import { useLayoutEffect } from "react";
import { gsap, reducedMotion, ScrollTrigger, showNow } from "./motion";

/**
 * Reveals `[data-reveal]` elements as they enter the viewport.
 *
 * Batched rather than one trigger per element: elements crossing the threshold
 * together are staggered as a group, which makes a section arrive as one
 * composed movement instead of a ripple of independent fades.
 *
 * Elements are marked once revealed and never re-selected. Re-running (when
 * live data adds new sections) therefore only wires up what is genuinely new.
 */
export function useReveal(deps: unknown[] = []) {
  useLayoutEffect(() => {
    const targets = gsap.utils.toArray<HTMLElement>("[data-reveal]:not([data-revealed])");
    if (targets.length === 0) return;

    const mark = (els: Element[]) => {
      for (const el of els) el.setAttribute("data-revealed", "");
    };

    if (reducedMotion()) {
      mark(targets);
      showNow(targets);
      return;
    }

    const triggers = ScrollTrigger.batch(targets, {
      start: "top 88%",
      once: true,
      batchMax: 6,
      onEnter: (batch) => {
        mark(batch);
        gsap.effects.revealUp(batch, { stagger: 0.075 });
      },
    });

    ScrollTrigger.refresh();

    return () => {
      // kill(false) so revealed elements keep the state they animated to.
      // Reverting here would hide content that is already on screen.
      for (const t of triggers) t.kill(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
