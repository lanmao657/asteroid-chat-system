"use client";

import { startTransition, useEffect, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

import styles from "./auth-form-card.module.css";

type AuthMode = "login" | "register";

const copyByMode = {
  login: {
    eyebrow: "登录",
    title: "欢迎回来",
    description: "继续使用你的工作空间。",
    submitLabel: "继续登录",
    secondaryText: "还没有账号？",
    secondaryHref: "/register",
    secondaryLabel: "创建账号",
  },
  register: {
    eyebrow: "注册",
    title: "创建账号",
    description: "只需要几项信息，就能开始使用。",
    submitLabel: "创建并进入",
    secondaryText: "已经有账号？",
    secondaryHref: "/login",
    secondaryLabel: "返回登录",
  },
} as const;

const defaultRegisterError = "注册失败，请检查邮箱是否已存在或稍后重试。";
const defaultLoginError = "登录失败，请确认邮箱和密码是否正确。";

type AuthFormCardProps = {
  mode: AuthMode;
  onPasswordFocusChange?: (focused: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
};

export function AuthFormCard({
  mode,
  onPasswordFocusChange,
  onPendingChange,
}: AuthFormCardProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = copyByMode[mode];

  useEffect(() => {
    onPendingChange?.(pending);
  }, [onPendingChange, pending]);

  const syncPasswordFocus = (focused: boolean) => {
    onPasswordFocusChange?.(focused);
  };

  const handlePasswordBlur = () => {
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      const isPasswordField = activeElement instanceof HTMLElement
        && activeElement.dataset.passwordField === "true";
      syncPasswordFocus(isPasswordField);
    });
  };

  const handleSubmit = async (formData: FormData) => {
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (mode === "register") {
      if (!name) {
        setError("请输入姓名。");
        return;
      }

      if (password !== confirmPassword) {
        setError("两次输入的密码不一致。");
        return;
      }
    }

    setPending(true);
    setError(null);

    try {
      const result =
        mode === "login"
          ? await authClient.signIn.email({
              email,
              password,
            })
          : await authClient.signUp.email({
              email,
              name,
              password,
            });

      if (result.error) {
        setError(result.error.message || (mode === "login" ? defaultLoginError : defaultRegisterError));
        return;
      }

      startTransition(() => {
        router.replace("/");
        router.refresh();
      });
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : mode === "login"
            ? defaultLoginError
            : defaultRegisterError,
      );
    } finally {
      setPending(false);
      syncPasswordFocus(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.eyebrow}>{copy.eyebrow}</div>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.description}>{copy.description}</p>
      </div>

      <form
        action={(formData) => {
          void handleSubmit(formData);
        }}
        className={styles.form}
      >
        {mode === "register" ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="name">
              姓名
            </label>
            <input
              autoComplete="name"
              className={styles.input}
              id="name"
              name="name"
              placeholder="输入你的姓名"
              required
              type="text"
            />
          </div>
        ) : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            邮箱
          </label>
          <input
            autoComplete="email"
            className={styles.input}
            id="email"
            name="email"
            placeholder="name@company.com"
            required
            type="email"
          />
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor="password">
              密码
            </label>
            <span className={styles.helper}>至少 8 位</span>
          </div>
          <input
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={styles.input}
            data-password-field="true"
            id="password"
            minLength={8}
            name="password"
            onBlur={handlePasswordBlur}
            onFocus={() => {
              syncPasswordFocus(true);
            }}
            placeholder="输入你的密码"
            required
            type="password"
          />
        </div>

        {mode === "register" ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="confirmPassword">
              确认密码
            </label>
            <input
              autoComplete="new-password"
              className={styles.input}
              data-password-field="true"
              id="confirmPassword"
              minLength={8}
              name="confirmPassword"
              onBlur={handlePasswordBlur}
              onFocus={() => {
                syncPasswordFocus(true);
              }}
              placeholder="再次输入密码"
              required
              type="password"
            />
          </div>
        ) : null}

        {error ? (
          <div aria-live="polite" className={styles.error}>
            {error}
          </div>
        ) : null}

        <Button className={styles.submit} disabled={pending} size="lg" type="submit">
          <span className={styles.submitLabel}>
            {pending ? <LoaderCircle className="animate-spin" size={16} /> : null}
            <span>{copy.submitLabel}</span>
          </span>
        </Button>
      </form>

      <p className={styles.footer}>
        {copy.secondaryText} <Link href={copy.secondaryHref}>{copy.secondaryLabel}</Link>
      </p>

      <p className={styles.finePrint}>当前支持邮箱密码登录，暂不提供邮箱验证与找回密码。</p>
    </div>
  );
}
