"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { LogOut } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import styles from "@/components/chat-workspace.module.css";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    setPending(true);

    try {
      await authClient.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      className={styles.sidebarUtility}
      disabled={pending}
      onClick={() => {
        void handleClick();
      }}
      type="button"
    >
      <span className={styles.sidebarUtilityIcon}>
        <LogOut size={15} />
      </span>
      <span>{pending ? "正在退出..." : "退出登录"}</span>
    </button>
  );
}
