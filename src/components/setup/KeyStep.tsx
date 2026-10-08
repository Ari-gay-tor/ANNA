"use client";

import { useState } from "react";
import { KeyForm } from "../KeyForm";
import styles from "./SetupFlow.module.css";

interface Props {
  /** The person chose "Skip setup" but ANNA cannot work without a key. */
  skipped: boolean;
  /** The key was checked and saved. */
  onSaved: () => void;
}

/** The Gemini key. It cannot be skipped: without it ANNA cannot reply. */
export function KeyStep({ skipped, onSaved }: Props) {
  // The key worked but today's quota is used up: it is saved, but let the person read that before moving on.
  const [quotaSaved, setQuotaSaved] = useState(false);

  return (
    <>
      <h1 className={`${styles.title} ${styles.markless}`} tabIndex={-1}>
        Let&apos;s set up ANNA
      </h1>
      <p className={styles.lead}>She needs a free Gemini key to think. This takes about two minutes.</p>
      <p className={styles.notice} role="note">
        {skipped
          ? "You can skip the rest, but not this one. ANNA can't reply without a key, so nothing works until it's saved."
          : "This step can't be skipped. ANNA can't reply without a key, so nothing works until it's saved."}
      </p>
      <ol className={styles.keySteps}>
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
        onSaved={(result) => {
          if (result.status === "quota") setQuotaSaved(true);
          else onSaved();
        }}
      />
      {quotaSaved && (
        <button type="button" className={`btn btn-primary ${styles.continue}`} onClick={onSaved}>
          Continue
        </button>
      )}
      <p className={styles.privacy}>Your key stays on this PC. ANNA only sends it to Google, to check it and to get replies.</p>
    </>
  );
}
