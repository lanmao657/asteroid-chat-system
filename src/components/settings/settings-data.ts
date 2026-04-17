import type { LucideIcon } from "lucide-react";
import { Database, UserRound } from "lucide-react";

export type SettingsCategoryKey = "account" | "files";

export interface SettingsCategoryConfig {
  key: SettingsCategoryKey;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const SETTINGS_CATEGORIES: SettingsCategoryConfig[] = [
  {
    key: "files",
    label: "文档管理",
    description: "上传并管理知识文档",
    icon: Database,
  },
  {
    key: "account",
    label: "账号信息",
    description: "查看资料与当前登录状态",
    icon: UserRound,
  },
];
