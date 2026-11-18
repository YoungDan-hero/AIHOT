import type { ReactNode } from "react";
import { PhoneBar } from "./PhoneBar";

export function OwnerPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      <PhoneBar title={title} back={{ to: "/more", label: "我的" }} />
      <h1 data-page-title="" className="pb-3 pt-0.5 text-[30px] font-bold leading-[1.25] tracking-[-0.01em] text-ink lg:pb-0 lg:pt-0 lg:text-[24px] lg:font-semibold lg:leading-[1.3]">
        {title}
      </h1>
      {children}
    </div>
  );
}
