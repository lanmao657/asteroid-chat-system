import { connection } from "next/server";

import { ChatWorkspace } from "@/components/chat-workspace";
import { getSessionOrRedirect } from "@/lib/auth/session";

export default async function HomePage() {
  await connection();
  await getSessionOrRedirect();

  return <ChatWorkspace />;
}
