"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SettingsPage, type SettingsPageProps } from "@/components/settings/settings-page";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SettingsModal(props: Omit<SettingsPageProps, "presentation" | "onRequestClose">) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  const handleClose = () => {
    setOpen(false);

    window.setTimeout(() => {
      if (window.history.length > 1) {
        router.back();
        return;
      }

      router.push("/");
    }, 120);
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="h-[min(820px,calc(100dvh-28px))] w-[calc(100vw-16px)] max-w-[960px] overflow-hidden rounded-[28px] border border-black/[0.08] bg-white p-0 shadow-[0_26px_72px_rgba(15,23,42,0.14)] sm:h-[min(820px,calc(100dvh-48px))] sm:w-[calc(100vw-36px)]"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <SettingsPage {...props} onRequestClose={handleClose} presentation="modal" />
      </DialogContent>
    </Dialog>
  );
}
