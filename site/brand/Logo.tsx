// 英文文字站标和圆环加载标记；size 的单位是像素。
import { SITE } from "../site.ts";
import wordmark from "./drama-frontline-wordmark.png?url&no-inline";

export function Wordmark({ size = 24, className = "", title = SITE.name }: { size?: number; className?: string; title?: string }) {
  return (
    <img src={wordmark} alt={title} width={2172} height={724} className={`inline-block shrink-0 object-contain brightness-0 dark:brightness-100 ${className}`} style={{ height: Math.round(size * 1.7), width: "auto" }} />
  );
}

/** A ring with a dot; spinning, it is the loader. */
export function RingMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g style={spinning ? { transformOrigin: "12px 12px", animation: "spin-slow 1.1s linear infinite" } : undefined}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="42 15" />
      </g>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}
