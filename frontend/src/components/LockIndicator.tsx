"use client";

import type { LockState } from "@/types";

export function LockIndicator({ lock }: { lock: LockState | null }) {
  if (!lock || !lock.locked) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Unlocked
      </span>
    );
  }
  if (lock.owned_by_me) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600">
        <span className="h-2 w-2 rounded-full bg-indigo-500" />
        Locked by you — you can reply
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600">
      <span className="h-2 w-2 rounded-full bg-amber-500" />
      Locked by {lock.holder_name} — read only
    </span>
  );
}
