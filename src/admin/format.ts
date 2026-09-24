/** Small formatting helpers for the admin console. */

export const fmtMs = (ms: number | undefined): string => {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
};

export const fmtUsd = (v: number | undefined, digits = 6): string => {
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  return `$${v.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}`;
};

/** USD → JPY at a rough fixed rate (display hint only). */
export const fmtYen = (usd: number | undefined, rate = 150): string => {
  if (usd === undefined || !Number.isFinite(usd)) return '—';
  const y = usd * rate;
  return y === 0 ? '0円' : y < 0.01 ? `${y.toExponential(1)}円` : `${y.toFixed(y < 1 ? 4 : 2)}円`;
};

export const fmtPct = (v: number | undefined, digits = 1): string =>
  v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`;

export const fmtNum = (v: number | undefined, digits = 3): string => {
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return v.toLocaleString('ja-JP');
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
};

export const fmtBytes = (n: number | undefined): string => {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export const fmtUptime = (sec: number | undefined): string => {
  if (sec === undefined || !Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return d > 0 ? `${d}日 ${h}時間` : h > 0 ? `${h}時間 ${m}分` : m > 0 ? `${m}分 ${s}秒` : `${s}秒`;
};

const pad = (n: number) => String(n).padStart(2, '0');
export const fmtTime = (iso: string | number | undefined, withDate = false): string => {
  if (iso === undefined) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return withDate ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${t}` : t;
};

export const fmtAgo = (at: number | string | undefined, now = Date.now()): string => {
  if (at === undefined) return '—';
  const t = typeof at === 'number' ? at : new Date(at).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
};

export const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Splits "text with [[noise]] spans" into segments. */
export function noiseSegments(text: string): { text: string; noise: boolean }[] {
  const out: { text: string; noise: boolean }[] = [];
  const re = /\[\[(.+?)\]\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), noise: false });
    out.push({ text: m[1], noise: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), noise: false });
  return out;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
