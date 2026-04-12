import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { redirectIfAuthenticated } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "登录 | 北辰知识助手",
  description: "登录北辰知识助手，进入企业知识工作台。",
};

export default async function LoginPage() {
  await redirectIfAuthenticated();

  return <AuthShell mode="login" />;
}
