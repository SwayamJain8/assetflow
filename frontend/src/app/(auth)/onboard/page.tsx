"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ImageUp, Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useAuth } from "@/context/auth";
import { ApiError, patch, upload } from "@/lib/api";
import { applyTheme, contrast, themeFromLogo, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type Step = "account" | "brand";

export default function OnboardPage() {
  const { onboard, setOrganization, organization } = useAuth();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("account");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    organizationName: "",
    name: "",
    email: "",
    password: "",
  });

  const [logo, setLogo] = useState<{ file: File; preview: string } | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setIsSubmitting(true);

    try {
      await onboard(form);
      setStep("brand");
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        if (!Object.keys(error.fieldErrors).length) toast.error(error.message);
      } else {
        toast.error("Could not reach the server. Is the API running on :4000?");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * THE MOMENT.
   *
   * The palette is extracted from the logo IN THE BROWSER, clamped for contrast,
   * and applied to the document root immediately — so the theme changes under the
   * user's cursor, before anything is saved. Persisting it is a separate, later
   * step; the demo is the instant feedback.
   */
  async function onLogoChosen(file: File) {
    setIsExtracting(true);

    try {
      const preview = URL.createObjectURL(file);
      setLogo({ file, preview });

      const derived = await themeFromLogo(file);

      setTheme(derived);
      applyTheme(derived); // ← the entire app re-skins, right now
    } catch {
      toast.error("Could not read that image. Try a PNG or JPEG.");
    } finally {
      setIsExtracting(false);
    }
  }

  async function saveBrand() {
    setIsSubmitting(true);

    try {
      if (logo) await upload<{ logoPath: string }>("/organization/logo", logo.file);
      if (theme) await patch("/organization", { theme });

      // Re-read the org so the sidebar picks up the logo and the persisted theme.
      const fresh = await patch<{ id: string; name: string; slug: string; logoPath: string | null; theme: Theme | null }>(
        "/organization",
        {},
      );
      setOrganization(fresh);

      toast.success("Your workspace is branded", {
        description: "Every screen now uses your colours.",
      });

      router.push("/dashboard");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save your branding.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Step 1: the account ───────────────────────────────────────────────────
  if (step === "account") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="card p-7"
      >
        <Link
          href="/login"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-3.5" />
          Back to sign in
        </Link>

        <h1 className="text-lg font-semibold text-fg">Start a new organization</h1>
        <p className="mt-1 text-xs text-muted">
          You&apos;ll become its Admin. Everyone who joins afterwards starts as an Employee.
        </p>

        <form onSubmit={createAccount} noValidate className="mt-6 space-y-3.5">
          <Field label="Organization name" error={errors.organizationName} required>
            <Input
              value={form.organizationName}
              onChange={set("organizationName")}
              placeholder="Acme Corp"
              invalid={Boolean(errors.organizationName)}
              autoFocus
            />
          </Field>

          <Field label="Your name" error={errors.name} required>
            <Input
              value={form.name}
              onChange={set("name")}
              placeholder="Hank Scorpio"
              invalid={Boolean(errors.name)}
            />
          </Field>

          <Field label="Email" error={errors.email} required>
            <Input
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="you@acme.com"
              invalid={Boolean(errors.email)}
            />
          </Field>

          <Field label="Password" error={errors.password} hint="At least 8 characters." required>
            <Input
              type="password"
              value={form.password}
              onChange={set("password")}
              placeholder="••••••••"
              invalid={Boolean(errors.password)}
            />
          </Field>

          <Button type="submit" loading={isSubmitting} size="lg" className="w-full">
            Continue
          </Button>
        </form>
      </motion.div>
    );
  }

  // ── Step 2: the brand ─────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="card p-7"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h1 className="text-lg font-semibold text-fg">Make it yours</h1>
      </div>

      <p className="mt-1 text-xs text-muted">
        Upload {organization?.name ?? "your organization"}&apos;s logo. AssetFlow reads its colours
        and re-skins every screen — you&apos;ll see it happen as soon as you choose a file.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onLogoChosen(file);
        }}
      />

      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className={cn(
          "mt-5 flex w-full cursor-pointer flex-col items-center gap-2.5 rounded-xl border border-dashed p-7 transition-all",
          logo
            ? "border-primary/40 bg-primary/[0.04]"
            : "border-line hover:border-primary/40 hover:bg-surface-2",
        )}
      >
        {isExtracting ? (
          <Loader2 className="size-6 animate-spin text-primary" />
        ) : logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo.preview} alt="" className="size-14 rounded-lg object-contain" />
        ) : (
          <div className="rounded-full bg-surface-2 p-2.5">
            <ImageUp className="size-5 text-subtle" />
          </div>
        )}

        <div className="text-center">
          <p className="text-xs font-medium text-fg">
            {logo ? "Choose a different logo" : "Upload your logo"}
          </p>
          <p className="mt-0.5 text-[11px] text-subtle">PNG, JPEG or WebP · up to 5 MB</p>
        </div>
      </button>

      <AnimatePresence>
        {theme && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-5 rounded-lg border border-line bg-surface-2 p-3.5">
              <div className="flex items-center gap-1.5">
                <Check className="size-3.5 text-success" />
                <p className="text-[11px] font-medium text-fg">Palette extracted and applied</p>
              </div>

              {/* The generated ramp, shown honestly — these are the exact tokens
                  every button, pill and chart in the app now reads. */}
              <div className="mt-2.5 flex gap-1">
                {["50", "100", "300", "500", "700", "900"].map((step) => (
                  <div key={step} className="flex-1">
                    <div
                      className="h-7 rounded"
                      style={{ background: theme[`brand-${step}`] }}
                      title={`brand-${step}: ${theme[`brand-${step}`]}`}
                    />
                    <p className="mt-1 text-center text-[9px] text-subtle">{step}</p>
                  </div>
                ))}
              </div>

              {/*
               * The bit that makes this thoughtful rather than gimmicky: the
               * extracted colour is CLAMPED so white text on it always clears
               * WCAG AA. A neon-yellow logo cannot produce an unreadable button.
               */}
              <p className="mt-2.5 nums text-[10px] leading-relaxed text-subtle">
                Contrast of white text on your brand:{" "}
                <span className="font-medium text-success">
                  {contrast(theme.primary!, "#ffffff").toFixed(2)}:1
                </span>{" "}
                — clamped to stay readable (WCAG AA needs 3:1).
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => router.push("/dashboard")}
          disabled={isSubmitting}
        >
          Skip for now
        </Button>

        <Button className="flex-1" onClick={saveBrand} loading={isSubmitting} disabled={!logo}>
          Save & continue
        </Button>
      </div>
    </motion.div>
  );
}
