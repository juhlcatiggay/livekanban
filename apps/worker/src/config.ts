const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

export const HOUR_MS = UNIT_MS.h;
export const DAY_MS = UNIT_MS.d;

/** Parses "60d", "7d", "2m", "4s" or "1h" into milliseconds. */
export function parseDuration(value: string, name: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!m) throw new Error(`${name} must look like 60d, 2m or 30s (got "${value}")`);
  return Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
}

export interface RoomTimings {
  /** Inactivity window before a board is deleted. */
  expiryMs: number;
  /** last_activity_at is written at most this often (the plan's "once per hour"). */
  touchEveryMs: number;
  /** How long deleted items stay in the trash. */
  trashMs: number;
  /** How often a board with recent activity gets a backup (the plan's "daily"). */
  backupEveryMs: number;
}

/**
 * Production uses the plan's intervals; short staging/test windows (e.g.
 * EXPIRY=2m) scale the write debounce down so the flow still works end to end.
 */
export function roomTimings(env: Env): RoomTimings {
  const expiryMs = parseDuration(env.EXPIRY, "EXPIRY");
  return {
    expiryMs,
    touchEveryMs: Math.min(HOUR_MS, Math.floor(expiryMs / 60)),
    trashMs: parseDuration(env.TRASH_RETENTION, "TRASH_RETENTION"),
    backupEveryMs: parseDuration(env.BACKUP_EVERY, "BACKUP_EVERY"),
  };
}
