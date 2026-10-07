import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ReminderBanner } from "@/components/ReminderBanner";
import { TopNav } from "@/components/TopNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANNA",
  description: "A personal assistant that reduces cognitive load.",
};

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
