"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SetupScreen } from "./SetupScreen";

/** Shows the Setup screen instead of the page while no usable provider key is configured. */
export function SetupGate({ required, children }: { required: boolean; children: ReactNode }) {
  const router = useRouter();
  const [done, setDone] = useState(false);

  if (required && !done) {
    return (
      <SetupScreen
        onDone={() => {
          setDone(true);
          router.push("/"); // the chat start screen
          router.refresh(); // so the server layout sees that a key now exists
        }}
      />
    );
  }
  return <>{children}</>;
}
