import { useLayoutEffect, useRef } from "react";
import { DUR, EASE, gsap, reducedMotion } from "../lib/motion";

function armDraw(el: SVGGeometryElement | null) {
  if (!el) return 0;
  const len = el.getTotalLength();
  el.style.strokeDasharray = `${len}`;
  el.style.strokeDashoffset = `${len}`;
  return len;
}

export function HeroDraw() {
  const root = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg) return;

    const lines = gsap.utils.toArray<SVGGeometryElement>("[data-draw]", svg);
    const nodes = gsap.utils.toArray<SVGElement>("[data-node]", svg);
    const labels = gsap.utils.toArray<SVGElement>("[data-label]", svg);
    const packet = svg.querySelector<SVGCircleElement>("[data-packet]");
    const needle = svg.querySelector<SVGElement>("[data-needle]");
    const missX = gsap.utils.toArray<SVGGeometryElement>("[data-miss]", svg);
    const tick = svg.querySelector<SVGGeometryElement>("[data-tick]");
    const spine = svg.querySelector<SVGGeometryElement>("[data-spine]");
    const missPath = svg.querySelector<SVGGeometryElement>("[data-miss-path]");

    if (reducedMotion()) {
      gsap.set([...lines, ...missX], { strokeDashoffset: 0 });
      gsap.set([...nodes, ...labels], { opacity: 1, scale: 1 });
      if (packet) gsap.set(packet, { opacity: 0 });
      return;
    }

    lines.forEach((el) => armDraw(el));
    missX.forEach((el) => armDraw(el));
    gsap.set(nodes, { opacity: 0, scale: 0.72, transformOrigin: "center" });
    gsap.set(labels, { opacity: 0 });
    if (packet) gsap.set(packet, { opacity: 0 });
    gsap.set(missX, { opacity: 0 });

    const ctx = gsap.context(() => {
      const intro = gsap.timeline({ defaults: { ease: EASE } });

      intro.to(lines, {
        strokeDashoffset: 0,
        duration: 0.95,
        stagger: 0.016,
        ease: "power2.inOut",
      });
      intro.to(
        nodes,
        { opacity: 1, scale: 1, duration: DUR.base, stagger: 0.05 },
        0.28,
      );
      intro.to(labels, { opacity: 1, duration: DUR.fast, stagger: 0.04 }, 0.55);

      const loop = gsap.timeline({ repeat: -1, repeatDelay: 0.45, delay: 0.2 });

      const travel = (path: SVGGeometryElement | null, color: string, dur: number) => {
        if (!packet || !path) return;
        const len = path.getTotalLength();
        const state = { t: 0 };
        loop.set(packet, { opacity: 1, fill: color }, ">");
        loop.to(
          state,
          {
            t: 1,
            duration: dur,
            ease: "none",
            onUpdate: () => {
              const p = path.getPointAtLength(state.t * len);
              gsap.set(packet, { attr: { cx: p.x, cy: p.y } });
            },
          },
          "<",
        );
      };

      // Healthy: packet rides the spine, needle stays inside the budget, tick draws.
      loop.addLabel("ok");
      loop.set(missX, { opacity: 0, strokeDashoffset: (i, el) => armDraw(el as SVGGeometryElement) });
      if (needle) {
        loop.fromTo(needle, { rotate: -42 }, { rotate: 8, duration: 0.7, ease: "power2.out", svgOrigin: "280 118" }, "ok");
      }
      travel(spine, "#FCFF52", 1.15);
      if (tick) {
        loop.to(tick, { strokeDashoffset: 0, duration: 0.28, ease: "power2.out" }, ">-0.15");
      }
      loop.to(packet, { opacity: 0, duration: 0.2 }, ">");
      loop.to({}, { duration: 0.55 });

      // Breach: packet dies on the miss path, X draws, needle overruns.
      loop.addLabel("bad");
      if (needle) {
        loop.to(needle, { rotate: 52, duration: 0.85, ease: "power3.inOut" }, "bad");
      }
      travel(missPath, "#e07a4c", 0.95);
      loop.set(missX, { opacity: 1 }, ">-0.2");
      loop.to(missX, { strokeDashoffset: 0, duration: 0.32, stagger: 0.04, ease: "power2.out" }, "<");
      loop.to(packet, { opacity: 0, duration: 0.18 }, ">");
      loop.to({}, { duration: 0.7 });
      if (tick) {
        loop.set(tick, { strokeDashoffset: () => (tick ? tick.getTotalLength() : 0) });
      }
    }, svg);

    return () => ctx.revert();
  }, []);

  return (
    <svg
      ref={root}
      className="hero-draw"
      viewBox="0 0 560 520"
      fill="none"
      aria-hidden="true"
    >
      {/* Ruled field, drawn first so the diagram has a surface. */}
      <g stroke="#1c1c1c" strokeWidth="1">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={`v${i}`} data-draw x1={40 + i * 44} y1="24" x2={40 + i * 44} y2="496" />
        ))}
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`h${i}`} data-draw x1="24" y1={40 + i * 44} x2="536" y2={40 + i * 44} />
        ))}
      </g>

      {/* Latency gauge */}
      <circle data-draw cx="280" cy="118" r="54" stroke="#2a2a2a" strokeWidth="1.25" />
      <circle data-draw cx="280" cy="118" r="54" stroke="#FCFF52" strokeWidth="1.5" strokeDasharray="84 255" strokeLinecap="round" />
      <line data-needle x1="280" y1="118" x2="280" y2="72" stroke="#FCFF52" strokeWidth="1.5" strokeLinecap="round" />
      <circle data-node cx="280" cy="118" r="4" fill="#FCFF52" />

      {/* Protocol spine: GET → 402 → pay → receipt → escrow */}
      <path
        data-draw
        data-spine
        d="M96 248 H216 C236 248 244 260 244 280 V332 C244 352 256 364 276 364 H464"
        stroke="#cfcfc4"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        data-draw
        data-miss-path
        d="M244 308 H216 C168 308 152 330 152 368 V412"
        stroke="#e07a4c"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="5 6"
      />

      {/* Return 402 */}
      <path
        data-draw
        d="M216 248 C216 214 160 206 118 206"
        stroke="#8a8a7e"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* Nodes */}
      <rect data-node x="56" y="226" width="80" height="44" rx="10" stroke="#cfcfc4" strokeWidth="1.25" fill="#000" />
      <rect data-node x="176" y="226" width="80" height="44" rx="10" stroke="#cfcfc4" strokeWidth="1.25" fill="#000" />
      <rect data-node x="424" y="342" width="88" height="44" rx="10" stroke="#FCFF52" strokeWidth="1.25" fill="#000" />
      <rect data-node x="112" y="400" width="80" height="44" rx="10" stroke="#e07a4c" strokeWidth="1.25" fill="#000" />

      {/* Escrow plate, our mark language */}
      <g data-node transform="translate(430 78)">
        <rect width="56" height="56" rx="14" fill="#16308F" />
        <polygon fill="#F4F1E8" points="16,12 16,26 23,26 23,16" />
        <polygon fill="#F4F1E8" points="25,17 44,28 25,26" />
        <polygon fill="#F4F1E8" points="16,29 16,44 23,40 23,29" />
        <polygon fill="#F4F1E8" points="25,29 44,28 25,38" />
      </g>

      {/* Check / miss */}
      <path data-tick data-draw d="M436 360 l8 8 16 -16" stroke="#FCFF52" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path data-miss d="M132 414 l28 28" stroke="#e07a4c" strokeWidth="1.7" strokeLinecap="round" />
      <path data-miss d="M160 414 l-28 28" stroke="#e07a4c" strokeWidth="1.7" strokeLinecap="round" />

      <circle data-packet cx="96" cy="248" r="4.5" fill="#FCFF52" />

      <g fill="#9a9a8e" fontFamily="Varela Round, sans-serif" fontSize="11" letterSpacing="0.12em">
        <text data-label x="280" y="28" textAnchor="middle">
          800ms
        </text>
        <text data-label x="96" y="218" textAnchor="middle">
          BUYER
        </text>
        <text data-label x="216" y="218" textAnchor="middle">
          SELLER
        </text>
        <text data-label x="468" y="332" textAnchor="middle">
          ACK / PAID
        </text>
        <text data-label x="152" y="392" textAnchor="middle">
          NO ACK
        </text>
        <text data-label x="458" y="148" textAnchor="middle">
          ESCROW
        </text>
      </g>
      <g fill="#d8d8ce" fontFamily="Varela Round, sans-serif" fontSize="13">
        <text data-label x="96" y="253" textAnchor="middle">
          GET
        </text>
        <text data-label x="216" y="253" textAnchor="middle">
          402
        </text>
        <text data-label x="468" y="369" textAnchor="middle">
          0.001
        </text>
        <text data-label x="152" y="427" textAnchor="middle">
          0.000
        </text>
      </g>
    </svg>
  );
}
