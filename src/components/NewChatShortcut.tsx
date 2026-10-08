"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isNewChatShortcut } from "./shortcuts";

/**
 * Ctrl+Shift+O (Cmd+Shift+O on Mac) from the Memory and Reminders pages goes to a new chat.
 * On the chat page itself the chat handles it, because it also knows whether a reply is in flight.
 */
export function NewChatShortcut() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname === "/") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNewChatShortcut(event)) return;
      event.preventDefault();
      router.push("/");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname, router]);

  return null;
}
