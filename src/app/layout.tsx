import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Mono, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

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
  title: "小行星",
  description: "小行星是一个中文智能对话空间，聚焦简洁的历史对话管理与沉浸式聊天体验。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={cn(bodyFont.variable, monoFont.variable, "font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
