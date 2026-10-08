"use client";

import { useEffect, useRef, useState } from "react";
import { EMPTY_SETUP_ANSWERS, type SetupAnswers } from "@/core/domain/setup";
import { api } from "../api";
import { AboutStep } from "./AboutStep";
import { DoneStep } from "./DoneStep";
import { KeyStep } from "./KeyStep";
import { WelcomeStep } from "./WelcomeStep";
import styles from "./SetupFlow.module.css";

type StepId = "welcome" | "key" | "about" | "done";

interface Props {
  /** Setup was done before and only the key is missing: show just the key step. */
  keyOnly: boolean;
  /** No usable key yet, so the key step cannot be skipped. */
  needsKey: boolean;
  initialAnswers: SetupAnswers | null;
  /** Leave setup and go here ("/" is the chat start screen). */
  onFinish: (to: string) => void;
}

/** First-run setup: Welcome, Key (only when there is none), About you, Done. Skipping at any point marks setup as done. */
export function SetupFlow({ keyOnly, needsKey, initialAnswers, onFinish }: Props) {
  // Fixed at the start, so the dots do not change under the person when the key is saved.
  const [steps] = useState<StepId[]>(() => (keyOnly ? ["key"] : needsKey ? ["welcome", "key", "about", "done"] : ["welcome", "about", "done"]));
  const [index, setIndex] = useState(0);
  const [keySaved, setKeySaved] = useState(false);
  const [skipped, setSkipped] = useState(false); // skipped while the key was still needed: finish as soon as the key is saved
  const [saved, setSaved] = useState<SetupAnswers | null>(initialAnswers);
  const [memoryCount, setMemoryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = steps[index]!;

  // Each step starts with its heading focused, so a keyboard or screen-reader user begins reading there.
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [step]);

  /** The step after (or before) this one; the key step is passed over once the key is saved. */
  function go(direction: 1 | -1) {
    let next = index + direction;
    if (steps[next] === "key" && keySaved) next += direction;
    if (next < 0 || next >= steps.length) return;
    setError(null);
    setSkipped(false); // moving on by hand cancels an earlier "skip"
    setIndex(next);
  }

  /** Marks setup as done (so it does not show again), then goes to `to`. */
  async function finish(to: string) {
    setBusy(true);
    setError(null);
    try {
      await api.completeSetup();
      onFinish(to);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  async function showDone(count: number) {
    setBusy(true);
    setError(null);
    try {
      await api.completeSetup(); // reaching the end counts as finished, even if the window is closed here
      setMemoryCount(count);
      setIndex(steps.indexOf("done"));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function skipSetup() {
    if (needsKey && !keySaved) {
      // Nothing works without a key: skipping goes straight to the key step.
      setSkipped(true);
      setError(null);
      setIndex(steps.indexOf("key"));
      return;
    }
    void finish("/");
  }

  async function saveAnswers(answers: SetupAnswers) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveSetupAnswers(answers);
      setSaved(result.answers);
      await api.completeSetup();
      setMemoryCount(result.memoryCount);
      setIndex(steps.indexOf("done"));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const showChrome = !keyOnly;
  const canGoBack = showChrome && index > 0;

  return (
    <div className={styles.scroll}>
      <main className={styles.wrap}>
        <div className={styles.card} ref={cardRef}>
          {showChrome && (
            <div className={styles.header}>
              {canGoBack ? (
                <button type="button" className={`btn btn-ghost btn-sm ${styles.back}`} onClick={() => go(-1)} disabled={busy}>
                  ← Back
                </button>
              ) : (
                <span />
              )}
              <ol className={styles.dots} aria-hidden="true">
                {steps.map((id, i) => (
                  <li key={id} className={`${styles.dot} ${i < index ? styles.dotDone : ""} ${i === index ? styles.dotNow : ""}`} />
                ))}
              </ol>
              <span />
            </div>
          )}
          {showChrome && <p className="sr-only">{`Step ${index + 1} of ${steps.length}`}</p>}

          {/* Keyed by step, so each one fades in as it appears. */}
          <div key={step} className={styles.step}>
            {step === "welcome" && <WelcomeStep onNext={() => go(1)} />}
            {step === "key" && (
              <KeyStep
                skipped={skipped}
                onSaved={() => {
                  setKeySaved(true);
                  if (keyOnly || skipped) void finish("/");
                  else go(1);
                }}
              />
            )}
            {step === "about" && (
              <AboutStep
                initial={saved ?? EMPTY_SETUP_ANSWERS}
                busy={busy}
                onSave={(answers) => void saveAnswers(answers)}
                onSkipStep={() => void showDone(0)}
              />
            )}
            {step === "done" && (
              <DoneStep name={saved?.name ?? ""} savedSomething={memoryCount > 0} busy={busy} onFinish={(to) => void finish(to)} />
            )}
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        {/* No skip link on the Done step (nothing left to skip) or on the key step while it is the one thing that cannot be skipped. */}
        {showChrome && step !== "done" && !(step === "key" && needsKey && !keySaved) && (
          <button type="button" className={styles.skip} onClick={skipSetup} disabled={busy}>
            Skip setup
          </button>
        )}
      </main>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
