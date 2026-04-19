"use client";

import { useState } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { KnowledgeWorkspace } from "@/components/knowledge/knowledge-workspace";
import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryConfig,
  type SettingsCategoryKey,
} from "@/components/settings/settings-data";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { cn } from "@/lib/utils";

export type SettingsPresentation = "modal" | "page";

export interface SettingsPageProps {
  currentUser: {
    email: string;
    name: string;
  };
  initialSection?: SettingsCategoryKey;
  presentation?: SettingsPresentation;
  onRequestClose?: () => void;
}

function AccountSettingRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-2 border-t border-black/[0.06] py-5 md:grid-cols-[minmax(0,1fr)_minmax(190px,232px)] md:items-start md:gap-7">
      <div className="min-w-0">
        <div className="text-[1.02rem] font-medium tracking-[-0.02em] text-[#20201e]">{label}</div>
      </div>
      <div className="min-w-0 text-left text-[1rem] leading-7 text-[#20201e] md:text-right">
        {value}
      </div>
    </div>
  );
}

function AccountSettingsPanel({ currentUser }: { currentUser: SettingsPageProps["currentUser"] }) {
  return (
    <div className="flex flex-col gap-5">
      <SettingsSection title="账号">
        <div>
          <AccountSettingRow label="姓名" value={currentUser.name} />
          <AccountSettingRow label="邮箱" value={currentUser.email} />
          <AccountSettingRow label="状态" value="已登录" />
        </div>
        <div className="border-t border-black/[0.06] pt-5">
          <SignOutButton className="inline-flex min-h-11 items-center justify-center rounded-full border border-black/[0.12] bg-white px-5 text-[0.98rem] font-medium text-[#1c1c1a] transition-colors hover:bg-black/[0.02]" />
        </div>
      </SettingsSection>
    </div>
  );
}

export function SettingsPage({
  currentUser,
  initialSection = "files",
  presentation = "page",
  onRequestClose,
}: SettingsPageProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryKey>(initialSection);
  const activeCategoryConfig: SettingsCategoryConfig =
    SETTINGS_CATEGORIES.find((category) => category.key === activeCategory) ??
    SETTINGS_CATEGORIES[0];

  const activePanel =
    activeCategory === "files" ? (
      <KnowledgeWorkspace presentation="settings" />
    ) : (
      <AccountSettingsPanel currentUser={currentUser} />
    );

  const shell = (
    <div
      className={cn(
        "settings-ui min-h-0 text-[#1d1d1b]",
        presentation === "modal"
          ? "flex h-full flex-col md:grid md:grid-cols-[246px_minmax(0,1fr)]"
          : "grid min-h-[calc(100vh-3rem)] overflow-hidden rounded-[28px] border border-black/[0.08] bg-white shadow-[0_14px_40px_rgba(15,23,42,0.08)] md:grid-cols-[246px_minmax(0,1fr)]",
      )}
      data-active-category={activeCategory}
      data-presentation={presentation}
    >
      <SettingsSidebar
        activeCategory={activeCategory}
        categories={SETTINGS_CATEGORIES}
        onRequestClose={onRequestClose}
        onSelect={setActiveCategory}
        presentation={presentation}
      />

      <main className="flex min-h-0 flex-col bg-white">
        <header className="border-b border-black/[0.06] px-6 pb-4 pt-6 sm:px-7 sm:pb-5 sm:pt-7">
          <div className="text-[0.82rem] font-medium uppercase tracking-[0.18em] text-black/45">
            北辰知识助手
          </div>
          <h1 className="text-[1.75rem] font-medium leading-none tracking-[-0.04em] text-[#1a1a18] sm:text-[1.9rem]">
            {activeCategoryConfig.label}
          </h1>
        </header>

        <div className="settings-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 sm:py-6">
          {activePanel}
        </div>
      </main>
    </div>
  );

  if (presentation === "modal") {
    return shell;
  }

  return (
    <div className="min-h-screen bg-[#efeeea] px-4 py-6 text-[#1d1d1b] sm:px-6">
      <div className="mx-auto max-w-[960px]">{shell}</div>
    </div>
  );
}
