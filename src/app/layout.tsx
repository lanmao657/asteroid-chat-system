import type { Metadata } from "next";
import { DM_Sans, Geist, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const bodyFont = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Asteroid Chat",
  description:
    "Asteroid Chat 是一个桌面端智能对话工作台，保留 agent、检索与工具能力，同时提供更成熟的聊天产品体验。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={cn(bodyFont.variable, monoFont.variable, "font-sans", geist.variable)}
      lang="zh-CN"
    >
      <body>{children}</body>
    </html>
  );
}
