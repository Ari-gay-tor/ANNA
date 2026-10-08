"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SetupAnswers } from "@/core/domain/setup";
import { SetupFlow } from "./setup/SetupFlow";

interface Props {
  /** Setup was finished or skipped before. */
  completed: boolean;
  /** No usable provider key yet. */
  needsKey: boolean;
  /** The saved "About you" answers, to pre-fill the form. */
  answers: SetupAnswers | null;
  children: ReactNode;
}

/**
 * Shows the first-run setup instead of the page until it is finished or skipped. If setup was done before but the key has since
 * gone missing, only the key step shows. "Run setup again" in Settings clears `completed` on the server and refreshes.
 */
export function SetupGate({ completed, needsKey, answers, children }: Props) {
  const router = useRouter();
  const [finished, setFinished] = useState(false);
  const [seenCompleted, setSeenCompleted] = useState(completed);
  if (seenCompleted !== completed) {
    // The server's answer changed (setup was reset, or has just been completed): start from a clean slate.
    setSeenCompleted(completed);
    setFinished(false);
  }

  if ((completed && !needsKey) || finished) return <>{children}</>;

  return (
    <SetupFlow
      keyOnly={completed}
      needsKey={needsKey}
      initialAnswers={answers}
      onFinish={(to) => {
        setFinished(true);
        router.push(to);
        router.refresh(); // so the server layout sees that setup is done and a key now exists
      }}
    />
  );
}
