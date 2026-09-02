import { useEffect } from "react";

/**
 * Reveals `[data-reveal]` elements once, as they enter the viewport.
 *
 * Kept as an observer rather than a scroll handler so it costs nothing while
 * idle, and unobserves each element after firing — a reveal that can play
 * twice reads as a glitch when scrolling back up.
 */
export function useReveal() {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));

    if (!("IntersectionObserver" in window)) {
      for (const el of targets) el.classList.add("shown");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("shown");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
    );

    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, []);
}
