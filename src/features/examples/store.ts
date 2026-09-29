/**
 * 質問の例 in the save and on the investigation screen: the clock that deals the cards
 * (useExampleTable) and the bookkeeping when a question is sent (recordExampleUse). The rules
 * are in ./examples.ts (EXAMPLE_TUNING). The state is CaseProgress.examples — in an online
 * versus race that is the race's own copy (src/features/versus/slot.ts), played on the room's
 * difficulty like everything else in the run.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CasePublic, Difficulty } from '../../../shared/api';
import { getCaseProgress, updateCase } from '../../state/save';
import type { CaseProgress } from '../../state/types';
import { advanceExamples, EXAMPLE_TUNING, exampleBlocked, examplePool, newExampleState, nextDealAt, squashQ, useExample, type ExampleContext } from './examples';

type Pub = Pick<CasePublic, 'examples' | 'starterQuestions'> | undefined | null;

export function exampleContext(c: Pick<CaseProgress, 'log' | 'factOrder'> | undefined): ExampleContext {
  return {
    asked: (c?.log ?? []).flatMap((e) => (e.kind === 'question' ? [e.text] : [])),
    facts: c?.factOrder ?? [],
  };
}

const playOf = (c: CaseProgress | undefined): Difficulty => c?.difficulty ?? 'normal';

/** Advance the saved table (creating it on the first visit) with the investigation clock at `ms`. */
function sync(caseId: string, pub: Pub, ms?: number) {
  const pool = examplePool(pub);
  updateCase(caseId, (c) => {
    const cur = c.examples ?? newExampleState();
    const timed = ms !== undefined && ms > cur.ms ? { ...cur, ms } : cur;
    const next = advanceExamples(timed, playOf(c), pool, exampleContext(c));
    return next === c.examples ? c : { ...c, examples: next };
  });
}

/**
 * A question went out (and was answered): the card it came from is used — the one last put into
 * the input (`picked`), or a card with the same words — and cards the question made pointless
 * leave the table. Nothing is dealt here (the clock deals).
 */
export function recordExampleUse(caseId: string, pub: Pub, text: string, picked: string | null) {
  const c = getCaseProgress(caseId);
  if (!c?.examples) return;
  const pool = examplePool(pub);
  updateCase(caseId, (cur) => {
    if (!cur.examples) return cur;
    const used = useExample(cur.examples, text, picked).state;
    // prune only: advancing with the same clock deals nothing new
    const next = advanceExamples(used, playOf(cur), pool, exampleContext(cur));
    return next === cur.examples ? cur : { ...cur, examples: next };
  });
}

export interface ExampleTable {
  /** Cards on the table now (≤ maxVisible). */
  cards: string[];
  /** ms until the next deal when a slot is free and cards are left; null otherwise. */
  nextInMs: number | null;
}

/**
 * The investigation screen's card table. The clock runs while this is mounted with `active` and
 * the tab is visible; it is written to the save every EXAMPLE_TUNING.saveEveryMs, at each deal and
 * when the screen goes away, so a reload neither resets nor reshuffles.
 */
export function useExampleTable(caseId: string, pub: Pub, progress: CaseProgress | undefined, active: boolean, onDeal?: (added: string[]) => void): ExampleTable {
  const ready = !!pub;
  const [live, setLive] = useState(() => progress?.examples?.ms ?? 0);
  const liveRef = useRef(live);
  const pubRef = useRef(pub);
  pubRef.current = pub;
  const dealRef = useRef(onDeal);
  dealRef.current = onDeal;

  // the table exists as soon as the case data does (the first cards of 見習い / 審問官 at 0:00)
  useEffect(() => {
    if (!ready) return;
    sync(caseId, pubRef.current);
    liveRef.current = Math.max(liveRef.current, getCaseProgress(caseId)?.examples?.ms ?? 0);
    setLive(liveRef.current);
  }, [caseId, ready]);

  // the clock
  useEffect(() => {
    if (!ready || !active) return;
    let last = performance.now();
    let saved = liveRef.current;
    const commit = () => {
      const before = getCaseProgress(caseId)?.examples?.shown ?? [];
      sync(caseId, pubRef.current, liveRef.current);
      saved = liveRef.current;
      const added = (getCaseProgress(caseId)?.examples?.shown ?? []).filter((q) => !before.includes(q));
      if (added.length) dealRef.current?.(added);
    };
    const tick = () => {
      const now = performance.now();
      if (document.visibilityState === 'visible') liveRef.current += Math.min(now - last, 5_000);
      last = now;
      setLive(liveRef.current);
      const c = getCaseProgress(caseId);
      const ms = c?.examples?.ms ?? 0;
      const due = liveRef.current >= nextDealAt(playOf(c), ms);
      if (due || liveRef.current - saved >= EXAMPLE_TUNING.saveEveryMs) commit();
    };
    const iv = setInterval(tick, 1_000);
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        tick();
        commit();
      } else last = performance.now();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      tick();
      commit();
    };
  }, [caseId, ready, active]);

  // a new question or finding may make a card pointless: prune at once
  const logLen = progress?.log.length ?? 0;
  const factLen = progress?.factOrder.length ?? 0;
  const play = playOf(progress);
  useEffect(() => {
    if (ready && getCaseProgress(caseId)?.examples) sync(caseId, pubRef.current);
  }, [logLen, factLen, play]);

  const ex = progress?.examples;
  if (!ex || !pub) return { cards: [], nextInMs: null };
  const pool = examplePool(pub);
  const ctx = exampleContext(progress);
  const byKey = new Map(pool.map((e) => [squashQ(e.q), e]));
  const cards = ex.shown.filter((q) => {
    const e = byKey.get(squashQ(q));
    return !!e && !exampleBlocked(e, ctx);
  });
  const used = new Set(ex.used.map(squashQ));
  const on = new Set(cards.map(squashQ));
  const left = pool.some((e) => !on.has(squashQ(e.q)) && !used.has(squashQ(e.q)) && !exampleBlocked(e, ctx));
  const nextInMs = cards.length < EXAMPLE_TUNING.maxVisible && left ? Math.max(0, nextDealAt(play, Math.max(ex.ms, live)) - Math.max(ex.ms, live)) : null;
  return { cards, nextInMs };
}
