import { useLayoutEffect, useRef } from "react";
import { gsap, reducedMotion, ScrollTrigger } from "../lib/motion";

/**
 * The only thing on the page allowed to move on its own.
 *
 * Two fields of light are driven from `gsap.ticker` rather than CSS keyframes,
 * so they share a clock with every other tween, pause when the tab sleeps, and
 * ignore a stall instead of jumping. The ruled field is scrubbed against
 * scroll: it recedes as you read, which is depth without the data drifting.
 *
 * Foreground copy and figures are never touched from here. That is the
 * "quietly confident" rule in code rather than in a comment.
 */
export function Atmosphere() {
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (reducedMotion()) return;

    const blobA = a.current;
    const blobB = b.current;
    const grid = field.current;
    if (!blobA || !blobB) return;

    const { interpolate } = gsap.utils;

    const tick = (time: number) => {
      gsap.set(blobA, {
        x: Math.sin(time * 0.11) * 52,
        y: Math.cos(time * 0.09) * 38,
        scale: interpolate(1, 1.14, (Math.sin(time * 0.07) + 1) / 2),
      });
      gsap.set(blobB, {
        x: Math.cos(time * 0.08) * -46,
        y: Math.sin(time * 0.1) * -32,
        scale: interpolate(1.08, 1, (Math.cos(time * 0.06) + 1) / 2),
      });
    };

    gsap.ticker.add(tick);

    const parallax = grid
      ? gsap.to(grid, {
          y: 96,
          ease: "none",
          scrollTrigger: {
            start: 0,
            end: "max",
            scrub: 1.1,
          },
        })
      : undefined;

    return () => {
      gsap.ticker.remove(tick);
      parallax?.scrollTrigger?.kill();
      parallax?.kill();
      ScrollTrigger.refresh();
    };
  }, []);

  return (
    <>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-blob a" ref={a} />
        <div className="ambient-blob b" ref={b} />
      </div>
      <div className="grid-field" ref={field} aria-hidden="true" />
    </>
  );
}
