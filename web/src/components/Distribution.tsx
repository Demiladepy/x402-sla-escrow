import { useLayoutEffect, useMemo, useRef } from "react";
import { DUR, EASE, ScrollTrigger, gsap, reducedMotion } from "../lib/motion";
import type { LedgerRow } from "../lib/types";

/**
 * Log-spaced buckets, with the SLA budget falling exactly on a boundary.
 *
 * Latency here is bimodal by construction — healthy calls land in tens of
 * milliseconds, degraded ones around 2.5 seconds — and a linear axis would
 * collapse the entire healthy population into the first column. The boundary at
 * the budget matters more than the bucket widths: it is the point the payment
 * stops, so no column may straddle it.
 */
const EDGES = [0, 10, 25, 50, 100, 200, 400, 800, 1600, 3200, Infinity];

function label(lo: number, hi: number): string {
  if (hi === Infinity) return "3.2s+";
  if (hi >= 1000) return `${hi / 1000}s`;
  return `${hi}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

interface Props {
  rows: LedgerRow[];
  budget: number;
}

export function Distribution({ rows, budget }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const played = useRef(false);

  const stats = useMemo(() => {
    const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);

    const counts = new Array<number>(EDGES.length - 1).fill(0);
    for (const l of latencies) {
      // Buckets are ordered, so the first upper edge above the sample owns it.
      const i = EDGES.findIndex((edge, n) => n > 0 && l < edge) - 1;
      counts[i < 0 ? counts.length - 1 : i]! += 1;
    }

    const buckets = EDGES.slice(0, -1).map((lo, i) => ({
      lo,
      hi: EDGES[i + 1]!,
      label: label(lo, EDGES[i + 1]!),
      count: counts[i]!,
      breach: lo >= budget,
    }));

    const peak = Math.max(1, ...buckets.map((b) => b.count));
    const withinBudget = latencies.filter((l) => l <= budget).length;

    return {
      buckets,
      peak,
      total: latencies.length,
      withinBudget,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      // Reduced rather than spread into Math.max: the ledger grows for as long
      // as the demo runs, and spreading an array past ~65k arguments throws.
      slowestPaid: rows.reduce((m, r) => (r.acked && r.latencyMs > m ? r.latencyMs : m), 0),
    };
  }, [rows, budget]);

  /**
   * The chart assembles itself in the order the argument runs: the population
   * first, then the line, then the consequence.
   *
   * Bars scale from their baseline rather than animating height, so this never
   * fights the inline height React sets on every poll — GSAP owns the entrance
   * transform, CSS owns subsequent height changes.
   *
   * Plays once. A histogram that re-animates on every data refresh would be
   * unreadable, and re-animating on scroll-back reads as a glitch.
   */
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || played.current || stats.total === 0) return;

    const bars = gsap.utils.toArray<HTMLElement>(".dist-bar", el);
    const line = el.querySelector<HTMLElement>(".dist-threshold");
    const breaches = gsap.utils.toArray<HTMLElement>(".dist-col.breach .dist-bar", el);
    if (bars.length === 0) return;

    played.current = true;

    if (reducedMotion()) {
      gsap.set([...bars, line].filter(Boolean), { scaleY: 1, opacity: 1 });
      return;
    }

    let tl: gsap.core.Timeline | undefined;

    const ctx = gsap.context(() => {
      tl = gsap.timeline({
        defaults: { ease: EASE },
        scrollTrigger: { trigger: el, start: "top 82%", once: true },
      });

      tl.fromTo(
        bars,
        { scaleY: 0 },
        { scaleY: 1, duration: DUR.base, stagger: 0.045, transformOrigin: "50% 100%" },
      );

      if (line) {
        tl.fromTo(
          line,
          { scaleY: 0, opacity: 0 },
          { scaleY: 1, opacity: 1, duration: DUR.base, transformOrigin: "50% 0%" },
          "-=0.28",
        );
        tl.from(".dist-threshold-label", { opacity: 0, x: -6, duration: DUR.fast }, "-=0.2");
      }

      // The bars past the line lose their fill last, which is the point being
      // made: everything to the right of it earned nothing.
      if (breaches.length > 0) {
        tl.fromTo(
          breaches,
          { opacity: 1 },
          { opacity: 0.42, duration: DUR.fast, stagger: 0.05 },
          "-=0.1",
        );
      }
    }, root);

    ScrollTrigger.refresh();

    return () => {
      // The trigger is disposable; the styles it produced are not. Reverting
      // would leave a permanently collapsed chart, since this plays only once.
      tl?.scrollTrigger?.kill(false);
      ctx.kill(false);
    };
    // Deliberately a stable boolean: `stats.total` changes on every poll, and
    // depending on it would tear this down and rebuild it every 1.5 seconds.
  }, [stats.total > 0]);

  if (stats.total === 0) {
    return (
      <div className="dist-empty">
        Every call's latency is recorded here as it is served. The distribution appears once the
        buyer agent has made its first request.
      </div>
    );
  }

  const share = ((stats.withinBudget / stats.total) * 100).toFixed(1);

  return (
    <div className="dist">
      <div className="dist-chart" role="img" aria-label={`Latency distribution of ${stats.total} calls against a ${budget}ms budget`}>
        {stats.buckets.map((b) => (
          <div className={`dist-col${b.breach ? " breach" : ""}`} key={b.lo}>
            <span className="dist-count">{b.count > 0 ? b.count : ""}</span>
            <span
              className="dist-bar"
              style={{ height: `${(b.count / stats.peak) * 100}%` }}
            />
            <span className="dist-tick">{b.label}</span>
          </div>
        ))}

        {/* Sits on the 800ms bucket boundary — the seventh of ten gaps. */}
        <div className="dist-threshold" style={{ left: `${(7 / EDGES.slice(0, -1).length) * 100}%` }}>
          <span className="dist-threshold-label">{budget}ms</span>
        </div>
      </div>

      <p className="dist-axis">Response time, milliseconds — log scale</p>

      <div className="dist-read">
        <p>
          <strong>{share}% of {stats.total} calls</strong> landed inside the {budget}ms budget. The
          line is not a target or an alert threshold. Everything to the right of it earned the
          seller nothing, and the contract is what enforced that.
        </p>
        <dl className="dist-stats">
          <div>
            <dt>p50</dt>
            <dd>{stats.p50}ms</dd>
          </div>
          <div>
            <dt>p95</dt>
            <dd>{stats.p95}ms</dd>
          </div>
          <div>
            <dt>p99</dt>
            <dd>{stats.p99}ms</dd>
          </div>
          <div>
            <dt>Slowest paid call</dt>
            <dd>{stats.slowestPaid}ms</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
