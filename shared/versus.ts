/**
 * Online versus mode — the contract between the browser (src/features/versus) and the server
 * (server/versus, routes under /api/versus/*). docs/versus.md is the design note.
 *
 * Players on their own devices share a room code, start the same case at the same moment and
 * race to get the cause of death accepted. Each plays the normal case flow with an ordinary
 * progress token that is additionally bound to the room (server/engine/room-binding.ts); the
 * server derives everyone's progress from those signed tokens and never shows case content or
 * which findings another player holds — only aggregate progress.
 *
 * Types and plain constants only (no zod, no Node): imported by the http build's versus chunk.
 */
import type { Difficulty, ProgressSnapshot, ProgressToken } from './api';

export const VERSUS_MIN_PLAYERS = 2;
export const VERSUS_MAX_PLAYERS = 4;
export const VERSUS_NAME_MAX = 12;
export const ROOM_CODE_LENGTH = 6;
/** No 0/O, 1/I/L: a code read aloud on stream or typed from a screenshot has one spelling. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Start → race clock zero. Every client counts down to the server's startAt. */
export const VERSUS_COUNTDOWN_MS = 3500;

/** Where a player is, derived by the server from their latest signed token. */
export type VersusStage = 'lobby' | 'investigation' | 'inquest' | 'solved';
export type VersusStatus = 'lobby' | 'countdown' | 'playing' | 'finished' | 'closed';

export interface VersusPlayerView {
  id: string;
  name: string;
  host: boolean;
  /** The requesting player. */
  you: boolean;
  /** Seen by the server in the last ~20 s. */
  online: boolean;
  stage: VersusStage;
  /** 0..1 解明度 (share of the case's finding weight unlocked; 1 once solved). */
  progress: number;
  /** Questions asked. */
  asked: number;
  /** Solve time from the race start (ms). */
  finishMs?: number;
  /** 1 = the winner; others by solve time. Only players who solved have a rank. */
  rank?: number;
  /** 脱落: the last light went out before the verdict was accepted. */
  out?: boolean;
  /** Left the room after the start (their row stays in the results). */
  left?: boolean;
}

export interface VersusRoomView {
  code: string;
  caseId: string;
  difficulty: Difficulty;
  status: VersusStatus;
  /** Server epoch ms of the race start (set when the host starts). */
  startAt?: number;
  /** Server epoch ms when this view was made — clients correct their clock with it. */
  now: number;
  /** The requesting player's id. */
  you: string;
  players: VersusPlayerView[];
  winner?: { id: string; name: string; ms: number };
  minPlayers: number;
  maxPlayers: number;
}

export interface VersusConfig {
  enabled: boolean;
  minPlayers?: number;
  maxPlayers?: number;
  nameMax?: number;
  countdownMs?: number;
  /** dev only: which room store answers. */
  store?: 'memory' | 'redis';
}

/**
 * The seat is the player's credential for the room: `<code>.<player id>.<signature>` signed by
 * the server. Kept in sessionStorage, sent in the body (never in a URL).
 */
export interface VersusSeatResponse { seat: string; room: VersusRoomView }
export interface VersusRoomResponse { room: VersusRoomView }
export interface VersusRunResponse { token: ProgressToken; progress: ProgressSnapshot; room: VersusRoomView }

export interface VersusCreateRequest { caseId: string; difficulty: Difficulty; name: string; cid?: string }
export interface VersusJoinRequest { code: string; name: string; cid?: string }
export interface VersusSeatRequest { seat: string }
export interface VersusProgressRequest { seat: string; token: ProgressToken }

/** Error messages the server sends with `bad_request` (the UI maps them to Japanese). */
export const VERSUS_ERR = {
  disabled: 'versus is disabled',
  badCode: 'invalid room code',
  badName: 'invalid name',
  notFound: 'room not found',
  closed: 'room closed',
  full: 'room is full',
  started: 'room already started',
  notHost: 'only the host can start',
  tooFew: 'not enough players',
  notStarted: 'the race has not started',
  seat: 'invalid seat',
  left: 'you left this room',
  out: 'you are out of this race',
  binding: 'token is not bound to this room',
  issues: 'too many run tokens',
} as const;
