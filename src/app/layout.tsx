import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { NewChatShortcut } from "@/components/NewChatShortcut";
import { ReminderBanner } from "@/components/ReminderBanner";
import { THEME_INIT_SCRIPT } from "@/components/theme";
import { TopNav } from "@/components/TopNav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "ANNA",
  description: "A personal assistant that reduces cognitive load.",
};

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
        <div className="content">{children}</div>
      </body>
    </html>
  );
}
