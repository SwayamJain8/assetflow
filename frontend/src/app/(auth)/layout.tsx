export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-bg p-4">
      {/* A soft brand-coloured wash. It uses the brand token, so even the login
          page re-skins once an organization's theme is known. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full opacity-[0.13] blur-3xl"
        style={{ background: "radial-gradient(circle, var(--brand-500), transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 right-0 size-[30rem] rounded-full opacity-[0.09] blur-3xl"
        style={{ background: "radial-gradient(circle, var(--accent-500), transparent 70%)" }}
      />

      <div className="relative w-full max-w-md">{children}</div>
    </div>
  );
}
