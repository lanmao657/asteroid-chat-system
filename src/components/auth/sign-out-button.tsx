"use client";

import { useState } from "react";

import { LogOut } from "lucide-react";

import styles from "@/components/chat-workspace.module.css";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className }: { className?: string } = {}) {
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    setPending(true);

    try {
      await authClient.signOut();
      window.location.assign("/login");
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      className={className ?? styles.sidebarUtility}
      disabled={pending}
      onClick={() => {
        void handleClick();
      }}
      type="button"
    >
      <span className={styles.sidebarUtilityIcon}>
        <LogOut size={15} />
      </span>
      <span>{pending ? "退出中..." : "退出登录"}</span>
    </button>
  );
}
