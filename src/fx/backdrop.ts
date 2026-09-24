/**
 * Living backdrop: formalin-green haze drifting like liquid, floating motes, vignette,
 * scanlines and grain. WebGL fragment shader with a Canvas2D fallback.
 * - renders at half resolution, ~30 fps
 * - pauses when the tab is hidden
 * - reduced motion → one static frame
 * - low-FPS detection → lower resolution, then a static frame; judged on the MEDIAN of a
 *   60-frame window, two bad windows in a row, never in the 2 s after a scene/tone change or a
 *   tab resume (image decodes and font swaps are not the GPU's fault); recovers when smooth
 * - the shader compiles in parallel (KHR_parallel_shader_compile) when available
 * - WebGL context loss → stops; restore → recompiles and resumes
 */
export type BackdropTone = 'formalin' | 'alarm' | 'cyan' | 'amber' | 'violet' | 'dim' | 'truth';

const TONES: Record<BackdropTone, { a: [number, number, number]; b: [number, number, number]; k: number }> = {
  formalin: { a: [0.78, 1.0, 0.24], b: [0.24, 0.88, 1.0], k: 1 },
  alarm: { a: [1.0, 0.18, 0.39], b: [0.61, 0.42, 1.0], k: 1.15 },
  cyan: { a: [0.24, 0.88, 1.0], b: [0.78, 1.0, 0.24], k: 0.95 },
  amber: { a: [1.0, 0.69, 0.13], b: [1.0, 0.18, 0.39], k: 0.9 },
  violet: { a: [0.61, 0.42, 1.0], b: [0.24, 0.88, 1.0], k: 0.9 },
  dim: { a: [0.78, 1.0, 0.24], b: [0.24, 0.88, 1.0], k: 0.45 },
  truth: { a: [0.95, 0.9, 0.75], b: [0.24, 0.88, 1.0], k: 0.8 },
};

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform float uK;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = uv * vec2(asp, 1.0);
  float t = uTime * 0.035;
  vec2 q = vec2(fbm(p*1.25 + vec2(0.0, t)), fbm(p*1.25 + vec2(5.2, -t*1.3)));
  float h = fbm(p*1.6 + q*1.9 + vec2(t*0.7, -t));
  float haze = smoothstep(0.38, 0.98, h);
  vec3 col = vec3(0.043, 0.051, 0.071);
  col += uA * haze * 0.20 * uK;
  col += uB * pow(q.x, 3.0) * 0.07 * uK;
  float ridge = 1.0 - abs(h*2.0 - 1.0);
  col += uA * pow(ridge, 10.0) * 0.07 * uK;
  // floating motes (two layers)
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float sc = mix(11.0, 23.0, fl);
    vec2 g = p*sc - vec2(0.0, uTime*mix(0.22, 0.1, fl));
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float r = hash(id + fl*17.0);
    vec2 off = vec2(hash(id+3.1)-0.5, hash(id+7.7)-0.5)*0.6 + vec2(sin(uTime*0.3 + r*6.28)*0.12, 0.0);
    float d = length(f - off);
    float size = mix(0.055, 0.035, fl);
    float on = step(0.83, r);
    float tw = 0.55 + 0.45*sin(uTime*(0.8 + r*1.6) + r*40.0);
    col += mix(uA, vec3(1.0), 0.35) * on * (1.0 - smoothstep(0.0, size, d)) * tw * 0.5 * uK;
  }
  vec2 c = uv - 0.5; c.x *= asp;
  float vig = 1.0 - smoothstep(0.2, 1.15, length(c));
  col *= mix(0.3, 1.0, vig);
  col *= 0.93 + 0.07*sin(gl_FragCoord.y*3.14159);
  col += (hash(gl_FragCoord.xy + fract(uTime*7.0)*100.0) - 0.5) * 0.03;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Backdrop {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private prog: WebGLProgram | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private start = performance.now();
  private last = 0;
  private running = false;
  private animated = true;
  private tone = { ...TONES.formalin };
  private target = { ...TONES.formalin };
  private frameTimes: number[] = [];
  private lowPower = false;
  private ro: ResizeObserver | null = null;
  private scale = 0.5;
  /** frame times are ignored until this timestamp (scene change, tone change, tab resume) */
  private graceUntil = 0;
  private badWindows = 0;
  private goodWindows = 0;
  /** program linked but maybe still compiling (KHR_parallel_shader_compile) */
  private pendingProg: WebGLProgram | null = null;
  private parallel: { COMPLETION_STATUS_KHR: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    try {
      this.gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false, powerPreference: 'low-power' }) as WebGLRenderingContext | null;
      if (this.gl && !this.initGl(this.gl)) this.gl = null;
    } catch {
      this.gl = null;
    }
    if (!this.gl) this.ctx2d = canvas.getContext('2d');
    this.resize();
    this.ro = new ResizeObserver(() => {
      this.resize();
      if (!this.running) this.draw(performance.now());
    });
    this.ro.observe(canvas);
    document.addEventListener('visibilitychange', this.onVis);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.prog = null;
      this.pendingProg = null;
      this.stop();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (!this.gl || !this.initGl(this.gl)) return;
      this.resize();
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      if (this.animated && !this.lowPower) this.play();
      else this.draw(performance.now());
    });
  }

  get mode() {
    return this.gl ? 'webgl' : this.ctx2d ? 'canvas2d' : 'none';
  }

  /**
   * Compile + link. Status queries force a synchronous compile (≈160 ms on first paint), so
   * with KHR_parallel_shader_compile they are deferred until the driver reports completion;
   * frames drawn meanwhile just clear to the ink colour.
   */
  private initGl(gl: WebGLRenderingContext): boolean {
    this.parallel = (gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null) ?? null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT);
    const fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.clearColor(0.043, 0.051, 0.071, 1);
    this.prog = null;
    this.pendingProg = prog;
    if (!this.parallel) return this.finishGl(gl);
    return true;
  }

  /** Program ready? Finishes the setup the first time the link has completed. */
  private glReady(gl: WebGLRenderingContext): boolean {
    if (this.prog) return true;
    const prog = this.pendingProg;
    if (!prog) return false;
    if (this.parallel && !gl.getProgramParameter(prog, this.parallel.COMPLETION_STATUS_KHR)) return false;
    return this.finishGl(gl);
  }

  private finishGl(gl: WebGLRenderingContext): boolean {
    const prog = this.pendingProg;
    this.pendingProg = null;
    if (!prog || !gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uTime', 'uA', 'uB', 'uK']) this.u[n] = gl.getUniformLocation(prog, n);
    this.prog = prog;
    return true;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(r.width * dpr * this.scale));
    const h = Math.max(2, Math.round(r.height * dpr * this.scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl?.viewport(0, 0, w, h);
    }
  }

  private onVis = () => {
    if (document.visibilityState === 'hidden') this.pause();
    else if (this.animated && !this.lowPower) this.play();
  };

  /** Don't judge the GPU on the next 2 s (scene changes decode images, swap fonts…). */
  private grace(ms = 2000) {
    this.graceUntil = performance.now() + ms;
    this.frameTimes = [];
  }

  setTone(name: BackdropTone) {
    this.grace();
    this.target = { ...(TONES[name] ?? TONES.formalin) };
    if (!this.running) {
      this.tone = { ...this.target };
      this.draw(performance.now());
    }
  }

  /** animated=false → a single static frame (reduced motion). */
  setAnimated(on: boolean) {
    this.animated = on;
    if (on && !this.lowPower) this.play();
    else {
      this.pause();
      this.tone = { ...this.target };
      this.draw(performance.now());
    }
  }

  play() {
    if (this.running || document.visibilityState === 'hidden') return;
    this.running = true;
    this.grace();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (now - this.last < 32) return; // ~30 fps
      const dt = now - this.last;
      this.last = now;
      if (dt < 500 && now > this.graceUntil) this.watchFps(dt);
      this.stepTone();
      this.draw(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  stop() {
    this.pause();
  }

  destroy() {
    this.pause();
    this.ro?.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
  }

  private watchFps(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 60) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameTimes = [];
    if (median > 55) {
      this.goodWindows = 0;
      if (++this.badWindows < 2) return; // one bad window is noise
      this.badWindows = 0;
      if (this.scale > 0.34) {
        this.scale = 0.33;
        this.resize();
        this.grace(1000);
      } else {
        this.lowPower = true;
        this.pause();
        this.draw(performance.now());
      }
    } else {
      this.badWindows = 0;
      // sustained smooth frames at the reduced resolution → back to the normal one
      if (median < 38 && this.scale < 0.5 && ++this.goodWindows >= 3) {
        this.goodWindows = 0;
        this.scale = 0.5;
        this.resize();
        this.grace(1000);
      }
    }
  }

  private stepTone() {
    const k = 0.04;
    const mix = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] - v) * k) as [number, number, number];
    this.tone = { a: mix(this.tone.a, this.target.a), b: mix(this.tone.b, this.target.b), k: this.tone.k + (this.target.k - this.tone.k) * k };
  }

  private draw(now: number) {
    const t = (now - this.start) / 1000;
    const gl = this.gl;
    if (gl && !this.glReady(gl)) {
      if (!this.pendingProg) return; // link failed: leave the ink background
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    if (gl && this.prog) {
      gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.u.uTime, this.animated ? t : 12.5);
      gl.uniform3fv(this.u.uA, this.tone.a);
      gl.uniform3fv(this.u.uB, this.tone.b);
      gl.uniform1f(this.u.uK, this.tone.k);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    const c = this.ctx2d;
    if (!c) return;
    const { width: w, height: h } = this.canvas;
    const [r, g, b] = this.tone.a.map((v) => Math.round(v * 255));
    c.fillStyle = '#0B0D12';
    c.fillRect(0, 0, w, h);
    const tt = this.animated ? t : 3;
    for (let i = 0; i < 4; i++) {
      const x = w * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(tt * 0.05 + i * 1.7)));
      const y = h * (0.3 + 0.5 * (0.5 + 0.5 * Math.cos(tt * 0.04 + i * 2.3)));
      const rad = Math.max(w, h) * (0.35 + i * 0.05);
      const grd = c.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(${r},${g},${b},${0.07 * this.tone.k})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 40; i++) {
      const s = (i * 97.13) % 1;
      const x = ((i * 0.618 + Math.sin(tt * 0.2 + i) * 0.01) % 1) * w;
      const y = h - (((tt * 0.01 * (0.5 + s) + i * 0.137) % 1) * h);
      c.fillStyle = `rgba(${r},${g},${b},${0.25 + 0.25 * Math.sin(tt + i)})`;
      c.fillRect(x, y, 1.5, 1.5);
    }
    const vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.7)');
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
  }
}
