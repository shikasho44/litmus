/**
 * Turn tracing. Every ask / verdict produces a TurnTrace (shared/api.ts) that is kept in an
 * in-memory ring buffer (admin), written as one JSON line to the console (production), and
 * — in dev only — appended to logs/trace-YYYY-MM-DD.jsonl (server/node/trace-file.ts).
 * Sinks never throw into the game.
 */
import type { StageTiming, TurnTrace } from '../../shared/api.js';

export interface PartTrace {
  question: string;
  normalized: string;
  negated: boolean;
  open: boolean;
  answerClass: string;
  source: string;
  meta?: string;
  confidence: number;
  closeness: number;
  factIds: string[];
  unlocked: string[];
  blocked: { id: string; reason: string }[];
  candidates: { id: string; score: number }[];
  probes: { q: string; score: number; label: string; flip: boolean }[];
  judge?: unknown;
  rendered?: { text: string; canned: boolean };
  postCheck?: { pass: boolean; detail: unknown };
  fallback?: string;
}

/** TurnTrace plus per-part detail (structurally a TurnTrace). */
export interface EngineTrace extends TurnTrace {
  parts?: PartTrace[];
  degraded?: boolean;
  requestedMode?: string;
}

export interface TraceRecord {
  id: string;
  at: string;
  kind: 'ask' | 'verdict';
  caseId: string;
  input: string;
  result: string[];
  trace: EngineTrace;
}

export interface TraceSink {
  write(r: TraceRecord): void;
}

export class TraceRing implements TraceSink {
  private buf: TraceRecord[] = [];
  constructor(readonly capacity = 300) {}
  write(r: TraceRecord): void {
    this.buf.push(r);
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
  }
  /** Newest first. */
  list(limit = this.capacity, caseId?: string): TraceRecord[] {
    const out = caseId ? this.buf.filter((r) => r.caseId === caseId) : this.buf;
    return out.slice(-limit).reverse();
  }
  clear(): void {
    this.buf = [];
  }
}

/** One compact JSON line per turn (production logs). */
export const consoleJsonSink: TraceSink = {
  write(r) {
    const t = r.trace;
    console.log(
      JSON.stringify({
        type: 'turn',
        at: r.at,
        kind: r.kind,
        caseId: r.caseId,
        mode: t.mode,
        result: r.result,
        fallback: t.fallback,
        degraded: t.degraded ?? false,
        confidence: t.confidence,
        fastPath: t.fastPath,
        ms: t.timings.find((x) => x.stage === 'total')?.ms,
        tokens: t.tokens,
        costUsd: t.costUsd,
      }),
    );
  },
};

export class TraceHub implements TraceSink {
  constructor(readonly sinks: TraceSink[]) {}
  write(r: TraceRecord): void {
    for (const s of this.sinks) {
      try {
        s.write(r);
      } catch {
        /* tracing must never break a turn */
      }
    }
  }
}

let seq = 0;
export function traceId(): string {
  seq = (seq + 1) % 1e6;
  return `${Date.now().toString(36)}-${seq.toString(36)}`;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Accumulates per-stage timings (the same stage name may be timed several times). */
export class StageTimer {
  private readonly t0 = now();
  private readonly acc = new Map<string, number>();

  async time<T>(stage: string, fn: () => Promise<T> | T): Promise<T> {
    const s = now();
    try {
      return await fn();
    } finally {
      this.add(stage, now() - s);
    }
  }

  timeSync<T>(stage: string, fn: () => T): T {
    const s = now();
    try {
      return fn();
    } finally {
      this.add(stage, now() - s);
    }
  }

  add(stage: string, ms: number): void {
    this.acc.set(stage, (this.acc.get(stage) ?? 0) + ms);
  }

  elapsed(): number {
    return now() - this.t0;
  }

  timings(): StageTiming[] {
    const out: StageTiming[] = [...this.acc].map(([stage, ms]) => ({ stage, ms: Math.round(ms * 10) / 10 }));
    out.push({ stage: 'total', ms: Math.round(this.elapsed() * 10) / 10 });
    return out;
  }
}
