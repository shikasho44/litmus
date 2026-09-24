/**
 * Public asset helpers. The site is served from a sub-folder (vite base './'), so every
 * public path must be resolved against document.baseURI — never start paths with '/'.
 *
 * Images are probed before use so a missing file never shows a broken-image icon:
 * components render their designed CSS/SVG fallback until `probeImage` resolves true.
 */
import { signal, type Signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';

export function assetUrl(path: string): string {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const clean = path.replace(/^\.?\//, '');
  try {
    return new URL(clean, document.baseURI).href;
  } catch {
    return clean;
  }
}

const probes = new Map<string, Promise<boolean>>();
const known = new Map<string, boolean>();

/** Resolves true if the image loads & decodes. Cached per URL. Never rejects. */
export function probeImage(path: string | undefined | null): Promise<boolean> {
  if (!path) return Promise.resolve(false);
  const url = assetUrl(path);
  let p = probes.get(url);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      const done = (ok: boolean) => {
        known.set(url, ok);
        resolve(ok);
      };
      img.onload = () => done(img.naturalWidth > 0);
      img.onerror = () => done(false);
      img.src = url;
    });
    probes.set(url, p);
  }
  return p;
}

/** Synchronous cache lookup (undefined = not probed yet). */
export function imageKnown(path: string | undefined | null): boolean | undefined {
  if (!path) return false;
  return known.get(assetUrl(path));
}

/**
 * Hook: returns the resolved URL once the image is known to exist, otherwise null.
 * Components render their fallback while null.
 */
export function useImage(path: string | undefined | null): string | null {
  const [ok, setOk] = useState<boolean>(() => imageKnown(path) === true);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setOk(false);
      return;
    }
    const k = imageKnown(path);
    if (k !== undefined) setOk(k);
    else setOk(false);
    probeImage(path).then((r) => alive && setOk(r));
    return () => {
      alive = false;
    };
  }, [path]);
  return ok && path ? assetUrl(path) : null;
}

/**
 * Hook: true only once the image is known to be missing/broken (false while it is loading).
 * For heavyweight stand-ins that should not be fetched just because the real art is slow.
 */
export function useImageMissing(path: string | undefined | null): boolean {
  const [missing, setMissing] = useState<boolean>(() => imageKnown(path) === false);
  useEffect(() => {
    let alive = true;
    setMissing(imageKnown(path) === false);
    probeImage(path).then((r) => alive && setMissing(!r));
    return () => {
      alive = false;
    };
  }, [path]);
  return missing;
}

/** Fetch a JSON asset from public/, returning null on any failure. */
export async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(assetUrl(path), { cache: 'force-cache' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Holma sprite metadata (public/art/holma/meta.json)                   */
/* ------------------------------------------------------------------ */
export interface SpriteMeta {
  w: number;
  h: number;
  face: { x: number; y: number };
}
export type HolmaMeta = Partial<Record<'normal' | 'laugh' | 'surprised' | 'serious', SpriteMeta>>;

export const holmaMeta: Signal<HolmaMeta | null> = signal(null);
let metaLoading = false;
export function loadHolmaMeta() {
  if (metaLoading) return;
  metaLoading = true;
  fetchJson<HolmaMeta>('art/holma/meta.json').then((m) => {
    holmaMeta.value = m && typeof m === 'object' ? m : {};
  });
}

/** Well-known art paths (the art builder writes these). */
export const ART = {
  keyArt: 'art/key-art.webp',
  roomZero: 'art/bg-room-zero.webp',
  inquest: 'art/bg-inquest.webp',
  science: 'art/bg-science.webp',
  holma: (mood: string) => `art/holma/${mood}.webp`,
} as const;

// Boot-time warming is staged in src/main.tsx (warmArt): key art first, the rest when idle.
