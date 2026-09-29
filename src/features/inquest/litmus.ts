/**
 * 反証 (litmus test) staging: the set 所見 card glides from the findings case to the chosen 誤差
 * like a strip of litmus paper and touches the word with its acid-red pad.
 *   const f = applyCard(fromEl, toEl, '入館記録');
 *   await f.touch;             // the pad is on the word
 *   await f.finish(reacted);   // 反応あり: the pad turns blue and lifts off / 反応なし: stays red, slides off
 * Reduced motion: no flight — touch resolves at once.
 */
import { gsap } from 'gsap';
import { motionReduced } from '../../fx/motion';

export interface CardFlight {
  touch: Promise<void>;
  finish(reacted: boolean): Promise<void>;
}

/** A card Holma lends (泣きつく) tossed into the findings case (arc, spin, settle). */
export function flyCard(from: Element | null, to: Element | null, label: string): Promise<void> {
  if (!from || !to || motionReduced()) return Promise.resolve();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'card-fly card-fly--gift';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="card-fly__card"><b>GIFT</b><span></span></span>`;
  (el.querySelector('.card-fly__card span') as HTMLElement).textContent = label;
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

/**
 * The set card as a litmus strip: it lifts out of the case, glides over (a shallow arc, not a
 * shot) and presses its pad on the top edge of the word, so the word stays readable under it.
 */
export function applyCard(from: Element | null, to: Element | null, label: string): CardFlight {
  if (!from || !to || motionReduced()) {
    return { touch: Promise.resolve(), finish: () => Promise.resolve() };
  }
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;

  const el = document.createElement('div');
  el.className = 'card-fly card-fly--strip';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="card-fly__card"><b>所見</b><span></span><i class="card-fly__pad"></i></span>`;
  (el.querySelector('.card-fly__card span') as HTMLElement).textContent = label;
  el.style.left = `${ax}px`;
  el.style.top = `${ay}px`;
  document.body.appendChild(el);
  const card = el.querySelector('.card-fly__card') as HTMLElement;
  const h = card.offsetHeight || 44;

  const scale = 0.84;
  // centre of the card when its pad (bottom edge) rests on the upper third of the word
  const bx = b.left + b.width / 2;
  const by = b.top + Math.min(b.height * 0.34, 14) - (h * scale) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const lean = dx >= 0 ? -5 : 5;

  let touched!: () => void;
  const touch = new Promise<void>((r) => (touched = r));
  const tl = gsap.timeline();
  tl.set(el, { xPercent: -50, yPercent: -50, rotation: 0, scale: 0.9, opacity: 0 })
    .to(el, { opacity: 1, scale: 1.06, rotation: lean * 0.6, y: -10, duration: 0.14, ease: 'power2.out' })
    .to(el, { x: dx, duration: 0.36, ease: 'power2.inOut' })
    .to(el, { y: dy - 16, scale, rotation: lean, duration: 0.3, ease: 'power1.out' }, '<')
    // the press: down onto the word, the paper squashing a little
    .to(el, { y: dy, scaleY: scale * 0.94, duration: 0.09, ease: 'power2.in' })
    .add(() => touched());

  const remove = () => {
    tl.kill();
    el.remove();
  };

  return {
    touch,
    finish(reacted: boolean) {
      return new Promise<void>((resolve) => {
        const t2 = gsap.timeline({ onComplete: () => (remove(), resolve()) });
        if (reacted) {
          el.classList.add('is-reacted'); // the pad develops blue (CSS transition)
          // lift off at once, so the word itself is seen changing colour under the bloom
          t2.to(el, { scaleY: scale, duration: 0.1, ease: 'power2.out' })
            .to(el, { y: dy - 52, rotation: lean * 0.4, duration: 0.34, ease: 'power2.out' }, 0.08)
            .to(el, { opacity: 0, duration: 0.24, ease: 'power1.in' }, 0.3);
        } else {
          el.classList.add('is-inert'); // the pad stays red: a faint flicker, nothing develops
          // a beat on the word, then it slides off and drops away below (the 反応なし tag goes above)
          const dir = dx >= 0 ? 1 : -1;
          t2.to(el, { scaleY: scale, duration: 0.1, ease: 'power2.out' })
            .to(el, { x: `+=${dir * 40}`, rotation: lean + dir * 12, duration: 0.14, ease: 'power2.out' }, 0.2)
            .to(el, { y: '+=170', opacity: 0, rotation: `+=${dir * 20}`, duration: 0.36, ease: 'power2.in' }, 0.26);
        }
      });
    },
  };
}
