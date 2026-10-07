import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ReminderBanner } from "@/components/ReminderBanner";
import { TopNav } from "@/components/TopNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANNA",
  description: "A personal assistant that reduces cognitive load.",
};

// Colors the Edge app window's title bar (same green as --accent and the manifest).
export const viewport: Viewport = { themeColor: "#2f5d50" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        <ReminderBanner />
        <div className="content">{children}</div>
      </body>
    </html>
  );
}
