// Groups the sidebar's conversations by how recently they were active. Pure, so it can be tested without a browser.

export const GROUP_LABELS = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;
export type GroupLabel = (typeof GROUP_LABELS)[number];

export interface ConversationGroup<T> {
  label: GroupLabel;
  items: T[];
}

/** The start of the local day that is `daysAgo` days before `now`'s day. Calendar arithmetic, so a DST change cannot shift it. */
function startOfDay(now: Date, daysAgo: number): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo).getTime();
}

/**
 * Today / Yesterday / Previous 7 days / Older, by `updatedAt` in local time. Previous 7 days is the five days before
 * Yesterday (2 to 7 days ago). Order within a group is the input order, and empty groups are left out.
 * A date in the future counts as today.
 */
export function groupConversations<T extends { updatedAt: string | Date }>(conversations: readonly T[], now: Date): ConversationGroup<T>[] {
  const yesterday = startOfDay(now, 1);
  const weekAgo = startOfDay(now, 7);
  const today = startOfDay(now, 0);

  const groups = new Map<GroupLabel, T[]>(GROUP_LABELS.map((label) => [label, []]));
  for (const conversation of conversations) {
    const at = new Date(conversation.updatedAt).getTime();
    const label: GroupLabel = at >= today ? "Today" : at >= yesterday ? "Yesterday" : at >= weekAgo ? "Previous 7 days" : "Older";
    groups.get(label)?.push(conversation);
  }
  return GROUP_LABELS.flatMap((label) => {
    const items = groups.get(label) ?? [];
    return items.length > 0 ? [{ label, items }] : [];
  });
}
