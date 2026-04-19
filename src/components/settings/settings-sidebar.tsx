import { X } from "lucide-react";

import type { SettingsCategoryConfig, SettingsCategoryKey } from "@/components/settings/settings-data";
import { cn } from "@/lib/utils";

type SettingsSidebarPresentation = "modal" | "page";

interface SettingsSidebarProps {
  categories: SettingsCategoryConfig[];
  activeCategory: SettingsCategoryKey;
  onSelect: (category: SettingsCategoryKey) => void;
  presentation?: SettingsSidebarPresentation;
  onRequestClose?: () => void;
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="关闭设置"
      className="inline-flex size-10 items-center justify-center rounded-full text-[#151515] transition-colors hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
      onClick={onClick}
      type="button"
    >
      <X className="size-5" strokeWidth={2} />
    </button>
  );
}

export function SettingsSidebar({
  categories,
  activeCategory,
  onSelect,
  presentation = "page",
  onRequestClose,
}: SettingsSidebarProps) {
  const isModal = presentation === "modal";

  return (
    <>
      <div className="settings-ui border-b border-black/[0.06] bg-[#f7f6f3] px-4 py-4 md:hidden">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[1.05rem] font-medium tracking-[-0.02em] text-[#1b1b1a]">设置</div>
          {onRequestClose ? <CloseButton onClick={onRequestClose} /> : null}
        </div>

        <div
          aria-label="设置导航"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          {categories.map((category) => {
            const Icon = category.icon;
            const active = category.key === activeCategory;

            return (
              <button
                aria-selected={active}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2.5 rounded-full px-4 py-3 text-[0.98rem] font-medium text-[#1f1f1d] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20",
                  active ? "bg-[#ecebe7]" : "bg-white hover:bg-black/[0.04]",
                )}
                key={category.key}
                onClick={() => onSelect(category.key)}
                role="tab"
                type="button"
              >
                <Icon className="size-[1.05rem]" strokeWidth={2} />
                <span>{category.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <aside
        className={cn(
          "settings-ui hidden md:flex md:h-full md:flex-col md:bg-[#f7f6f3]",
          isModal
            ? "border-r border-black/[0.06] px-2 py-5"
            : "rounded-l-[28px] border-r border-black/[0.06] px-2 py-5",
        )}
      >
        <div className="px-4 pb-5">
          {onRequestClose ? <CloseButton onClick={onRequestClose} /> : null}
        </div>

        <nav aria-label="设置导航" className="flex flex-col gap-2 px-2" role="tablist">
          {categories.map((category) => {
            const Icon = category.icon;
            const active = category.key === activeCategory;

            return (
              <button
                aria-current={active ? "page" : undefined}
                aria-selected={active}
                className={cn(
                  "flex w-full items-center gap-3.5 rounded-[18px] px-4 py-4 text-left text-[1.08rem] font-medium leading-none tracking-[-0.02em] text-[#1f1f1d] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20",
                  active ? "bg-[#ecebe7]" : "hover:bg-black/[0.035]",
                )}
                key={category.key}
                onClick={() => onSelect(category.key)}
                role="tab"
                type="button"
              >
                <Icon className="size-[1.28rem] shrink-0" strokeWidth={2} />
                <span>{category.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
