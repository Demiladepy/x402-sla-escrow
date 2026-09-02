import { useLayoutEffect, useRef } from "react";
import { EASE_SOFT, gsap, reducedMotion } from "../lib/motion";

interface Props {
  value: number;
  /** Duration for the first count, which travels from zero. */
  intro?: number;
}

/**
 * An integer that counts to its value instead of snapping to it.
 *
 * Two speeds on purpose: the first value arrives from zero slowly enough to be
 * read as a reveal, while later changes — this page polls every 1.5 seconds —
 * move quickly, so a counter that ticks up by one reads as a live instrument
 * rather than an animation replaying.
 *
 * Only integers. Token amounts are formatted from fixed-point strings and
 * tweening them through floats would print values the chain never held.
 */
export function Num({ value, intro = 1.1 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const from = shown.current;
    shown.current = value;

    if (reducedMotion() || from === value) {
      el.textContent = value.toLocaleString();
      return;
    }

    const proxy = { n: from ?? 0 };
    const tween = gsap.to(proxy, {
      n: value,
      duration: from === null ? intro : 0.42,
      ease: from === null ? EASE_SOFT : "power2.out",
      onUpdate: () => {
        el.textContent = Math.round(proxy.n).toLocaleString();
      },
    });

    return () => {
      tween.kill();
      // Killing mid-tween would otherwise leave a partial figure on screen.
      el.textContent = value.toLocaleString();
    };
  }, [value, intro]);

  return <span ref={ref} className="num-live">{value.toLocaleString()}</span>;
}
