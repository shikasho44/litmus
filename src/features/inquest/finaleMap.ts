/**
 * Which comic panel each finale narration line belongs to.
 *
 * The case file keeps Holma's finale as plain strings (no panel ids), and the lines do not
 * spread evenly over the panels (c01: 8 lines, 5 panels — two lines for panel 3, a closing
 * line that belongs to none). Splitting by position lit the wrong frame. Instead each line
 * is matched to the panel whose caption (and scene brief) shares the most wording with it,
 * under one rule: the story only moves forward (panel indices never decrease). Lines that
 * match nothing (a closing moral) stay on the frame before them.
 *
 * Solved exactly with a small dynamic programme: maximise Σ similarity − a tiny pull towards
 * the proportional position (tie-breaker), over non-decreasing assignments.
 */

const STRIP = /[\s、。，．・！？!?「」『』（）()〔〕［］\[\]…―—\-─〜~：:；;"'“”‘’0-9０-９]/g;

function grams(text: string): Set<string> {
  const t = text.replace(STRIP, '');
  const out = new Set<string>();
  const ch = Array.from(t);
  for (let i = 0; i + 1 < ch.length; i++) out.add(ch[i] + ch[i + 1]);
  return out;
}

/** Share of the line's character bigrams that also occur in the panel text (0..1). */
function overlap(line: Set<string>, panel: Set<string>): number {
  if (!line.size || !panel.size) return 0;
  let hit = 0;
  for (const g of line) if (panel.has(g)) hit++;
  return hit / line.size;
}

export interface FinalePanel {
  id: string;
  caption?: string;
  scene?: string;
}

/**
 * Returns, for every finale line, the index of the panel to light (non-decreasing).
 * With no text to go on it falls back to spreading the lines evenly.
 */
export function mapFinaleToPanels(lines: readonly string[], panels: readonly FinalePanel[]): number[] {
  const L = lines.length;
  const P = panels.length;
  if (!L) return [];
  if (P <= 1) return lines.map(() => 0);
  const lg = lines.map(grams);
  const pg = panels.map((p) => grams(`${p.caption ?? ''}${p.scene ?? ''}`));
  const sim = lg.map((g) => pg.map((q) => overlap(g, q)));
  const prior = (k: number, p: number) => 0.04 * Math.abs(p / (P - 1) - (L > 1 ? k / (L - 1) : 0));
  const score = (k: number, p: number) => sim[k][p] - prior(k, p);

  // best[k][p]: best total for lines 0..k with line k on panel p
  const best: number[][] = [];
  const from: number[][] = [];
  for (let k = 0; k < L; k++) {
    best.push(new Array(P).fill(-Infinity));
    from.push(new Array(P).fill(0));
    for (let p = 0; p < P; p++) {
      if (k === 0) {
        best[k][p] = score(k, p);
        continue;
      }
      let m = -Infinity;
      let arg = 0;
      for (let q = 0; q <= p; q++) {
        if (best[k - 1][q] > m) {
          m = best[k - 1][q];
          arg = q;
        }
      }
      best[k][p] = m + score(k, p);
      from[k][p] = arg;
    }
  }
  let p = 0;
  for (let q = 1; q < P; q++) if (best[L - 1][q] > best[L - 1][p]) p = q;
  const out = new Array<number>(L);
  for (let k = L - 1; k >= 0; k--) {
    out[k] = p;
    p = from[k][p];
  }
  // No textual signal at all (e.g. captions still hidden): spread evenly.
  if (sim.every((row) => row.every((v) => v === 0))) return lines.map((_, k) => Math.min(P - 1, Math.floor((k * P) / L)));
  return out;
}
