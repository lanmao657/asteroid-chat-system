import type { ReactNode } from "react";

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-black/10 bg-white">
      <div className="border-b border-black/10 px-6 py-6 sm:px-8">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-black/35">
          设置分区
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-black">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-black/58">{description}</p>
      </div>
      <div className="divide-y divide-black/10">{children}</div>
    </section>
  );
}
