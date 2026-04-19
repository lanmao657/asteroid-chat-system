import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("renders the login card with concise copy", () => {
    const html = renderToStaticMarkup(<AuthFormCard mode="login" />);

    expect(html).toContain(`>\u767b\u5f55<`);
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain("\u53bb\u6ce8\u518c");
    expect(html).not.toContain("\u7ee7\u7eed\u4f7f\u7528\u4f60\u7684\u5de5\u4f5c\u7a7a\u95f4");
  });

  it("renders the register card with name and confirm password fields", () => {
    const html = renderToStaticMarkup(<AuthFormCard mode="register" />);

    expect(html).toContain(`>\u6ce8\u518c<`);
    expect(html).toContain('name="name"');
    expect(html).toContain('name="confirmPassword"');
    expect(html).toContain("\u53bb\u767b\u5f55");
    expect(html).not.toContain("\u53ea\u9700\u8981\u51e0\u9879\u4fe1\u606f\uff0c\u5c31\u80fd\u5f00\u59cb\u4f7f\u7528");
  });
});
