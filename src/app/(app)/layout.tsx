import type { ReactNode } from "react";

export default function AppLayout({
  children,
  settingsModal,
}: {
  children: ReactNode;
  settingsModal: ReactNode;
}) {
  return (
    <>
      {children}
      {settingsModal}
    </>
  );
}
