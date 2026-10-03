/**
 * Response shapes of /api/health and /api/admin/* (server/http/handler.ts).
 * Type-only imports from server/ are erased at build time — nothing from the engine is
 * bundled into the admin page.
 */
import type { Case } from '../../shared/case-schema';
import type { PipelineMode, ProgressSnapshot, ProgressToken } from '../../shared/api';
import type { CaseValidation, ProbeMismatch } from '../../server/engine/validate';
import type { LoadIssue } from '../../server/engine/registry';
import type { LineBankInfo } from '../../server/engine/lines';
import type { EngineTrace, PartTrace, TraceRecord } from '../../server/engine/trace';

export type { Case, CaseValidation, ProbeMismatch, LoadIssue, EngineTrace, PartTrace, TraceRecord, PipelineMode, ProgressSnapshot, ProgressToken };

/**
 * GET /api/health. The public answer is liveness only ({ok, version}; 503 while the production
 * server is misconfigured) — the rest is filled only for dev / a valid admin token.
 */
export interface Health {
  ok: boolean;
  version: string;
  mode?: PipelineMode;
  requestedMode?: PipelineMode;
  cases?: number;
  contentIssues?: number;
  dev?: boolean;
  secretConfigured?: boolean;
  /** Why production refuses to sign tokens (e.g. SESSION_SECRET missing / too short); null when fine. */
  misconfigured?: string | null;
  budgetExceeded?: boolean;
  uptimeSec?: number;
}

export interface BudgetStatus {
  day: string;
  spentUsd: number;
  limitUsd: number;
  calls: number;
  exceeded: boolean;
}

export interface AdminStatus {
  mode: PipelineMode;
  requestedMode: PipelineMode;
  decisionProvider: string;
  llmProvider: string;
  llmModel: string | null;
  jevModel: string;
  hasOpenRouterKey: boolean;
  secretConfigured: boolean;
  budget: BudgetStatus;
  warnings: string[];
  rateLimiterKeys: number;
  dev: boolean;
}

export interface AdminCase {
  id: string;
  path: string;
  publish: boolean;
  /** A prototype case's switch (shared/proto.ts): players see it only with ?proto=<this>. */
  proto?: string;
  reviewStatus: Case['reviewStatus'];
  validation: CaseValidation;
  data: Case;
}

export interface AdminCases {
  cases: AdminCase[];
  issues: LoadIssue[];
  lines: LineBankInfo;
  prologue: boolean;
}

export interface BenchReportInfo {
  file: string;
  modified?: string;
  size?: number;
  report?: unknown;
  error?: string;
}

export type Stage = 'fresh' | 'investigated' | 'debated' | 'solved' | 'reconstructed';

export interface MintResult {
  token: ProgressToken;
  progress: ProgressSnapshot;
}

export const PIPELINE_MODES: readonly PipelineMode[] = ['rules', 'jev', 'jev+llm', 'jev+llm+check', 'llm'];

export const STAGES: { id: Stage; label: string; detail: string }[] = [
  { id: 'fresh', label: '新規', detail: '開始直後（最初から見える所見だけ）' },
  { id: 'investigated', label: '捜査済み', detail: 'spoilerLevel ≤3 の所見と科学メモをすべて開示・質問20回' },
  { id: 'debated', label: '審問突破', detail: '捜査済み＋審問の全ラウンドを突破' },
  { id: 'solved', label: '解決', detail: '死因宣告が通った状態（真相・解説が読める）' },
  { id: 'reconstructed', label: '再構成済み', detail: '解決＋真相の再構成まで完了' },
];
