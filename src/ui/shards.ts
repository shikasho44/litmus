/** Deterministic Voronoi shard layout for the Jane Doe portrait (pure, no DOM). */
import { rng } from '../lib/rng';

export type Pt = [number, number];
export interface Shard {
  id: string;
  index: number;
  points: Pt[];
  center: Pt;
  /** reveal order rank (0 = first) */
  order: number;
}

export const SHARD_W = 300;
export const SHARD_H = 400;

/** Silhouette of a woman's bust in the 300×400 box (hair bob, neck, shoulders). */
export const JANE_SILHOUETTE =
  'M150 52 C198 52 226 88 228 136 C230 170 226 198 234 224 C240 244 232 260 214 266 L198 270 C194 284 194 296 198 304 C242 314 284 332 297 372 L300 400 L0 400 L3 372 C16 332 58 314 102 304 C106 296 106 284 102 270 L86 266 C68 260 60 244 66 224 C74 198 70 170 72 136 C74 88 102 52 150 52 Z';

function clip(poly: Pt[], mid: Pt, n: Pt): Pt[] {
  const out: Pt[] = [];
  const side = (p: Pt) => (p[0] - mid[0]) * n[0] + (p[1] - mid[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa <= 0) !== (sb <= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function centroid(p: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const q of p) {
    x += q[0];
    y += q[1];
  }
  return [x / p.length, y / p.length];
}

const cache = new Map<string, Shard[]>();

/**
 * Generate `count` shards covering the 300×400 box. Sites use Mitchell's best-candidate
 * sampling with extra density around the face so the features resolve early.
 */
export function makeShards(count: number, seed: string | number = 'jane'): Shard[] {
  const key = `${count}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rand = rng(`shards:${seed}`);
  const face: Pt = [150, 165];
  const density = (p: Pt) => {
    const d = Math.hypot((p[0] - face[0]) / 1.1, p[1] - face[1]);
    return 1 + 1.4 * Math.exp(-(d * d) / (2 * 90 * 90));
  };
  const sites: Pt[] = [];
  for (let i = 0; i < count; i++) {
    let best: Pt = [rand() * SHARD_W, rand() * SHARD_H];
    let bestScore = -1;
    for (let k = 0; k < 24; k++) {
      const c: Pt = [8 + rand() * (SHARD_W - 16), 8 + rand() * (SHARD_H - 16)];
      let md = Infinity;
      for (const s of sites) md = Math.min(md, Math.hypot(c[0] - s[0], c[1] - s[1]));
      const score = md * density(c);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    sites.push(best);
  }
  const rect: Pt[] = [
    [0, 0],
    [SHARD_W, 0],
    [SHARD_W, SHARD_H],
    [0, SHARD_H],
  ];
  const shards: Shard[] = sites.map((s, i) => {
    let poly = rect;
    for (let j = 0; j < sites.length && poly.length; j++) {
      if (j === i) continue;
      const o = sites[j];
      poly = clip(poly, [(s[0] + o[0]) / 2, (s[1] + o[1]) / 2], [o[0] - s[0], o[1] - s[1]]);
    }
    return { id: `s${i}`, index: i, points: poly, center: centroid(poly), order: 0 };
  });
  // reveal order: near the face first, with jitter so it feels like scattered glass lighting up
  const ranked = shards
    .map((sh) => ({ sh, k: Math.hypot(sh.center[0] - face[0], (sh.center[1] - face[1]) * 0.9) + rand() * 150 }))
    .sort((a, b) => a.k - b.k);
  ranked.forEach((r, i) => (r.sh.order = i));
  cache.set(key, shards);
  return shards;
}

export const pointsAttr = (p: Pt[]) => p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
