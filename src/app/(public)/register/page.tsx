import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { redirectIfAuthenticated } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "注册 | 北辰知识助手",
  description: "注册北辰知识助手账号，进入企业知识工作台。",
};

export default async function RegisterPage() {
  await redirectIfAuthenticated();

  return <AuthShell mode="register" />;
}
