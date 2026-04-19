import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsSection({
  title,
  description,
  children,
  className,
  headerClassName,
  contentClassName,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden", className)}>
      <div className={cn("pb-4", headerClassName)}>
        <h2 className="text-[1.05rem] font-medium tracking-[-0.02em] text-[#1f1f1d]">{title}</h2>
        {description ? (
          <p className="mt-2 text-sm leading-7 text-black/56">{description}</p>
        ) : null}
      </div>
      <div className={cn(contentClassName)}>{children}</div>
    </section>
  );
}
