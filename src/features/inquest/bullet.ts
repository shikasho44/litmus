/**
 * The loaded 所見 card streaks from the magazine to the targeted noise.
 *   const f = flyBullet(fromEl, toEl, '入館記録');
 *   await f.impact;           // at the noise
 *   await f.finish(correct);  // burst (hit) or ricochet (miss), then removed
 * Reduced motion: no flight — impact resolves at once.
 */
import { gsap } from 'gsap';
import { motionReduced } from '../../fx/motion';

export interface BulletFlight {
  impact: Promise<void>;
  finish(correct: boolean): Promise<void>;
}

/** A granted card tossed from Holma into the magazine (arc, spin, settle). */
export function flyCard(from: Element | null, to: Element | null, label: string): Promise<void> {
  if (!from || !to || motionReduced()) return Promise.resolve();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'bullet-fly bullet-fly--gift';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="bullet-fly__card"><b>GIFT</b><span></span></span>`;
  (el.querySelector('.bullet-fly__card span') as HTMLElement).textContent = label;
  el.style.left = `${a.left + a.width * 0.45}px`;
  el.style.top = `${a.top + a.height * 0.35}px`;
  document.body.appendChild(el);
  const dx = b.left + b.width / 2 - (a.left + a.width * 0.45);
  const dy = b.top + b.height / 2 - (a.top + a.height * 0.35);
  return new Promise((resolve) => {
    gsap
      .timeline({ onComplete: () => (el.remove(), resolve()) })
      .set(el, { xPercent: -50, yPercent: -50, scale: 0.4, opacity: 0, rotation: 30 })
      .to(el, { scale: 1.25, opacity: 1, rotation: -10, y: -60, duration: 0.3, ease: 'back.out(2)' })
      .to(el, { x: dx, duration: 0.7, ease: 'power2.inOut' }, '>-0.05')
      .to(el, { y: dy, rotation: 0, scale: 0.9, duration: 0.7, ease: 'power2.in' }, '<')
      .to(el, { opacity: 0, scale: 1.1, duration: 0.18 });
  });
}

export function flyBullet(from: Element | null, to: Element | null, label: string): BulletFlight {
  if (!from || !to || motionReduced()) {
    return { impact: Promise.resolve(), finish: () => Promise.resolve() };
  }
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;

  const el = document.createElement('div');
  el.className = 'bullet-fly';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="bullet-fly__trail"></span><span class="bullet-fly__card"><b>所見</b><span></span></span>`;
  (el.querySelector('.bullet-fly__card span') as HTMLElement).textContent = label;
  el.style.left = `${ax}px`;
  el.style.top = `${ay}px`;
  document.body.appendChild(el);
  const trail = el.querySelector('.bullet-fly__trail') as HTMLElement;

  let hit!: () => void;
  const impact = new Promise<void>((r) => (hit = r));
  const tl = gsap.timeline();
  const spin = angle * 0.2; // the card leans into its flight; the trail compensates
  tl.set(el, { xPercent: -50, yPercent: -50, rotation: 0, scale: 0.9, opacity: 0 })
    .set(trail, { rotation: angle - spin })
    .to(el, { opacity: 1, scale: 1.12, rotation: spin - 6, duration: 0.14, ease: 'power2.out' })
    .to(el, { x: bx - ax, y: by - ay, scale: 0.72, rotation: spin, duration: 0.3, ease: 'power4.in' })
    .fromTo(trail, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: 'power4.in' }, '<')
    .add(() => hit());

  const remove = () => {
    tl.kill();
    el.remove();
  };

  return {
    impact,
    finish(correct: boolean) {
      return new Promise<void>((resolve) => {
        const t2 = gsap.timeline({ onComplete: () => (remove(), resolve()) });
        if (correct) {
          t2.to(trail, { opacity: 0, duration: 0.1 }).to(el, { scale: 1.9, opacity: 0, duration: 0.22, ease: 'power2.out' }, 0);
        } else {
          const dir = Math.random() < 0.5 ? -1 : 1;
          t2.to(trail, { opacity: 0, duration: 0.08 })
            .to(el, { x: `+=${dir * 90}`, y: '-=70', rotation: `+=${dir * 200}`, scale: 0.6, duration: 0.32, ease: 'power2.out' }, 0)
            .to(el, { y: '+=220', opacity: 0, rotation: `+=${dir * 120}`, duration: 0.42, ease: 'power2.in' });
        }
      });
    },
  };
}
