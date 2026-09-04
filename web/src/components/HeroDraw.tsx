import { useId, useLayoutEffect, useRef } from "react";
import { EASE, gsap, reducedMotion } from "../lib/motion";

function armDraw(el: SVGGeometryElement | null) {
  if (!el) return 0;
  const len = el.getTotalLength();
  el.style.strokeDasharray = `${len}`;
  el.style.strokeDashoffset = `${len}`;
  return len;
}

function travel(
  loop: gsap.core.Timeline,
  packet: SVGCircleElement | null,
  path: SVGGeometryElement | null,
  color: string,
  dur: number,
  at: string,
) {
  if (!packet || !path) return;
  const len = path.getTotalLength();
  const state = { t: 0 };
  loop.set(packet, { opacity: 1, fill: color, attr: { r: 2.6 } }, at);
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
    at,
  );
}

function drawStroke(
  tl: gsap.core.Timeline,
  el: SVGGeometryElement | null,
  pen: SVGCircleElement | null,
  dur: number,
  at: string,
) {
  if (!el) return;
  const len = el.getTotalLength();
  const state = { t: 0 };
  tl.to(el, { strokeDashoffset: 0, duration: dur, ease: "power2.inOut" }, at);
  if (!pen) return;
  tl.set(pen, { opacity: 1 }, at);
  tl.to(
    state,
    {
      t: 1,
      duration: dur,
      ease: "power2.inOut",
      onUpdate: () => {
        const p = el.getPointAtLength(state.t * len);
        gsap.set(pen, { attr: { cx: p.x, cy: p.y } });
      },
    },
    at,
  );
}

const GAUGE = { cx: 448, cy: 100, r: 46 };

function gaugeTicks() {
  const start = -140;
  const sweep = 280;
  return Array.from({ length: 15 }, (_, i) => {
    const deg = start + (sweep * i) / 14;
    const a = (deg * Math.PI) / 180;
    const inner = i % 2 === 0 ? GAUGE.r - 9 : GAUGE.r - 5;
    return {
      x1: GAUGE.cx + Math.cos(a) * inner,
      y1: GAUGE.cy + Math.sin(a) * inner,
      x2: GAUGE.cx + Math.cos(a) * GAUGE.r,
      y2: GAUGE.cy + Math.sin(a) * GAUGE.r,
    };
  });
}

export function HeroDraw() {
  const root = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, "");

  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg) return;

    const wires = gsap.utils.toArray<SVGGeometryElement>("[data-wire]", svg);
    const packets = gsap.utils.toArray<SVGCircleElement>("[data-packet]", svg);
    const waveOk = svg.querySelector<SVGGeometryElement>("[data-wave-ok]");
    const waveBad = svg.querySelector<SVGGeometryElement>("[data-wave-bad]");
    const clip = svg.querySelector<SVGRectElement>("[data-clip]");
    const scan = svg.querySelector<SVGLineElement>("[data-scan]");
    const needle = svg.querySelector<SVGLineElement>("[data-needle]");
    const pen = svg.querySelector<SVGCircleElement>("[data-pen]");
    const check = svg.querySelector<SVGGeometryElement>("[data-check]");
    const miss = gsap.utils.toArray<SVGGeometryElement>("[data-miss]", svg);
    const okBits = gsap.utils.toArray<SVGElement>("[data-ok-bit]", svg);
    const badBits = gsap.utils.toArray<SVGElement>("[data-bad-bit]", svg);
    const payPath = svg.querySelector<SVGGeometryElement>("[data-pay]");
    const missPath = svg.querySelector<SVGGeometryElement>("[data-fail]");
    const getPath = svg.querySelector<SVGGeometryElement>("[data-get]");
    const termsPath = svg.querySelector<SVGGeometryElement>("[data-terms]");

    const drawables = [...wires, waveOk, waveBad, check, ...miss].filter(Boolean) as SVGGeometryElement[];

    const showRest = () => {
      gsap.set(drawables, { strokeDashoffset: 0 });
      gsap.set(okBits, { opacity: 1 });
      gsap.set(badBits, { opacity: 0 });
      gsap.set(packets, { opacity: 0 });
      if (pen) gsap.set(pen, { opacity: 0 });
      if (clip) gsap.set(clip, { attr: { width: 332 } });
      if (waveOk) gsap.set(waveOk, { opacity: 1 });
      if (waveBad) gsap.set(waveBad, { opacity: 0 });
      if (scan) gsap.set(scan, { opacity: 0.35 });
      if (check) gsap.set(check, { opacity: 1 });
    };

    if (reducedMotion()) {
      showRest();
      return;
    }

    drawables.forEach(armDraw);
    gsap.set(packets, { opacity: 0 });
    gsap.set(okBits, { opacity: 0 });
    gsap.set(badBits, { opacity: 0 });
    gsap.set(miss, { opacity: 0 });
    if (check) gsap.set(check, { opacity: 0 });
    if (pen) gsap.set(pen, { opacity: 0 });
    if (clip) gsap.set(clip, { attr: { width: 0 } });
    if (waveOk) gsap.set(waveOk, { opacity: 1 });
    if (waveBad) gsap.set(waveBad, { opacity: 0 });
    if (scan) gsap.set(scan, { opacity: 0 });
    if (needle) gsap.set(needle, { rotate: -132, svgOrigin: `${GAUGE.cx} ${GAUGE.cy}` });

    const ctx = gsap.context(() => {
      const intro = gsap.timeline({ defaults: { ease: EASE } });
      wires.forEach((wire, i) => {
        drawStroke(intro, wire, pen, 0.42, `${0.08 + i * 0.16}`);
      });
      intro.to(pen, { opacity: 0, duration: 0.16 }, 0.82);

      const loop = gsap.timeline({ repeat: -1, delay: 0.15 });

      loop.addLabel("ok");
      loop.set(badBits, { opacity: 0 });
      loop.set(miss, { opacity: 0, strokeDashoffset: (_i, el) => armDraw(el as SVGGeometryElement) });
      if (waveOk && waveBad) {
        loop.set(waveBad, { opacity: 0 });
        loop.set(waveOk, { opacity: 1, strokeDashoffset: () => armDraw(waveOk) });
        loop.to(waveOk, { strokeDashoffset: 0, duration: 1.45, ease: "none" }, "ok");
      }
      if (clip) {
        loop.set(clip, { attr: { width: 0 } }, "ok");
        loop.to(clip, { attr: { width: 332 }, duration: 1.45, ease: "none" }, "ok");
      }
      if (scan) {
        loop.fromTo(
          scan,
          { attr: { x1: 52, x2: 52 }, opacity: 0.55 },
          { attr: { x1: 380, x2: 380 }, duration: 1.45, ease: "none" },
          "ok",
        );
      }
      if (needle) {
        loop.to(needle, { rotate: -118, duration: 1.1, ease: "power2.out", svgOrigin: `${GAUGE.cx} ${GAUGE.cy}` }, "ok");
      }
      travel(loop, packets[0] ?? null, getPath, "#FCFF52", 0.28, "ok+=0.2");
      travel(loop, packets[1] ?? null, termsPath, "#cfcfc4", 0.28, "ok+=0.5");
      travel(loop, packets[0] ?? null, payPath, "#FCFF52", 0.36, "ok+=0.82");
      if (check) {
        loop.set(check, { opacity: 1, strokeDashoffset: () => armDraw(check) }, "ok+=1.1");
        loop.to(check, { strokeDashoffset: 0, duration: 0.22, ease: "power2.out" }, "ok+=1.12");
      }
      loop.to(okBits, { opacity: 1, duration: 0.18, stagger: 0.04 }, "ok+=1.18");
      loop.to(packets, { opacity: 0, duration: 0.12 }, "ok+=1.5");
      loop.to({}, { duration: 0.4 });

      loop.addLabel("bad");
      loop.set(okBits, { opacity: 0 });
      if (check) loop.set(check, { opacity: 0, strokeDashoffset: () => armDraw(check) });
      if (waveOk && waveBad) {
        loop.set(waveOk, { opacity: 0 });
        loop.set(waveBad, { opacity: 1, strokeDashoffset: () => armDraw(waveBad) });
        loop.to(waveBad, { strokeDashoffset: 0, duration: 1.45, ease: "none" }, "bad");
      }
      if (clip) {
        loop.set(clip, { attr: { width: 0 } }, "bad");
        loop.to(clip, { attr: { width: 332 }, duration: 1.45, ease: "none" }, "bad");
      }
      if (scan) {
        loop.fromTo(
          scan,
          { attr: { x1: 52, x2: 52 }, opacity: 0.55 },
          { attr: { x1: 380, x2: 380 }, duration: 1.45, ease: "none" },
          "bad",
        );
      }
      if (needle) {
        loop.to(needle, { rotate: 48, duration: 0.85, ease: "power3.in", svgOrigin: `${GAUGE.cx} ${GAUGE.cy}` }, "bad+=0.35");
      }
      travel(loop, packets[0] ?? null, getPath, "#e07a4c", 0.26, "bad+=0.18");
      travel(loop, packets[1] ?? null, termsPath, "#e07a4c", 0.26, "bad+=0.46");
      travel(loop, packets[0] ?? null, missPath, "#e07a4c", 0.32, "bad+=0.76");
      loop.set(miss, { opacity: 1 }, "bad+=1.05");
      loop.to(miss, { strokeDashoffset: 0, duration: 0.22, stagger: 0.04, ease: "power2.out" }, "bad+=1.06");
      loop.to(badBits, { opacity: 1, duration: 0.18, stagger: 0.04 }, "bad+=1.12");
      loop.to(packets, { opacity: 0, duration: 0.12 }, "bad+=1.5");
      loop.to({}, { duration: 0.5 });
      if (needle) {
        loop.set(needle, { rotate: -132, svgOrigin: `${GAUGE.cx} ${GAUGE.cy}` });
      }
    }, svg);

    return () => ctx.revert();
  }, []);

  const clipId = `scope-${uid}`;
  const markId = `ah-${uid}`;
  const markHot = `ah-hot-${uid}`;
  const markBad = `ah-bad-${uid}`;

  return (
    <svg
      ref={root}
      className="hero-draw"
      viewBox="0 0 520 400"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect data-clip x="48" y="28" width="0" height="144" />
        </clipPath>
        <marker id={markId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 1 L8 4 L0 7 Z" fill="#6e6e64" />
        </marker>
        <marker id={markHot} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 1 L8 4 L0 7 Z" fill="#FCFF52" />
        </marker>
        <marker id={markBad} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 1 L8 4 L0 7 Z" fill="#e07a4c" />
        </marker>
      </defs>

      <g stroke="#1c1c1c" strokeWidth="0.75">
        {Array.from({ length: 13 }, (_, i) => (
          <line key={`v${i}`} x1={20 + i * 40} y1="8" x2={20 + i * 40} y2="392" />
        ))}
        {Array.from({ length: 10 }, (_, i) => (
          <line key={`h${i}`} x1="12" y1={12 + i * 40} x2="508" y2={12 + i * 40} />
        ))}
      </g>

      <rect x="28" y="20" width="464" height="168" rx="8" fill="#0a0a0a" stroke="#3a3a3a" strokeWidth="1.15" />
      <line x1="392" y1="28" x2="392" y2="180" stroke="#2a2a2a" strokeWidth="1" />
      <line x1="52" y1="72" x2="380" y2="72" stroke="#FCFF52" strokeWidth="0.85" strokeDasharray="3 5" opacity="0.7" />
      {[48, 72, 96, 120, 144].map((y) => (
        <line key={y} x1="48" y1={y} x2="56" y2={y} stroke="#4a4a44" strokeWidth="1" />
      ))}

      <g clipPath={`url(#${clipId})`}>
        <path
          data-wave-ok
          d="M52 124
             C 72 120 88 128 106 122
             S 140 116 158 120
             S 188 114 206 118
             S 236 124 254 116
             S 284 120 302 118
             S 332 112 350 116
             S 368 122 380 118"
          stroke="#FCFF52"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          data-wave-bad
          d="M52 122
             C 72 118 88 126 104 120
             S 128 118 142 120
             S 158 86 172 42
             S 186 28 200 78
             S 216 132 236 124
             S 268 118 300 122
             S 336 116 380 120"
          stroke="#e07a4c"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <line data-scan x1="52" y1="36" x2="52" y2="172" stroke="#FCFF52" strokeWidth="0.7" opacity="0.45" />

      <circle cx={GAUGE.cx} cy={GAUGE.cy} r="54" stroke="#3a3a3a" strokeWidth="1.15" />
      <circle cx={GAUGE.cx} cy={GAUGE.cy} r="46" stroke="#4a4a44" strokeWidth="1.2" />
      {gaugeTicks().map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#5a5a52" strokeWidth="1.1" />
      ))}
      <path
        d="M410 130 A 46 46 0 0 1 486 130"
        stroke="#FCFF52"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        data-needle
        x1={GAUGE.cx}
        y1={GAUGE.cy}
        x2={GAUGE.cx - 34}
        y2={GAUGE.cy + 18}
        stroke="#FCFF52"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx={GAUGE.cx} cy={GAUGE.cy} r="3.2" fill="#FCFF52" />

      <rect x="36" y="236" width="64" height="28" rx="7" stroke="#8a8a7e" strokeWidth="1.15" fill="#0a0a0a" />
      <rect x="148" y="236" width="64" height="28" rx="7" stroke="#8a8a7e" strokeWidth="1.15" fill="#0a0a0a" />
      <rect x="320" y="236" width="72" height="28" rx="7" stroke="#FCFF52" strokeWidth="1.15" fill="#0a0a0a" />
      <rect x="196" y="328" width="64" height="28" rx="7" stroke="#e07a4c" strokeWidth="1.15" fill="#0a0a0a" />

      <path
        data-wire
        data-get
        d="M100 250 H148"
        stroke="#8a8a7e"
        strokeWidth="1.35"
        markerEnd={`url(#${markId})`}
      />
      <path
        data-wire
        data-terms
        d="M148 250 C128 214 88 214 68 236"
        stroke="#8a8a7e"
        strokeWidth="1.35"
        markerEnd={`url(#${markId})`}
      />
      <path
        data-wire
        data-pay
        d="M212 250 H320"
        stroke="#FCFF52"
        strokeWidth="1.4"
        markerEnd={`url(#${markHot})`}
      />
      <path
        data-wire
        data-fail
        d="M180 264 C180 300 196 328 196 342"
        stroke="#e07a4c"
        strokeWidth="1.4"
        markerEnd={`url(#${markBad})`}
      />

      <path
        data-check
        d="M402 244 l5 5 10 -11"
        stroke="#FCFF52"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path data-miss d="M212 336 l20 16" stroke="#e07a4c" strokeWidth="1.4" strokeLinecap="round" />
      <path data-miss d="M232 336 l-20 16" stroke="#e07a4c" strokeWidth="1.4" strokeLinecap="round" />

      <circle data-packet cx="100" cy="250" r="2.6" fill="#FCFF52" />
      <circle data-packet cx="180" cy="250" r="2.6" fill="#cfcfc4" />
      <circle data-pen cx="28" cy="20" r="2.2" fill="#FCFF52" />

      <g
        fill="#8a8a80"
        fontFamily="Varela Round, sans-serif"
        fontSize="8"
        letterSpacing="0.16em"
      >
        <text x="40" y="36">
          LATENCY
        </text>
        <text x="380" y="68" textAnchor="end">
          800ms
        </text>
        <text x="448" y="168" textAnchor="middle">
          BUDGET
        </text>
        <text x="68" y="228" textAnchor="middle">
          BUYER
        </text>
        <text x="180" y="228" textAnchor="middle">
          SELLER
        </text>
        <text x="356" y="228" textAnchor="middle">
          ESCROW
        </text>
        <text x="228" y="320" textAnchor="middle">
          NO ACK
        </text>
      </g>

      <g fill="#d0d0c6" fontFamily="Varela Round, sans-serif" fontSize="10">
        <text x="68" y="254" textAnchor="middle">
          GET
        </text>
        <text x="180" y="254" textAnchor="middle">
          402
        </text>
        <text x="356" y="254" textAnchor="middle">
          ACK
        </text>
        <text x="228" y="346" textAnchor="middle" fill="#e07a4c">
          0
        </text>
      </g>

      <g fontFamily="Varela Round, sans-serif" fontSize="8" fontVariant="tabular-nums">
        <text data-ok-bit x="40" y="160" fill="#FCFF52">
          21ms · HTTP 200 · paid
        </text>
        <text data-bad-bit x="40" y="160" fill="#e07a4c">
          spike · HTTP 500 · charged 0
        </text>
      </g>
    </svg>
  );
}
