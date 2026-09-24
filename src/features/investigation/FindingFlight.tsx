import { gsap } from 'gsap';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { motionReduced } from '../../fx/motion';
import { portalRoot } from '../../ui/dialog';
import { EvidenceCard } from '../../ui/EvidenceCard';
import type { Controller, FlightRequest } from './controller';

/** The first visible notebook target (side panel header on PC, else the top-bar button). */
function notebookTarget(): DOMRect | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-notebook-target]'));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 4 && r.height > 4 && el.closest('[inert],[aria-hidden="true"]') === null) return r;
  }
  return null;
}

function Flight({ req, onDone, onSkip }: { req: FlightRequest; onDone: () => void; onSkip: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stage = document.querySelector<HTMLElement>('[data-stage]')?.getBoundingClientRect();
    const cx = stage ? stage.left + stage.width / 2 : window.innerWidth / 2;
    const cy = stage ? stage.top + stage.height * 0.52 : window.innerHeight / 2;
    gsap.set(el, { left: cx, top: cy });
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.flight__card'));
    const burst = el.querySelector('.flight__burst');
    const label = el.querySelector('.flight__label');
    const t = notebookTarget();
    const tx = t ? t.left + t.width / 2 - cx : -cx + 40;
    const ty = t ? t.top + t.height / 2 - cy : -cy + 30;
    const n = cards.length;
    gsap.set(cards, { xPercent: -50, yPercent: -50 });
    const tl = gsap.timeline({ onComplete: onDone });
    if (motionReduced()) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2 }).to(el, { opacity: 0, duration: 0.25 }, req.compact ? '+=0.5' : '+=0.9');
      return () => tl.kill();
    }
    if (req.compact) {
      // compact (≈1.1 s): the card pops up small beside the stage centre, holds a beat, flies home
      tl.fromTo(burst, { scale: 0.2, opacity: 0.7 }, { scale: 0.9, opacity: 0, duration: 0.45, ease: 'power2.out' }, 0);
      tl.fromTo(label, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, ease: 'power3.out' }, 0);
      cards.forEach((c, i) => {
        const off = i - (n - 1) / 2;
        tl.fromTo(
          c,
          { scale: 0.3, opacity: 0, rotation: -10, y: 30, x: off * 20 },
          { scale: 0.72, opacity: 1, rotation: off * 5 - 2, y: 0, x: off * 120, duration: 0.26, ease: 'back.out(1.6)' },
          0.02 + i * 0.05,
        );
      });
      tl.to(label, { opacity: 0, duration: 0.15 }, 0.58);
      cards.forEach((c, i) => {
        tl.to(c, { x: tx, y: ty, scale: 0.08, rotation: 18, opacity: 0.3, duration: 0.42, ease: 'power3.in' }, 0.58 + i * 0.05);
      });
      return () => tl.kill();
    }
    tl.fromTo(burst, { scale: 0.2, opacity: 0.9 }, { scale: 1.4, opacity: 0, duration: 0.7, ease: 'power2.out' }, 0);
    tl.fromTo(label, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power3.out' }, 0.05);
    cards.forEach((c, i) => {
      const off = i - (n - 1) / 2;
      tl.fromTo(
        c,
        { scale: 0.35, opacity: 0, rotation: -16 + off * 6, y: 60, x: off * 30 },
        { scale: 1, opacity: 1, rotation: off * 7 - 2, y: Math.abs(off) * 10, x: off * 150, duration: 0.42, ease: 'back.out(1.7)' },
        0.04 + i * 0.08,
      );
    });
    tl.to(label, { opacity: 0, duration: 0.2 }, req.core ? 1.35 : 1.05);
    cards.forEach((c, i) => {
      tl.to(c, { x: tx, y: ty, scale: 0.1, rotation: 24, opacity: 0.35, duration: 0.55, ease: 'power3.in' }, (req.core ? 1.35 : 1.05) + i * 0.07);
    });
    return () => tl.kill();
  }, []);
  return (
    <div class={`flight ${req.core ? 'is-core' : ''} ${req.compact ? 'is-compact' : ''}`} ref={ref} onClick={onSkip} aria-hidden="true">
      <div class="flight__burst" />
      <div class="flight__label">{req.core ? 'CORE FINDING — 核心所見' : 'NEW FINDING — 所見入手'}</div>
      {req.facts.map((f, i) => (
        <div class="flight__card" key={f.id}>
          <EvidenceCard fact={f} isNew index={i} />
        </div>
      ))}
    </div>
  );
}

/** Renders the in-flight 所見 cards (driven by controller.flight). */
export function FindingFlight({ ctl }: { ctl: Controller }) {
  const f = ctl.flight.value;
  if (!f) return null;
  return createPortal(<Flight key={f.id} req={f} onDone={() => ctl.flightDone(f.id)} onSkip={() => ctl.fastForward()} />, portalRoot());
}
