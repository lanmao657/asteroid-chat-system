import { toNextJsHandler } from "better-auth/next-js";

import { auth, ensureAuthSchema } from "@/lib/auth";

const nextAuthHandler = toNextJsHandler(auth);

const withSchema = (handler: (request: Request) => Promise<Response>) => {
  return async (request: Request) => {
    await ensureAuthSchema();
    return handler(request);
  };
};

export const GET = withSchema(nextAuthHandler.GET);
export const POST = withSchema(nextAuthHandler.POST);
export const PATCH = withSchema(nextAuthHandler.PATCH);
export const PUT = withSchema(nextAuthHandler.PUT);
export const DELETE = withSchema(nextAuthHandler.DELETE);
