// First-run setup state (Slice 9): whether it was finished or skipped, and the saved "About you" answers.
// Stored as Settings; the memories the answers become are made by MemoryService.

import { SetupAnswersSchema, setupAnswersToMemories, type SetupAnswers } from "../domain/setup";
import type { SettingsRepository } from "../ports";
import type { MemoryService } from "./memory-service";

export const ONBOARDING_COMPLETED_KEY = "onboarding.completedAt";
export const ONBOARDING_ANSWERS_KEY = "onboarding.answers";
export const USER_NAME_KEY = "user.name";

export interface OnboardingState {
  completed: boolean;
  /** The saved answers (so setup can be pre-filled), or null when none were saved. */
  answers: SetupAnswers | null;
}

export interface OnboardingService {
  state(): Promise<OnboardingState>;
  /** The name to greet the user by, or null. */
  userName(): Promise<string | null>;
  /** Saves already-validated answers: the raw answers, the name, and the memories. `memoryCount` is how many setup memories these answers describe. */
  saveAnswers(answers: SetupAnswers): Promise<{ answers: SetupAnswers; created: number; removed: number; memoryCount: number }>;
  /** Finished or skipped: setup stops showing. */
  complete(): Promise<void>;
  /** Run setup again: it shows on the next open. Saved answers and memories stay. */
  reset(): Promise<void>;
}

export function createOnboardingService(deps: {
  settings: SettingsRepository;
  memoryService: MemoryService;
  clock: () => Date;
}): OnboardingService {
  const { settings, memoryService, clock } = deps;

  async function savedAnswers(): Promise<SetupAnswers | null> {
    const raw = await settings.get(ONBOARDING_ANSWERS_KEY);
    if (!raw) return null;
    try {
      const parsed = SetupAnswersSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  return {
    async state() {
      const completedAt = await settings.get(ONBOARDING_COMPLETED_KEY);
      return { completed: Boolean(completedAt), answers: await savedAnswers() };
    },

    async userName() {
      return (await settings.get(USER_NAME_KEY))?.trim() || null;
    },

    async saveAnswers(answers) {
      const result = await memoryService.saveSetupAnswers(answers, await savedAnswers());
      await settings.set(ONBOARDING_ANSWERS_KEY, JSON.stringify(answers));
      if (answers.name) await settings.set(USER_NAME_KEY, answers.name);
      else await settings.delete(USER_NAME_KEY);
      return {
        answers,
        created: result.created.length,
        removed: result.removed,
        memoryCount: setupAnswersToMemories(answers).length,
      };
    },

    async complete() {
      await settings.set(ONBOARDING_COMPLETED_KEY, clock().toISOString());
    },

    async reset() {
      await settings.delete(ONBOARDING_COMPLETED_KEY);
    },
  };
}
