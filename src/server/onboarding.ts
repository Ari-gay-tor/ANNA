// What the first-run setup flow needs to know, for the layout (server render) and GET /api/onboarding.
// Never includes a key.

import type { SetupAnswers } from "../core/domain/setup";
import type { Env } from "./app-config";
import { getServices } from "./anna";
import { setupRequired } from "./key-setup";

export interface OnboardingStatus {
  /** Setup was finished or skipped. */
  completed: boolean;
  /** No usable provider key yet, so the key step cannot be skipped. */
  needsKey: boolean;
  /** The saved "About you" answers, to pre-fill the form. */
  answers: SetupAnswers | null;
}

export async function getOnboardingStatus(env: Env = process.env): Promise<OnboardingStatus> {
  const { completed, answers } = await getServices().onboarding.state();
  return { completed, needsKey: setupRequired(env), answers };
}
