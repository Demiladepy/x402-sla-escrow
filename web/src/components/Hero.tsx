import { useLayoutEffect, useRef } from "react";
import {
  DUR,
  EASE,
  SplitText,
  gsap,
  reducedMotion,
  scrollToId,
  showNow,
} from "../lib/motion";
import type { LedgerSource } from "../lib/useLedger";
import type { State } from "../lib/types";
import { Num } from "./Num";

interface Props {
  state: State | null;
  callCount: number;
  settled: boolean;
  source: LedgerSource | null;
}

export function Hero({ state, callCount, settled, source }: Props) {
  const buyerTxs = state ? state.buyerTxCount - state.buyerTxCountAfterSetup : null;
  const root = useRef<HTMLElement>(null);

  /**
   * The one orchestrated entrance on the page.
   *
   * Everything below the fold reveals on scroll; this plays on load, because
   * the first screen is the only moment the whole audience is guaranteed to
   * share. The headline is split by line and each line clipped, so the words
   * rise out of their own measure rather than fading in place.
   *
   * Waits on `document.fonts.ready` (with a short fallback) so SplitText
   * measures the loaded face rather than the fallback, which would wrap at
   * the wrong width and then jump.
   */
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;

    let split: SplitText | undefined;
    let ctx: gsap.Context | undefined;
    let cancelled = false;
    let tick: gsap.TickerCallback | undefined;

    const play = () => {
      if (cancelled || !root.current) return;

      const parts = gsap.utils.toArray<HTMLElement>("[data-hero]", el);
      const heading = el.querySelector<HTMLElement>("[data-hero-heading]");

      if (reducedMotion()) {
        showNow(parts);
        if (heading) gsap.set(heading, { opacity: 1 });
        return;
      }

      ctx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: EASE } });

        if (heading) {
          try {
            // `mask: "lines"` wraps each line in its own clipping element, so the
            // words travel out from behind their own baseline instead of sliding
            // over the text above them.
            split = new SplitText(heading, {
              type: "lines",
              mask: "lines",
              linesClass: "hero-line",
            });
            gsap.set(heading, { opacity: 1 });
            tl.from(split.lines, {
              yPercent: 106,
              duration: DUR.slow,
              stagger: 0.085,
            });
          } catch {
            // SplitText can throw if the node is detached; failing open is the
            // correct behaviour — a static headline, not a blank one.
            gsap.set(heading, { opacity: 1 });
          }
        }

        tl.to(parts, { opacity: 1, y: 0, duration: DUR.base, stagger: 0.09 }, heading ? 0.22 : 0);

        const arrow = el.querySelector<HTMLElement>(".arrow");
        if (arrow) {
          tick = (time) => {
            gsap.set(arrow, { y: Math.sin(time * 2.1) * 3.5 });
          };
          gsap.ticker.add(tick);
        }
      }, root);
    };

    const ready = Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 400);
      }),
    ]);

    void ready.then(play);

    return () => {
      cancelled = true;
      if (tick) gsap.ticker.remove(tick);
      ctx?.revert();
      split?.revert();
    };
  }, []);

  return (
    <section className="hero wrap" ref={root}>
      <span className="eyebrow" data-hero>
        Celo · paid HTTP · stablecoin
      </span>

      <h1 data-hero-heading>Serving slowly is serving for free.</h1>

      <p className="lede" data-hero>
        An agent pays per API call. If the response misses the latency budget or returns the wrong
        status, <strong>the money never moves</strong>. The escrow re-checks the SLA itself and
        reverts. There is nothing to refund and no dispute to open.
      </p>

      <div className="hero-foot">
        <div className="claim" data-hero>
          {source === "recorded" ? (
            <p className="claim-line">
              One paid call settled on Celo Sepolia. One breach charged nothing. The buyer signed
              off-chain.
            </p>
          ) : buyerTxs === null ? (
            <p className="claim-line pending">
              {settled
                ? "The live figures on this page come from a running instance. Start it with npm run serve --workspace demo."
                : "Reading the buyer's transaction count from the chain…"}
            </p>
          ) : (
            <p className="claim-line">
              The buyer has sent <em>{buyerTxs}</em> transactions since its deposit, across{" "}
              <em>
                <Num value={callCount} />
              </em>{" "}
              paid calls.
            </p>
          )}
          <span className="claim-note">
            Authorizations are signed off-chain. Paying costs the buyer no gas and no transaction.
          </span>
        </div>

        <a
          className="jump"
          href="#call"
          data-hero
          onClick={(event) => {
            event.preventDefault();
            scrollToId("#call");
          }}
        >
          See how an agent calls it
          <span className="arrow" aria-hidden="true">
            ↓
          </span>
        </a>
      </div>
    </section>
  );
}
