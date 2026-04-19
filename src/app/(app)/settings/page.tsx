import type { Metadata } from "next";
import { connection } from "next/server";

import { SettingsPage } from "@/components/settings/settings-page";
import { getSessionOrRedirect } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "设置 | 内部知识助手",
  description: "管理知识库文档，并查看当前登录账号资料。",
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
      presentation="page"
    />
  );
}
