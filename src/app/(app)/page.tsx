import { ChatWorkspace } from "@/components/chat-workspace";
import { getSessionOrRedirect } from "@/lib/auth/session";

export default async function HomePage() {
  const session = await getSessionOrRedirect();

  return (
    <ChatWorkspace
      currentUser={{
        email: session.user.email,
        name: session.user.name || "未命名成员",
      }}
    />
  );
}
