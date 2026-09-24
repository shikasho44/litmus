/**
 * ③ 真相再構成 — the comic strip. Blank frames show 「？」 and their question; the player
 * picks a piece for each, submits, and wrong frames shake. When everything fits, the scene
 * runs the finale (Holma narrates while the frames light up in order).
 */
import { gsap } from 'gsap';
import { useEffect, useRef } from 'preact/hooks';
import { audio } from '../../audio';
import { motionReduced } from '../../fx/motion';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { ComicPanel, type PanelState } from './ComicPanel';
import type { InquestSession } from './session';

type ReconPanel = NonNullable<InquestSession['recon']['value']>['panels'][number];

export function panelState(s: InquestSession, p: ReconPanel): PanelState {
  if (!p.choice) return 'open';
  if (s.phase.value === 'finale' || s.phase.value === 'done' || s.progress.value?.reconstructed) return 'revealed';
  if (s.verified.value[p.id]) return 'verified';
  if (s.wrongPanels.value.has(p.id)) return 'wrong';
  return typeof s.picks.value[p.id] === 'number' ? 'picked' : 'blank';
}

export function ChoicePicker({ session: s, panelId, onPicked }: { session: InquestSession; panelId: string; onPicked?: (panelId: string) => void }) {
  const view = s.recon.value;
  const idx = view?.panels.findIndex((p) => p.id === panelId) ?? -1;
  const p = idx >= 0 ? view!.panels[idx] : null;
  if (!p || !p.choice) return null;
  const cur = s.picks.value[p.id];
  const locked = !!s.verified.value[p.id];
  return (
    <div class="choice" data-choice-for={p.id}>
      <span class="choice__k">
        コマ {idx + 1} の空白 <b>BLANK</b>
      </span>
      <p class="choice__prompt">{p.choice.prompt}</p>
      <ol class="choice__opts">
        {p.choice.options.map((o, i) => (
          <li key={i}>
            <button
              type="button"
              class={`choice__opt ${cur === i ? 'is-on' : ''}`}
              aria-pressed={cur === i}
              disabled={locked}
              data-option={i}
              onClick={() => {
                audio.sfx('page');
                s.pick(p.id, i);
                onPicked?.(p.id);
              }}
            >
              <span class="choice__num">{String.fromCharCode(65 + i)}</span>
              <span class="choice__text">{o}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface ReconBoardProps {
  session: InquestSession;
  narrow: boolean;
  onOpenPanel: (id: string) => void;
  onSubmit: () => void;
  onFinish: () => void;
  /** After a piece was picked in the side panel (the scene moves on to the next blank). */
  onPicked?: (panelId: string) => void;
  choosing: string | null;
  /** Increment to shake the wrong frames. */
  shakeKey: number;
}

export function ReconBoard({ session: s, narrow, onOpenPanel, onSubmit, onFinish, onPicked, choosing, shakeKey }: ReconBoardProps) {
  const view = s.recon.value;
  const page = useRef<HTMLDivElement>(null);
  const phase = s.phase.value;
  const finale = phase === 'finale';
  const done = phase === 'done';
  const active = s.activePanel.value;
  const blanks = s.blanks.value;
  const filled = blanks.filter((p) => typeof s.picks.value[p.id] === 'number').length;
  const seed = s.caseId;

  // wrong frames shake
  useEffect(() => {
    if (!shakeKey || !page.current) return;
    const els = page.current.querySelectorAll('.cpanel--wrong');
    if (!els.length) return;
    if (narrow) els[0].scrollIntoView({ block: 'center', behavior: motionReduced() ? 'auto' : 'smooth' });
    if (motionReduced()) return;
    const tl = gsap.timeline();
    tl.to(els, { x: -10, duration: 0.05 }).to(els, { x: 10, duration: 0.05, repeat: 5, yoyo: true }).to(els, { x: 0, duration: 0.08 });
    return () => tl.kill();
  }, [shakeKey]);

  // finale camera: follow the lit frame
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    if (!finale || !active) {
      gsap.to(el, { scale: 1, x: 0, y: 0, duration: 0.6, ease: 'power3.out' });
      // phone: the narration starts from the first frame, not where 確定 was pressed
      if (finale && narrow) el.parentElement?.scrollTo({ top: 0, behavior: motionReduced() ? 'auto' : 'smooth' });
      return;
    }
    const target = el.querySelector<HTMLElement>(`[data-panel-id="${active}"]`);
    if (!target) return;
    if (narrow) {
      // the scroller keeps room under the lit frame for Holma's (measured) box: scroll-padding
      target.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'center' });
      return;
    }
    if (motionReduced()) return;
    const pr = el.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const cx = (tr.left + tr.width / 2 - pr.left) / pr.width - 0.5;
    const cy = (tr.top + tr.height / 2 - pr.top) / pr.height - 0.5;
    gsap.to(el, { scale: 1.05, x: -cx * pr.width * 0.08, y: -cy * pr.height * 0.08, duration: 1.1, ease: 'power2.inOut' });
  }, [active, finale, narrow]);

  if (!view) return null;
  const litUpTo = s.finaleIndex.value;

  return (
    <div class={`recon ${finale ? 'is-finale' : ''} ${done ? 'is-done' : ''}`} data-recon-count={view.panels.length}>
      <header class="recon__head">
        <span class="recon__kicker">
          <Icon name="shard" size={16} /> 真相再構成 <b>RECONSTRUCTION</b>
        </span>
        <p class="recon__intro">{finale || done ? 'すべてのコマが、つながった。' : view.intro}</p>
      </header>

      <div class="recon__body">
        <div class="recon__pagewrap">
          <div ref={page} class={`recon__page n${view.panels.length}`}>
            {view.panels.map((p, i) => {
              const st = panelState(s, p);
              const pickIdx = s.picks.value[p.id];
              const lit = finale && i <= litUpTo;
              return (
                <ComicPanel
                  key={p.id}
                  id={p.id}
                  index={i}
                  image={p.image}
                  caption={p.caption}
                  prompt={p.choice?.prompt}
                  pickText={typeof pickIdx === 'number' ? p.choice?.options[pickIdx] : undefined}
                  state={st}
                  active={finale ? active === p.id : choosing === p.id}
                  lit={lit}
                  dim={finale && !lit}
                  seed={seed}
                  onOpen={!finale && !done ? () => onOpenPanel(p.id) : undefined}
                />
              );
            })}
          </div>
        </div>

        {!narrow && !finale && !done && (
          <aside class="recon__side">
            {choosing ? (
              <ChoicePicker key={choosing} session={s} panelId={choosing} onPicked={onPicked} />
            ) : (
              <div class="choice choice--idle">
                <span class="choice__k">
                  空白のコマ <b>{blanks.length}</b>
                </span>
                <p class="choice__prompt">「？」のコマを選んで、そこに入る場面を決めてください。</p>
                <ol class="choice__list">
                  {blanks.map((p) => {
                    const i = view.panels.indexOf(p);
                    const st = panelState(s, p);
                    return (
                      <li key={p.id}>
                        <button type="button" class={`choice__jump is-${st}`} onClick={() => onOpenPanel(p.id)}>
                          <span class="choice__num">{i + 1}</span>
                          <span class="choice__text">{p.choice!.prompt}</span>
                          <span class="choice__state">{st === 'verified' ? '確定' : st === 'wrong' ? '違う' : st === 'picked' ? '選択済' : '未選択'}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </aside>
        )}
      </div>

      {!finale && (
        <footer class="recon__foot">
          {done ? (
            <Button variant="big-cta" size="lg" iconRight="chevronRight" en="IDENTITY" onClick={onFinish} data-recon-next>
              身元回復へ
            </Button>
          ) : (
            <>
              <span class="recon__progress t-mono" aria-live="polite">
                空白 {filled}/{blanks.length}
              </span>
              <Button variant="danger" size="lg" icon="check" en="CONFIRM" disabled={!s.allPicked.value || s.busy.value || !!s.dialogue.value} onClick={onSubmit} data-recon-submit>
                この真相で確定する
              </Button>
            </>
          )}
        </footer>
      )}
    </div>
  );
}
