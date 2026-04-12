import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: vi.fn(),
    },
    signUp: {
      email: vi.fn(),
    },
  },
}));

import { AuthFormCard } from "./auth-form-card";

describe("AuthFormCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the login card with key fields", () => {
    const html = renderToStaticMarkup(<AuthFormCard mode="login" />);

    expect(html).toContain("欢迎回来");
    expect(html).toContain("继续使用你的工作空间");
    expect(html).toContain("name=\"email\"");
    expect(html).toContain("name=\"password\"");
    expect(html).toContain("创建账号");
  });

  it("renders the register card with name and confirm password fields", () => {
    const html = renderToStaticMarkup(<AuthFormCard mode="register" />);

    expect(html).toContain("创建账号");
    expect(html).toContain("只需要几项信息，就能开始使用");
    expect(html).toContain("name=\"name\"");
    expect(html).toContain("name=\"confirmPassword\"");
    expect(html).toContain("返回登录");
  });
});
