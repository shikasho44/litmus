/**
 * Player progress state (what the signed token carries) and derived views.
 */
import type { Case } from '../../shared/case-schema.js';
import type { ProgressSnapshot } from '../../shared/api.js';

export interface GameState {
  caseId: string;
  /** Unlocked fact ids, in unlock order. */
  unlocked: string[];
  /** Unlocked science memo ids. */
  memos: string[];
  asked: number;
  hintsUsed: number;
  debateMisses: number;
  /** 「ホルマに泣きつく」 count. */
  grants: number;
  verdictAttempts: number;
  /** Misses per debate round (for the 2-miss hint). */
  roundMisses: Record<string, number>;
  /** Cleared debate round ids. */
  cleared: string[];
  solved: boolean;
  reconstructed: boolean;
  nearCore: boolean;
  /**
   * spoilerLevel-4 facts the player has already confirmed (policy.coreConfirmed). A repeat
   * confirmation is not a new nearCore moment, so Holma does not react to it again.
   */
  coreSeen: string[];
  /**
   * Online versus: the room this run is bound to (server/engine/room-binding.ts). Set only on
   * run tokens the versus service issues; every state update keeps it. Absent = ordinary run.
   */
  room?: string;
  /** Epoch ms when the token was issued. */
  issuedAt: number;
}

/** Shard weight per importance: 0→0, 1→1, 2→2, 3→3, 4→0 (never a card). */
export const SHARD_WEIGHT = [0, 1, 2, 3, 0] as const;

export function shardWeights(c: Case): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of c.facts) {
    const w = f.spoilerLevel >= 4 ? 0 : SHARD_WEIGHT[f.importance] ?? 0;
    if (w > 0) out[f.id] = w;
  }
  return out;
}

export function progressOf(c: Case, unlocked: Iterable<string>): number {
  const weights = shardWeights(c);
  let total = 0;
  for (const w of Object.values(weights)) total += w;
  if (total === 0) return 0;
  let got = 0;
  for (const id of new Set(unlocked)) got += weights[id] ?? 0;
  return Math.min(1, Math.round((got / total) * 1000) / 1000);
}

/** Memo ids unlocked together with a fact (fact.scienceMemo references scienceMemos[].id). */
export function memoIdForFact(c: Case, factId: string): string | undefined {
  const f = c.facts.find((x) => x.id === factId);
  if (!f?.scienceMemo) return undefined;
  if (c.scienceMemos.some((m) => m.id === f.scienceMemo)) return f.scienceMemo;
  // Inline memo text (not an id): exposed under a synthetic id.
  return `${f.id}-memo`;
}

export function initialState(c: Case, now: number): GameState {
  const unlocked = c.facts.filter((f) => f.visibleFromStart && f.spoilerLevel < 4).map((f) => f.id);
  const memos = [...new Set(unlocked.map((id) => memoIdForFact(c, id)).filter((x): x is string => !!x))];
  return {
    caseId: c.id,
    unlocked,
    memos,
    asked: 0,
    hintsUsed: 0,
    debateMisses: 0,
    grants: 0,
    verdictAttempts: 0,
    roundMisses: {},
    cleared: [],
    solved: false,
    reconstructed: false,
    nearCore: false,
    coreSeen: [],
    issuedAt: now,
  };
}

/** Removes ids that no longer exist in the case (content edited after the token was issued). */
export function sanitizeState(c: Case, s: GameState): GameState {
  const factIds = new Set(c.facts.map((f) => f.id));
  const roundIds = new Set(c.debate.map((r) => r.id));
  const memoIds = new Set([...c.scienceMemos.map((m) => m.id), ...c.facts.filter((f) => f.scienceMemo).map((f) => `${f.id}-memo`)]);
  const roundMisses: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.roundMisses)) if (roundIds.has(k)) roundMisses[k] = v;
  return {
    ...s,
    unlocked: [...new Set(s.unlocked.filter((id) => factIds.has(id)))],
    memos: [...new Set(s.memos.filter((id) => memoIds.has(id)))],
    cleared: [...new Set(s.cleared.filter((id) => roundIds.has(id)))],
    roundMisses,
    coreSeen: [...new Set((s.coreSeen ?? []).filter((id) => factIds.has(id)))],
  };
}

export function snapshot(c: Case, s: GameState): ProgressSnapshot {
  return {
    unlocked: [...s.unlocked],
    memos: [...s.memos],
    asked: s.asked,
    hintsUsed: s.hintsUsed,
    debateCleared: [...s.cleared],
    debateMisses: s.debateMisses,
    verdictAttempts: s.verdictAttempts,
    solved: s.solved,
    reconstructed: s.reconstructed,
    progress: s.solved ? 1 : progressOf(c, s.unlocked),
    nearCore: s.nearCore,
  };
}
