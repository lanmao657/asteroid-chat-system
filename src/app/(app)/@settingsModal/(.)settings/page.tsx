import { connection } from "next/server";

import { SettingsModal } from "@/components/settings/settings-modal";
import { getSessionOrRedirect } from "@/lib/auth/session";

export default async function InterceptedSettingsModalPage() {
  await connection();
  const session = await getSessionOrRedirect();

  return (
    <SettingsModal
      currentUser={{
        email: session.user.email,
        name: session.user.name || "未命名用户",
      }}
    />
  );
}
