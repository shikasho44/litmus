import { useState } from 'preact/hooks';
import type { HolmaMood } from '../../shared/api';

let uid = 0;

/**
 * Vector fallback for Holma (used whenever public/art/holma/<mood>.webp is missing).
 * A white taxidermy rabbit in an oversized lab coat: black button right eye, red glass
 * left eye, formalin bow tie, stitched neck and ear, specimen tag "No.0" pinned to one ear.
 * viewBox 0 0 400 520, bust-up composition anchored at the bottom.
 */
export function HolmaVector({ mood = 'normal', class: cls }: { mood?: HolmaMood; class?: string }) {
  const surprised = mood === 'surprised';
  const laugh = mood === 'laugh';
  const serious = mood === 'serious';
  const earLift = surprised ? -22 : laugh ? -6 : 0;
  const headTilt = laugh ? -5 : serious ? 0 : surprised ? 2 : -2;
  const INK = '#0B0D12';
  const FUR = '#F2EFE6';
  const SHADE = '#1B3A44';
  const [u] = useState(() => `hv${++uid}`);
  return (
    <svg class={`holma-vector ${cls ?? ''}`} viewBox="0 0 400 520" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`${u}-dots`} width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="3.5" cy="3.5" r="1.5" fill={SHADE} />
        </pattern>
        <radialGradient id={`${u}-glass`} cx="0.38" cy="0.34" r="0.75">
          <stop offset="0" stop-color="#FF8FA9" />
          <stop offset="0.45" stop-color="#FF2E63" />
          <stop offset="1" stop-color="#6E0624" />
        </radialGradient>
        <linearGradient id={`${u}-coat`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#FFFFFF" />
          <stop offset="1" stop-color="#D5D0C2" />
        </linearGradient>
      </defs>

      {/* ---------------- lab coat ---------------- */}
      <g stroke={INK} stroke-width="5" stroke-linejoin="round">
        <path d="M22 520 C30 430 88 372 200 362 C312 372 370 430 378 520 Z" fill={`url(#${u}-coat)`} />
        {/* shirt V */}
        <path d="M150 372 L200 470 L250 372 Z" fill="#1E2430" />
        {/* lapels */}
        <path d="M138 370 L200 488 L168 520 L112 520 L126 440 L104 420 Z" fill="#FBF9F3" />
        <path d="M262 370 L200 488 L232 520 L288 520 L274 440 L296 420 Z" fill="#FBF9F3" />
        {/* pocket + pen */}
        <path d="M282 462 h52 l-4 44 h-44 z" fill="#EAE6DA" stroke-width="4" />
        <path d="M300 440 v30" stroke="#3DE0FF" stroke-width="6" stroke-linecap="round" />
        {/* sleeve fold shading */}
        <path d="M40 500 C60 460 80 440 100 432" fill="none" stroke-width="3" opacity="0.5" />
        <path d="M360 500 C340 460 320 440 300 432" fill="none" stroke-width="3" opacity="0.5" />
      </g>
      <path d="M40 520 C50 460 90 420 120 410 L126 440 L112 520 Z" fill={`url(#${u}-dots)`} opacity="0.45" />

      {/* ---------------- bow tie ---------------- */}
      <g stroke={INK} stroke-width="4.5" stroke-linejoin="round">
        <path d="M200 382 L150 356 L146 404 Z" fill="#C6FF3D" />
        <path d="M200 382 L250 356 L254 404 Z" fill="#C6FF3D" />
        <rect x="186" y="368" width="28" height="28" rx="6" fill="#9ED21E" />
      </g>

      {/* ---------------- head group ---------------- */}
      <g transform={`rotate(${headTilt} 200 250)`}>
        {/* ears */}
        <g transform={`translate(0 ${earLift})`} stroke={INK} stroke-width="5" stroke-linejoin="round">
          {/* upright ear (viewer left) */}
          <path d="M150 196 C118 130 112 44 140 20 C170 0 192 92 186 190 Z" fill={FUR} />
          <path d="M156 180 C136 130 134 70 146 46 C160 40 172 110 172 176 Z" fill="#E7C9CC" stroke="none" />
          {/* folded ear (viewer right) */}
          <g transform={surprised ? 'rotate(-18 250 190)' : ''}>
            <path d="M226 192 C230 128 244 84 276 62 C306 44 336 58 326 76 C306 92 280 114 266 192 Z" fill={FUR} />
            <path d="M240 180 C244 134 256 102 280 82 C296 72 308 74 304 82 C288 96 270 118 256 180 Z" fill="#E7C9CC" stroke="none" />
            {/* ear stitches */}
            <path d="M246 150 l20 6 M244 136 l20 6 M248 122 l18 6" stroke-width="3" stroke-linecap="round" />
            {/* specimen tag */}
            <g transform="rotate(14 300 110)">
              <line x1="296" y1="80" x2="300" y2="104" stroke-width="2.5" />
              <rect x="276" y="104" width="54" height="30" rx="2" fill="#F2EFE6" stroke-width="3.5" />
              <circle cx="284" cy="119" r="3" fill={INK} stroke="none" />
              <text x="310" y="125" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="15" font-weight="700" fill={INK} stroke="none">
                No.0
              </text>
            </g>
            <circle cx="296" cy="78" r="6" fill="#FF2E63" stroke-width="3" />
          </g>
        </g>

        {/* head */}
        <path
          d="M200 168 C262 166 300 206 300 256 C300 292 286 314 262 330 C246 340 226 346 200 346 C174 346 154 340 138 330 C114 314 100 292 100 256 C100 206 138 166 200 168 Z"
          fill={FUR}
          stroke={INK}
          stroke-width="5"
        />
        {/* cheek fluff */}
        <path d="M104 282 l-16 10 l18 2 l-12 14 l20 -4" fill={FUR} stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M296 282 l16 10 l-18 2 l12 14 l-20 -4" fill={FUR} stroke={INK} stroke-width="4" stroke-linejoin="round" />
        {/* halftone shade */}
        <path d="M112 280 C120 320 160 342 200 344 C170 330 140 306 128 270 Z" fill={`url(#${u}-dots)`} opacity="0.55" />
        {/* neck stitches */}
        <path d="M140 338 C170 352 230 352 262 338" fill="none" stroke={INK} stroke-width="3" stroke-dasharray="9 7" />
        <path d="M150 334 l-3 12 M176 342 l-2 12 M202 344 v12 M228 342 l2 12 M252 334 l3 12" stroke={INK} stroke-width="2.5" stroke-linecap="round" />

        {/* eyes */}
        {/* button eye (viewer left) */}
        <g>
          <circle cx="160" cy="246" r={surprised ? 21 : 18} fill="#171B24" stroke={INK} stroke-width="4" />
          <circle cx="160" cy="246" r={surprised ? 15 : 12.5} fill="none" stroke="#39404F" stroke-width="2.5" />
          <g fill="#8A93A6">
            <circle cx="155" cy="241" r="2.6" />
            <circle cx="165" cy="241" r="2.6" />
            <circle cx="155" cy="251" r="2.6" />
            <circle cx="165" cy="251" r="2.6" />
          </g>
          <path d="M155 241 L165 251 M165 241 L155 251" stroke="#C6FF3D" stroke-width="1.6" opacity="0.9" />
        </g>
        {/* glass eye (viewer right) */}
        <g>
          <circle cx="242" cy="246" r={surprised ? 22 : 19} fill={`url(#${u}-glass)`} stroke={INK} stroke-width="4" />
          <ellipse cx="235" cy="238" rx="6" ry="4.5" fill="#FFFFFF" opacity="0.9" transform="rotate(-30 235 238)" />
          <circle cx="250" cy="254" r="2.2" fill="#FFFFFF" opacity="0.6" />
        </g>
        {/* lids */}
        {serious && (
          <g stroke={INK} stroke-width="5" stroke-linecap="round">
            <path d="M138 234 C150 228 172 228 184 236" />
            <path d="M218 236 C230 228 252 228 266 234" />
          </g>
        )}
        {laugh && (
          <g stroke={INK} stroke-width="4" stroke-linecap="round" fill="none">
            <path d="M140 226 C150 216 170 216 180 222" />
            <path d="M222 222 C232 216 252 216 262 226" />
          </g>
        )}

        {/* nose */}
        <path d="M190 282 h20 l-10 11 z" fill="#C98E98" stroke={INK} stroke-width="3.5" stroke-linejoin="round" />
        {/* mouth */}
        <g stroke={INK} stroke-width="4" stroke-linecap="round" fill="none">
          {mood === 'normal' && (
            <>
              <path d="M200 293 v9" />
              <path d="M200 302 C192 310 180 310 174 302" />
              <path d="M200 302 C210 312 224 310 232 296" />
            </>
          )}
          {laugh && (
            <>
              <path d="M200 293 v6" />
              <path d="M170 300 C180 344 222 344 232 300 Z" fill="#1E0E14" stroke-linejoin="round" />
              <path d="M192 301 h8 v13 h-8 z M201 301 h8 v13 h-8 z" fill={FUR} stroke-width="2.5" />
              <path d="M184 326 C194 334 210 334 218 326" stroke="#FF2E63" stroke-width="5" opacity="0.8" />
            </>
          )}
          {surprised && (
            <>
              <path d="M200 293 v7" />
              <ellipse cx="200" cy="313" rx="9" ry="12" fill="#1E0E14" />
            </>
          )}
          {serious && (
            <>
              <path d="M200 293 v9" />
              <path d="M184 306 h32" />
            </>
          )}
        </g>
        {/* whiskers */}
        <g stroke={INK} stroke-width="2" stroke-linecap="round" opacity="0.55">
          <path d="M176 292 L122 282 M176 298 L120 300 M178 304 L126 316" />
          <path d="M224 292 L278 282 M224 298 L280 300 M222 304 L274 316" />
        </g>
      </g>

      {/* probe (silver pointer) */}
      <g transform="rotate(-24 70 470)">
        <rect x="64" y="330" width="9" height="170" rx="4" fill="#C9CED8" stroke={INK} stroke-width="3.5" />
        <circle cx="68.5" cy="328" r="7" fill="#E6E9EF" stroke={INK} stroke-width="3.5" />
      </g>
    </svg>
  );
}
