import type { Metadata } from "next";
import { connection } from "next/server";

import { SettingsPage } from "@/components/settings/settings-page";
import { getSessionOrRedirect } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "设置 | 内部知识助手",
  description: "上传并管理知识文档，同时查看当前账号信息。",
};

export default async function SettingsRoutePage() {
  await connection();
  const session = await getSessionOrRedirect();

  return (
    <SettingsPage
      currentUser={{
        email: session.user.email,
        name: session.user.name || "未命名用户",
      }}
    />
  );
}
