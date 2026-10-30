import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { hoverMarqueeMetrics } from "../core/hover-marquee";

type MarqueeStyle = CSSProperties & {
  "--hover-marquee-distance": string;
  "--hover-marquee-duration": string;
};

export function HoverMarqueeText({ text }: { text: string }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const runnerRef = useRef<HTMLSpanElement>(null);
  const [distancePx, setDistancePx] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const runner = runnerRef.current;
    if (!viewport || !runner) return;

    const measure = () => {
      const metrics = hoverMarqueeMetrics(runner.scrollWidth, viewport.clientWidth);
      setDistancePx((current) => current === metrics.distancePx ? current : metrics.distancePx);
      setDurationSeconds((current) => current === metrics.durationSeconds ? current : metrics.durationSeconds);
    };

    measure();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(runner);
    window.addEventListener("resize", measure);

    let cancelled = false;
    if (document.fonts) {
      void document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [text]);

  const style: MarqueeStyle = {
    "--hover-marquee-distance": `${distancePx}px`,
    "--hover-marquee-duration": `${durationSeconds}s`,
  };

  return (
    <span ref={viewportRef} className={`project-path-viewport ${distancePx > 0 ? "is-overflowing" : ""}`.trim()}>
      <span className="project-path-static">{text}</span>
      <span ref={runnerRef} className="project-path-runner" aria-hidden="true" style={style}>{text}</span>
    </span>
  );
}
