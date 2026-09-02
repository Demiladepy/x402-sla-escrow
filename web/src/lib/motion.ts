import { gsap } from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, SplitText);

/**
 * Shared motion vocabulary.
 *
 * One easing family across the page, because mixed easing reads as several
 * hands rather than one. Exponential deceleration only — real objects settle,
 * they do not bounce, and a payments interface that springs undermines the
 * thing it is trying to say about itself.
 */
export const EASE = "expo.out";
export const EASE_SOFT = "power3.out";
export const EASE_TRAVEL = "power3.inOut";

export const DUR = {
  fast: 0.34,
  base: 0.72,
  slow: 1.1,
} as const;

export const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveals an element's final state with no animation.
 *
 * Used on the reduced-motion path and as the fallback when an animation is
 * skipped, so "no animation" never means "never becomes visible".
 */
export function showNow(targets: gsap.TweenTarget) {
  gsap.set(targets, { opacity: 1, y: 0, clearProps: "transform" });
}

let effectsReady = false;

/**
 * Named effects, so a reveal is invoked rather than re-specified.
 *
 * `gsap.effects` is the public vocabulary; the tweens themselves stay in one
 * place. If a duration or ease changes, it changes everywhere that called the
 * name rather than everywhere that copied the tween.
 */
function registerEffects() {
  if (effectsReady) return;
  effectsReady = true;

  gsap.registerEffect({
    name: "revealUp",
    extendTimeline: true,
    defaults: { duration: DUR.base, ease: EASE, stagger: 0.075 },
    effect: (targets: gsap.TweenTarget, config: { duration?: number; ease?: string; stagger?: number }) =>
      gsap.to(targets, {
        opacity: 1,
        y: 0,
        duration: config.duration,
        ease: config.ease,
        stagger: config.stagger,
        overwrite: true,
      }),
  });
}

function onVisibility() {
  // Sleeping the ticker stops the ambient field as well as in-flight tweens.
  // Leaving it running in a background tab would keep interpolating a scene
  // nobody can see, and waking it without lagSmoothing would jump several
  // seconds in one frame.
  if (document.hidden) {
    gsap.ticker.sleep();
    gsap.globalTimeline.pause();
  } else {
    gsap.ticker.wake();
    gsap.globalTimeline.resume();
  }
}

/**
 * Marks the document as motion-capable.
 *
 * The hidden pre-reveal state lives behind this class, so if the bundle fails
 * to load or execute, `[data-reveal]` elements are simply visible instead of a
 * page of permanently invisible content. Called at module load, before React
 * paints, so there is no flash of shown-then-hidden.
 *
 * Reduced-motion users never take this path: the class is not applied, so the
 * CSS that hides content never matches.
 */
export function enableMotion() {
  if (typeof document === "undefined") return;
  if (reducedMotion()) return;

  document.documentElement.classList.add("js-motion");
  registerEffects();

  gsap.ticker.lagSmoothing(500, 33);
  document.addEventListener("visibilitychange", onVisibility);

  void document.fonts.ready.then(() => ScrollTrigger.refresh());
}

/** Smooth-scrolls to an in-page id. Instant when motion is reduced. */
export function scrollToId(id: string) {
  const target = id.startsWith("#") ? id : `#${id}`;

  if (reducedMotion()) {
    document.querySelector(target)?.scrollIntoView();
    return;
  }

  gsap.to(window, {
    duration: 1.05,
    ease: EASE_TRAVEL,
    scrollTo: { y: target, offsetY: 8 },
    overwrite: true,
  });
}

export { gsap, ScrollTrigger, SplitText };
