/** Glass shatter burst on a full-screen canvas (used for 反証 refutations). */
interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  pts: [number, number][];
  life: number;
  max: number;
  hue: string;
}

export class ShatterCanvas {
  private ctx: CanvasRenderingContext2D | null;
  private pieces: Piece[] = [];
  private rings: { x: number; y: number; t: number; color: string }[] = [];
  private raf = 0;
  private last = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  private fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return dpr;
  }

  burst(x: number, y: number, opts: { count?: number; color?: string; power?: number } = {}) {
    if (!this.ctx) return;
    const dpr = this.fit();
    const count = opts.count ?? 34;
    const power = (opts.power ?? 1) * dpr;
    const color = opts.color ?? '#3DE0FF';
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (260 + Math.random() * 780) * power;
      const size = (6 + Math.random() * 30) * dpr;
      const n = 3 + Math.floor(Math.random() * 2);
      const pts: [number, number][] = [];
      for (let k = 0; k < n; k++) {
        const aa = (k / n) * Math.PI * 2 + Math.random() * 0.9;
        const rr = size * (0.4 + Math.random() * 0.8);
        pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr]);
      }
      const max = 0.7 + Math.random() * 0.6;
      this.pieces.push({
        x: x * dpr,
        y: y * dpr,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 180 * dpr,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 18,
        pts,
        life: max,
        max,
        hue: Math.random() < 0.18 ? '#FF2E63' : Math.random() < 0.5 ? '#FFFFFF' : color,
      });
    }
    this.rings.push({ x: x * dpr, y: y * dpr, t: 0, color });
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    const ctx = this.ctx!;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // rings
    this.rings = this.rings.filter((r) => r.t < 0.5);
    for (const r of this.rings) {
      r.t += dt;
      const k = r.t / 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, (40 + 320 * Math.sqrt(k)) * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.lineWidth = (10 * (1 - k) + 1) * dpr;
      ctx.stroke();
    }
    // pieces
    this.pieces = this.pieces.filter((p) => p.life > 0);
    for (const p of this.pieces) {
      p.life -= dt;
      p.vy += 1500 * dpr * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const a = Math.max(0, p.life / p.max);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      p.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = p.hue;
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = p.hue;
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (this.pieces.length || this.rings.length) this.raf = requestAnimationFrame(this.tick);
    else {
      this.raf = 0;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  };
}
