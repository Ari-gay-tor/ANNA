import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { NewChatShortcut } from "@/components/NewChatShortcut";
import { ReminderBanner } from "@/components/ReminderBanner";
import { SetupGate } from "@/components/SetupGate";
import { THEME_INIT_SCRIPT } from "@/components/theme";
import { TopNav } from "@/components/TopNav";
import { setupRequired } from "@/server/key-setup";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "ANNA",
  description: "A personal assistant that reduces cognitive load.",
};

// Whether a key is set is read on each request (the Setup screen must go away as soon as a key is saved, with no restart).
export const dynamic = "force-dynamic";

// Colors the Edge app window's title bar (same green as --accent and the manifest).
export const viewport: Viewport = { themeColor: "#2f5d50" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below sets data-theme on <html> before React runs.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Runs before first paint, so a saved Light/Dark choice never flashes the other theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <TopNav />
        <ReminderBanner />
        <NewChatShortcut />
        <div className="content">
          <SetupGate required={setupRequired(process.env)}>{children}</SetupGate>
        </div>
      </body>
    </html>
  );
}
