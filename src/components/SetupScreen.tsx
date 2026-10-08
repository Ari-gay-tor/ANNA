"use client";

import { useState } from "react";
import { AnnaMark } from "./AnnaMark";
import { KeyForm } from "./KeyForm";
import styles from "./SetupScreen.module.css";

/** Shown on every page until a usable key is saved. When the key is saved, `onDone` goes to the chat start screen. */
export function SetupScreen({ onDone }: { onDone: () => void }) {
  // The key worked but today's quota is used up: it is saved, but let the person read that before moving on.
  const [quotaSaved, setQuotaSaved] = useState(false);

  return (
    <div className={styles.scroll}>
      <main className={styles.setup}>
        <AnnaMark size={52} />
        <h1 className={styles.title}>Let&apos;s set up ANNA</h1>
        <p className={styles.lead}>She needs a free Gemini key to think. This takes about two minutes.</p>
        <ol className={styles.steps}>
          <li>
            Get a free key at{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/apikey
            </a>
            .
          </li>
          <li>Use a Google account or project without billing, so it can never cost money.</li>
          <li>Copy the key and paste it below.</li>
        </ol>
        <KeyForm
          autoFocus
          onSaved={(result) => {
            if (result.status === "quota") setQuotaSaved(true);
            else onDone();
          }}
        />
        {quotaSaved && (
          <button type="button" className={`btn btn-primary ${styles.continue}`} onClick={onDone}>
            Continue to ANNA
          </button>
        )}
        <p className={styles.privacy}>Your key stays on this PC. ANNA only sends it to Google, to check it and to get replies.</p>
      </main>
    </div>
  );
}
