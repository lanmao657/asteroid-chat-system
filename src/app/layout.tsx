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
  title: "北辰知识助手",
  description:
    "北辰知识助手是一个面向企业培训、制度问答和内部知识检索的桌面端智能工作台。",
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
