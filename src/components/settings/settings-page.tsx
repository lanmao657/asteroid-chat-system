"use client";

import { useRef, useState } from "react";

import { Mail, Settings2, ShieldCheck, UserRound } from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { KnowledgeWorkspace } from "@/components/knowledge/knowledge-workspace";
import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryKey,
} from "@/components/settings/settings-data";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";

interface SettingsPageProps {
  currentUser: {
    email: string;
    name: string;
  };
  initialSection?: SettingsCategoryKey;
}

export function SettingsPage({
  currentUser,
  initialSection = "files",
}: SettingsPageProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryKey>(initialSection);
  const filesRef = useRef<HTMLDivElement | null>(null);
  const accountRef = useRef<HTMLDivElement | null>(null);

  const handleSelect = (category: SettingsCategoryKey) => {
    setActiveCategory(category);

    const target = category === "files" ? filesRef.current : accountRef.current;
    target?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="min-h-screen bg-[#f4f3ef] text-black">
      <div className="mx-auto flex min-h-screen w-full max-w-[1380px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
          <SettingsSidebar
            activeCategory={activeCategory}
            categories={SETTINGS_CATEGORIES}
            onSelect={handleSelect}
          />

          <main className="min-w-0">
            <div className="mx-auto w-full max-w-5xl">
              <header className="border-b border-black/10 pb-8">
                <div className="flex flex-col gap-5">
                  <div className="max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-1 text-[0.68rem] font-semibold tracking-[0.24em] text-black/45">
                      <Settings2 className="size-3.5" />
                      设置
                    </div>
                    <h1 className="mt-5 text-3xl font-semibold tracking-tight text-black sm:text-[2.5rem]">
                      文档管理
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-black/60 sm:text-base">
                      在这里上传知识文档、查看处理状态，并维护当前登录账号的信息。
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 text-sm text-black/58 sm:flex-row sm:flex-wrap sm:gap-6">
                    <div className="text-black/58">
                      当前定位：{activeCategory === "files" ? "文档管理" : "账号信息"}
                    </div>
                    <div className="text-black/58">工作区：知识管理与账号维护</div>
                  </div>
                </div>
              </header>

              <div className="mt-8 space-y-8">
                <div className="scroll-mt-6" ref={filesRef}>
                  <KnowledgeWorkspace embedded />
                </div>

                <div className="scroll-mt-6" ref={accountRef}>
                  <SettingsSection
                    description="查看当前登录账号，并通过现有的真实认证流程安全退出。"
                    title="账号信息"
                  >
                    <div className="grid divide-y divide-black/10 md:grid-cols-2 md:divide-x md:divide-y-0">
                      <div className="px-6 py-6 sm:px-8">
                        <div className="flex items-start gap-4">
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white">
                            <UserRound className="size-4 text-black" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-black/38">
                              用户名称
                            </div>
                            <div className="mt-3 text-lg font-semibold tracking-tight text-black">
                              {currentUser.name}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-black/55">
                              当前显示的是账号资料中的名称信息。
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="px-6 py-6 sm:px-8">
                        <div className="flex items-start gap-4">
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white">
                            <Mail className="size-4 text-black" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-black/38">
                              登录邮箱
                            </div>
                            <div className="mt-3 break-all text-lg font-semibold tracking-tight text-black">
                              {currentUser.email}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-black/55">
                              邮箱用于识别当前登录账号与受保护工作区会话。
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                      <div className="max-w-2xl">
                        <div className="flex size-11 items-center justify-center rounded-lg border border-black/10 bg-white">
                          <ShieldCheck className="size-4 text-black" />
                        </div>
                        <div className="mt-5 text-lg font-semibold tracking-tight text-black">登录状态</div>
                        <p className="mt-2 text-sm leading-7 text-black/58">
                          当前账号已连接到受保护工作区，退出后将返回登录页面。
                        </p>
                      </div>
                      <SignOutButton className="inline-flex min-h-11 items-center justify-center rounded-lg border border-black bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black/90" />
                    </div>
                  </SettingsSection>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
