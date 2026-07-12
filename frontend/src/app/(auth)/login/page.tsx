"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/context/auth";
import { ApiError } from "@/lib/api";

type Mode = "login" | "signup";

/** The four seeded accounts, so a reviewer can be inside the app in one click. */
const DEMO_ACCOUNTS = [
  { email: "admin@acme.test", role: "Admin" },
  { email: "raj@acme.test", role: "Asset Manager" },
  { email: "aditi@acme.test", role: "Department Head" },
  { email: "priya@acme.test", role: "Employee" },
];

export default function LoginPage() {
  const { login, signup } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isRecovering, setIsRecovering] = useState(false);

  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    organizationSlug: "acme",
  });

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await login(form.email, form.password);
      } else {
        await signup({
          organizationSlug: form.organizationSlug,
          name: form.name,
          email: form.email,
          password: form.password,
        });
        toast.success("Welcome to AssetFlow", {
          description: "Your account was created with the Employee role.",
        });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        // The server's own field messages, rendered under the right inputs. No
        // second copy of the validation rules lives in this component.
        setErrors(error.fieldErrors);

        if (!Object.keys(error.fieldErrors).length) {
          toast.error(error.message);
        }
      } else {
        toast.error("Could not reach the server. Is the API running on :4000?");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function useDemoAccount(email: string) {
    setMode("login");
    setForm((previous) => ({ ...previous, email, password: "password123" }));
  }

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="card p-7"
    >
      <div className="flex flex-col items-center text-center">
        <div className="grid size-11 place-items-center rounded-xl bg-primary text-sm font-bold text-white shadow-lg shadow-primary/20">
          AF
        </div>

        <h1 className="mt-3.5 text-lg font-semibold text-fg">AssetFlow</h1>
        <p className="mt-1 text-xs text-muted">
          {mode === "login" ? "Sign in to your workspace" : "Join an existing workspace"}
        </p>
      </div>

      {/*
        noValidate: the BROWSER must not intercept this. Its native check would
        block the submit and show its own tooltip, so the server's validation would
        never run and the user would never see the message the API actually
        produces. The backend is the single source of truth for what is valid —
        including rules only it can know, like a duplicate email.
      */}
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-3.5">
        {mode === "signup" && (
          <>
            <Field label="Organization" error={errors.organizationSlug} required>
              <Input
                value={form.organizationSlug}
                onChange={set("organizationSlug")}
                placeholder="acme"
                invalid={Boolean(errors.organizationSlug)}
                autoComplete="organization"
              />
            </Field>

            <Field label="Full name" error={errors.name} required>
              <Input
                value={form.name}
                onChange={set("name")}
                placeholder="Priya Sharma"
                invalid={Boolean(errors.name)}
                autoComplete="name"
              />
            </Field>
          </>
        )}

        <Field label="Email" error={errors.email} required>
          <Input
            type="email"
            value={form.email}
            onChange={set("email")}
            placeholder="name@company.com"
            invalid={Boolean(errors.email)}
            autoComplete="email"
            autoFocus
          />
        </Field>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label className="block text-xs font-medium text-muted">
              Password
              <span className="ml-0.5 text-danger">*</span>
            </label>

            {mode === "login" && (
              <button
                type="button"
                onClick={() => setIsRecovering(true)}
                className="cursor-pointer text-[11px] font-medium text-primary hover:underline"
              >
                Forgot password?
              </button>
            )}
          </div>

          <Field error={errors.password} hint={mode === "signup" ? "At least 8 characters." : undefined}>
            <Input
              type="password"
              value={form.password}
              onChange={set("password")}
              placeholder="••••••••"
              invalid={Boolean(errors.password)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </Field>
        </div>

        <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>

      {/*
       * The rule from the spec, stated where the user can see it. Signup creates an
       * EMPLOYEE and nothing else — the request body has no role field at all, so
       * this is a description of the system, not a promise the UI is making.
       */}
      <div className="mt-5 rounded-lg border border-line bg-surface-2 px-3.5 py-2.5">
        <p className="text-[11px] leading-relaxed text-muted">
          {mode === "signup" ? (
            <>
              Signing up creates an <span className="font-medium text-fg">Employee</span> account.
              Department Head and Asset Manager roles are assigned later by an Admin, from the
              Employee Directory.
            </>
          ) : (
            <>
              New here?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setErrors({});
                }}
                className="cursor-pointer font-medium text-primary hover:underline"
              >
                Create an employee account
              </button>{" "}
              or{" "}
              <Link href="/onboard" className="font-medium text-primary hover:underline">
                start a new organization
              </Link>
              .
            </>
          )}
        </p>

        {mode === "signup" && (
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setErrors({});
            }}
            className="mt-2 cursor-pointer text-[11px] font-medium text-primary hover:underline"
          >
            ← Back to sign in
          </button>
        )}
      </div>

      {mode === "login" && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-[10px] font-medium tracking-wide text-subtle uppercase">
            Demo accounts · password123
          </p>

          <div className="grid grid-cols-2 gap-1.5">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => useDemoAccount(account.email)}
                className="cursor-pointer rounded-md border border-line bg-surface-2 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-surface-3"
              >
                <p className="truncate text-[11px] font-medium text-fg">{account.role}</p>
                <p className="truncate text-[10px] text-subtle">{account.email}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>

      {/*
       * Password recovery.
       *
       * AssetFlow has no email service — deliberately: the brief asks us to minimise
       * third-party dependencies, and an internal ERP that silently mails reset links
       * from an unverified domain is a worse answer than an explicit one.
       *
       * So recovery is what it is in most internal tools: an Admin resets it. That
       * keeps the reset path inside the same role boundary as every other privileged
       * action — the Employee Directory — rather than opening a second, unauthenticated
       * way to take over an account.
       */}
      <Modal
        open={isRecovering}
        onClose={() => setIsRecovering(false)}
        title="Forgot your password?"
        description="Your Admin can reset it for you."
        size="sm"
        footer={
          <Button onClick={() => setIsRecovering(false)} className="w-full">
            Got it
          </Button>
        }
      >
        <div className="space-y-3.5">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3">
            <div className="rounded-md bg-primary/12 p-2">
              <KeyRound className="size-4 text-primary" />
            </div>

            <div className="min-w-0">
              <p className="text-xs font-medium text-fg">Ask an Admin to reset it</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                An Admin can set a new password for you from{" "}
                <span className="font-medium text-fg">Organization setup → Employee</span>. You will
                be able to change it once you are signed in.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-info/25 bg-info-soft p-3">
            <ShieldCheck className="mt-px size-4 shrink-0 text-info" />

            <p className="text-[11px] leading-relaxed text-muted">
              <span className="font-medium text-fg">Why not an email link?</span> AssetFlow sends no
              email by design. A reset link is a second, unauthenticated route into an account —
              keeping resets with an Admin holds them to the same role boundary as every other
              privileged action.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
