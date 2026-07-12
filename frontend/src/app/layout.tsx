import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AssetFlow — Asset & Resource Management",
  description:
    "Track assets through their lifecycle, allocate them without conflicts, book shared resources without overlaps, and run maintenance and audit workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
         * Applies the saved theme BEFORE first paint.
         *
         * Without this the page renders light and React swaps it to dark a tick
         * later — the white flash that every dark-mode app gets wrong. It has to
         * be a blocking inline script; anything inside React is already too late.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              // Dark unless the user has explicitly chosen light. AssetFlow is a
              // dark product (see the mockups); the OS preference is not consulted,
              // because a light-preferring OS would otherwise give first-time users
              // a screen that looks nothing like the product's identity.
              var m = localStorage.getItem('assetflow.mode') || 'dark';
              if (m === 'dark') document.documentElement.classList.add('dark');
              document.documentElement.style.colorScheme = m;
            }catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
