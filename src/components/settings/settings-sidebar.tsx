import type { SettingsCategoryConfig, SettingsCategoryKey } from "@/components/settings/settings-data";
import { cn } from "@/lib/utils";

export function SettingsSidebar({
  categories,
  activeCategory,
  onSelect,
}: {
  categories: SettingsCategoryConfig[];
  activeCategory: SettingsCategoryKey;
  onSelect: (category: SettingsCategoryKey) => void;
}) {
  return (
    <>
      <div className="lg:hidden">
        <div
          aria-label="设置导航"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          {categories.map((category) => {
            const Icon = category.icon;
            const active = category.key === activeCategory;

            return (
              <button
                aria-selected={active}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-black/15 bg-black/[0.05] text-black"
                    : "border-black/10 bg-white text-black/60 hover:border-black/20 hover:text-black",
                )}
                key={category.key}
                onClick={() => onSelect(category.key)}
                role="tab"
                type="button"
              >
                <Icon className="size-4" />
                {category.label}
              </button>
            );
          })}
        </div>
      </div>

      <aside className="sticky top-6 hidden h-fit lg:block">
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <div className="border-b border-black/10 px-3 pb-5 pt-2">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-black/35">
              设置
            </div>
            <p className="mt-3 text-sm leading-6 text-black/58">
              当前页面保留文档上传管理和账号信息两个核心功能。
            </p>
          </div>

          <nav aria-label="设置导航" className="space-y-1.5 px-1 pt-5">
            {categories.map((category) => {
              const Icon = category.icon;
              const active = category.key === activeCategory;

              return (
                <button
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-black/12 bg-black/[0.03] text-black"
                      : "border-transparent text-black/60 hover:border-black/10 hover:bg-black/[0.02] hover:text-black",
                  )}
                  key={category.key}
                  onClick={() => onSelect(category.key)}
                  type="button"
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex size-9 items-center justify-center rounded-lg border transition-colors",
                      active
                        ? "border-black/12 bg-white text-black"
                        : "border-black/10 bg-white text-black/60",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium tracking-tight">{category.label}</span>
                    <span className="mt-1 block text-xs leading-5 opacity-75">
                      {category.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}
