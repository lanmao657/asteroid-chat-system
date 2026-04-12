import "server-only";

import { cache } from "react";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, ensureAuthSchema, type AppAuthSession } from "@/lib/auth";

const loginPath = "/login";
const homePath = "/";

export const getSession = cache(async (): Promise<AppAuthSession | null> => {
  await ensureAuthSchema();
  const requestHeaders = await headers();
  return auth.api.getSession({
    headers: requestHeaders,
  });
});

export const getSessionFromHeaders = async (
  requestHeaders: Headers,
): Promise<AppAuthSession | null> => {
  await ensureAuthSchema();
  return auth.api.getSession({
    headers: requestHeaders,
  });
};

export const getSessionOrRedirect = async () => {
  const session = await getSession();
  if (!session) {
    redirect(loginPath);
  }
  return session;
};

export const redirectIfAuthenticated = async () => {
  const session = await getSession();
  if (session) {
    redirect(homePath);
  }
};

export const requireApiSession = async (request: Request) => {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) {
    return {
      response: Response.json(
        {
          error: "Authentication required.",
        },
        { status: 401 },
      ),
      session: null,
    };
  }

  return {
    response: null,
    session,
  };
};
