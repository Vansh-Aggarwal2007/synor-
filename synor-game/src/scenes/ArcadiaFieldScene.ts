/**
 * Arcadia Planitia Field Science Scene (Act II)
 * 4 Interactive Hard-Science Mini-Games:
 * 1. Subsurface Ice 6x6 Polygonal GPR Grid Scan
 * 2. Percussive Rotary Cryo-Drilling (Depth Trade-Off)
 * 3. MREU Thermal Sublimation & Perchlorate Discovery
 * 4. Regolith Bearing & Compaction ISRU Assessment
 *
 * VISUAL PASS — gameplay / state logic is untouched. What changed:
 *  - Fully procedural, textured environment: graded sky, drifting overcast, three ridge
 *    layers, perspective polygonal ice-wedge ground, frost drifts, stones, foreground boulders
 *  - Astronaut-driven parallax (layers shift with player X) + drifting cloud / fog bands
 *  - Mild ice-snow flurry: 3 depth layers of flakes, gust-modulated wind, wind streaks, veil
 *  - The four experiments now live at separate sites in the terrain, each with its own
 *    prop and a floating holo-tag (instead of four cards in one row)
 *  - Restyled header, HUD, mini-game panels, ice veins, rover and return button
 */

import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import { attachBlenderSceneSlot } from '../utils/BlenderSceneBridge';
import { soundFx } from '../utils/ProceduralAudio';
import { audioManager } from '../state/AudioManager';
import { transitionToScene, fadeSceneIn } from '../utils/SceneTransition';

/* ─────────────────────────── layout, palette, depth ─────────────────────────── */

const W = 1920;
const H = 1080;
const HORIZON_Y = 400;

const FONT_HEAD = 'Orbitron, sans-serif';
const FONT_BODY = 'Rajdhani, sans-serif';
const FONT_MONO = 'Share Tech Mono, monospace';

const COL = {
  cyan: 0x38bdf8,
  cyanSoft: 0x67e8f9,
  ice: 0xe0f2fe,
  void: 0x050a14,
  panel: 0x050c18,
  card: 0x0a101d,
  cardHover: 0x1e293b,
  edge: 0x0284c7,
  steel: 0x64748b,
  slate: 0x1e293b,
  green: 0x10b981,
  mint: 0x34d399,
  amber: 0xf59e0b,
  rust: 0xb45309
};

const DEPTH = {
  sky: 0,
  cloud: 1,
  ridge: 2,
  ground: 10,
  groundFx: 12,
  footprint: 15,
  snowFar: 28,
  world: 30, // + y-sort (see ySort)
  tags: 60,
  fogFront: 66,
  snowMid: 70,
  foreground: 75,
  snowNear: 85,
  veil: 88,
  grain: 89,
  vignette: 90,
  hud: 100,
  panel: 200
};

/** World objects sort by their ground-contact Y so things overlap believably. Stays below 52. */
const ySort = (y: number) => DEPTH.world + y * 0.02;

/* ─────────────────────────── small helpers ─────────────────────────── */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, v: number) => smooth(clamp01((v - a) / (b - a)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const v2 = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

/** Deterministic RNG so generated textures look identical every run. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1D midpoint displacement → normalised 0..1 ridge profile with n+1 samples (n power of 2). */
function midpointProfile(rng: () => number, n: number, rough: number): number[] {
  const a = new Array<number>(n + 1).fill(0);
  a[0] = rng() - 0.5;
  a[n] = rng() - 0.5;
  let step = n;
  let amp = 1;
  while (step > 1) {
    const half = step >> 1;
    for (let i = half; i < n; i += step) {
      a[i] = (a[i - half] + a[i + half]) / 2 + (rng() - 0.5) * amp;
    }
    amp *= rough;
    step = half;
  }
  let min = Infinity;
  let max = -Infinity;
  a.forEach(v => {
    min = Math.min(min, v);
    max = Math.max(max, v);
  });
  return a.map(v => (v - min) / (max - min || 1));
}

/** Seamlessly tileable fractal value noise (0..1). */
function fbmTile(w: number, h: number, rng: () => number, baseCells: number, octaves: number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * cells;
      const y0 = Math.floor(gy);
      const fy = smooth(gy - y0);
      const y1 = (y0 + 1) % cells;
      for (let x = 0; x < w; x++) {
        const gx = (x / w) * cells;
        const x0 = Math.floor(gx);
        const fx = smooth(gx - x0);
        const x1 = (x0 + 1) % cells;
        const v = lerp(
          lerp(grid[y0 * cells + x0], grid[y0 * cells + x1], fx),
          lerp(grid[y1 * cells + x0], grid[y1 * cells + x1], fx),
          fy
        );
        out[y * w + x] += v * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/* ─────────────────────────── local types ─────────────────────────── */

interface ParallaxLayer {
  obj: Phaser.GameObjects.Image;
  baseX: number;
  factor: number;
}
interface DriftLayer {
  obj: Phaser.GameObjects.TileSprite;
  speed: number;
}
interface Flake {
  img: Phaser.GameObjects.Image;
  vy: number;
  windMul: number;
  sway: number;
  phase: number;
  freq: number;
  baseAlpha: number;
}
interface Streak {
  img: Phaser.GameObjects.Image;
  speed: number;
}
interface ExperimentDef {
  id: string;
  title: string;
  sub: string;
  x: number;
  y: number;
  stand: { x: number; y: number };
  scale: number;
  propHeight: number;
  build: (c: Phaser.GameObjects.Container) => void;
  run: () => void;
}

/* ════════════════════════════════════════════════════════════════════════════ */

export class ArcadiaFieldScene extends Phaser.Scene {
  private activePanelContainer!: Phaser.GameObjects.Container;
  private expStatusText!: Phaser.GameObjects.Text;
  private astronautSprite!: Phaser.GameObjects.Sprite;
  private roverSprite!: Phaser.GameObjects.Container;
  private hazardText!: Phaser.GameObjects.Text;
  private movementKeys?: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
  };
  private velocity = new Phaser.Math.Vector2();

  // Grid scan state
  private gridScannedCount = 0;
  private readonly targetScans = 6;

  // Visual state
  private parallaxLayers: ParallaxLayer[] = [];
  private drift: DriftLayer[] = [];
  private flakes: Flake[] = [];
  private streaks: Streak[] = [];
  private sites: Array<{ id: string; refresh: () => void }> = [];
  private progressPips?: Phaser.GameObjects.Graphics;
  private hudBars?: Phaser.GameObjects.Graphics;
  private hudValues: Phaser.GameObjects.Text[] = [];
  private stormText?: Phaser.GameObjects.Text;
  private snowVeil?: Phaser.GameObjects.Rectangle;
  private grain?: Phaser.GameObjects.TileSprite;
  private astronautShadow?: Phaser.GameObjects.Ellipse;
  private lastPrint = new Phaser.Math.Vector2(-999, -999);
  private printSide = 1;
  private autoWalking = false;
  private returnButtonShown = false;
  private wind = 90;
  private gust = 0.5;
  private hudClock = 0;
  private grainClock = 0;

  constructor() {
    super({ key: 'ArcadiaFieldScene' });
  }

  create() {
    gameState.currentLocation = 'arcadia';
    gameState.save();
    audioManager.playMusic(this, 'music_game', { loop: true });
    fadeSceneIn(this);

    this.resetVisualState();
    this.buildTextures();

    // Attach Blender Slot or Procedural Arcadia Cryo Backdrop
    attachBlenderSceneSlot(this, 'ARCADIA_FIELD', () => {
      this.createProceduralArcadiaBackdrop();
    });

    this.createHeader();
    this.createHud();
    this.createScienceWorkstations();
    this.createAstronautCharacter();
    this.createFieldMovement();
    this.createExtractionNodes();
    this.createSnowStorm();
    this.createAtmosphereOverlay();
  }

  update(time: number, delta: number) {
    const dt = Math.min(delta, 50) / 1000;
    this.updateAtmosphere(time, dt, delta);

    if (!this.astronautSprite || !this.movementKeys) return;
    const axisX = Number(this.movementKeys.right.isDown) - Number(this.movementKeys.left.isDown);
    const axisY = Number(this.movementKeys.down.isDown) - Number(this.movementKeys.up.isDown);
    const moving = axisX !== 0 || axisY !== 0;
    if (!moving) {
      this.velocity.scale(0.9);
      // don't stomp the walk animation while a click-to-walk tween is driving the sprite
      if (!this.autoWalking) this.astronautSprite.play('astro_idle_anim', true);
      return;
    }

    const target = new Phaser.Math.Vector2(axisX, axisY).normalize().scale(145);
    this.velocity.x = Phaser.Math.Linear(this.velocity.x, target.x, 0.12);
    this.velocity.y = Phaser.Math.Linear(this.velocity.y, target.y, 0.12);
    this.astronautSprite.x = Phaser.Math.Clamp(this.astronautSprite.x + this.velocity.x * dt, 80, 1820);
    this.astronautSprite.y = Phaser.Math.Clamp(this.astronautSprite.y + this.velocity.y * dt, 430, 900);
    this.astronautSprite.setFlipX(this.velocity.x < 0);
    this.astronautSprite.play('astro_walk_anim', true);
    this.syncAstronautVisuals();
    this.maybeDropFootprint();
    gameState.suitBattery = Math.max(0, gameState.suitBattery - dt * 0.45);
    this.hazardText?.setText(`LOCAL TERRAIN: ICE TRACTION 0.62 // BATTERY: ${Math.round(gameState.suitBattery)}%`);
    gameState.notifyChange('arcadia_movement');
  }

  private resetVisualState() {
    this.parallaxLayers = [];
    this.drift = [];
    this.flakes = [];
    this.streaks = [];
    this.sites = [];
    this.hudValues = [];
    this.progressPips = undefined;
    this.hudBars = undefined;
    this.stormText = undefined;
    this.snowVeil = undefined;
    this.grain = undefined;
    this.astronautShadow = undefined;
    this.returnButtonShown = false;
    this.autoWalking = false;
    this.wind = 90;
    this.gust = 0.5;
    this.hudClock = 0;
    this.grainClock = 0;
    this.printSide = 1;
    this.lastPrint.set(-999, -999);
    this.velocity.set(0, 0);
  }

  /* ═══════════════════════════ text helper ═══════════════════════════ */

  private txt(
    x: number,
    y: number,
    str: string,
    font: string,
    size: number,
    color: string,
    extra: Phaser.Types.GameObjects.Text.TextStyle = {}
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, str, { fontFamily: font, fontSize: `${size}px`, color, ...extra })
      .setResolution(2);
  }

  /** Chamfered sci-fi plate used by header, HUD and plaques. */
  private drawPlate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, c = 10) {
    const pts = [
      v2(x + c, y),
      v2(x + w, y),
      v2(x + w, y + h - c),
      v2(x + w - c, y + h),
      v2(x, y + h),
      v2(x, y + c)
    ];
    g.fillStyle(COL.void, 0.84);
    g.fillPoints(pts, true);
    g.lineStyle(1, COL.cyan, 0.5);
    g.strokePoints(pts, true);
    g.lineStyle(2, COL.cyan, 0.9);
    g.lineBetween(x + c, y, x + c + 34, y);
    g.lineBetween(x + w - c - 34, y + h, x + w - c, y + h);
  }

  /* ═══════════════════════════ procedural textures ═══════════════════════════ */

  private canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, w, h);
    if (!tex) return;
    draw(tex.getContext(), w, h);
    tex.refresh();
  }

  private softDot(key: string, size: number) {
    this.canvasTex(key, size, size, (ctx, w) => {
      const r = w / 2;
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    });
  }

  private paintNoise(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, mode: 'cloud' | 'fog') {
    const n = fbmTile(w, h, makeRng(seed), 4, 5);
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      // vertical fade baked in so tile sprites never show a hard top/bottom edge
      const fade = Math.pow(Math.sin((y / (h - 1)) * Math.PI), 0.9);
      for (let x = 0; x < w; x++) {
        const v = n[y * w + x];
        const a = mode === 'cloud' ? smoothstep(0.4, 0.68, v) * 0.95 : Math.pow(v, 2) * 1.1;
        const i = (y * w + x) * 4;
        img.data[i] = 222;
        img.data[i + 1] = 236;
        img.data[i + 2] = 245;
        img.data[i + 3] = Math.round(clamp01(a * fade) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  private tracePoly(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  private drawRidge(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    seed: number,
    o: { rough: number; base: number; amp: number; top: string; bottom: string; edge: string; gullies: number }
  ) {
    const rng = makeRng(seed);
    const n = 256;
    const prof = midpointProfile(rng, n, o.rough);
    const crest = (i: number) => o.base - prof[i] * o.amp;

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= n; i++) ctx.lineTo((i / n) * w, crest(i));
    ctx.lineTo(w, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, o.base - o.amp, 0, h);
    g.addColorStop(0, o.top);
    g.addColorStop(1, o.bottom);
    ctx.fillStyle = g;
    ctx.fill();

    // erosion gullies running down the slopes
    for (let k = 0; k < o.gullies; k++) {
      const i = Math.floor(rng() * n);
      const x = (i / n) * w;
      const y = crest(i);
      ctx.strokeStyle = `rgba(8,18,28,${0.08 + rng() * 0.12})`;
      ctx.lineWidth = 1 + rng() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x + (rng() - 0.5) * 50, y + 18 + rng() * 70);
      ctx.stroke();
    }

    // wind-blown snow lying on the crest + rim light
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * w;
      if (i === 0) ctx.moveTo(x, crest(i));
      else ctx.lineTo(x, crest(i));
    }
    ctx.strokeStyle = o.edge;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  private drawGround(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const rng = makeRng(7711);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#7f99a8');
    grad.addColorStop(0.1, '#6b8797');
    grad.addColorStop(0.45, '#46606f');
    grad.addColorStop(1, '#233541');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // fine regolith grain + frost speckle (denser and larger toward the camera)
    for (let i = 0; i < 16000; i++) {
      const y = Math.pow(rng(), 0.8) * h;
      const x = rng() * w;
      const t = y / h;
      const s = 1 + (rng() < 0.12 ? 1 : 0) + t * 1.2;
      ctx.fillStyle =
        rng() < 0.55 ? `rgba(230,244,252,${0.05 + rng() * 0.14})` : `rgba(8,18,28,${0.06 + rng() * 0.16})`;
      ctx.fillRect(x, y, s, s * 0.6);
    }

    // soft frost drifts + dark basalt dust patches
    for (let i = 0; i < 26; i++) {
      const cx = rng() * w;
      const cy = h * (0.08 + rng() * 0.9);
      const r = 80 + rng() * 220;
      const frost = i % 3 !== 0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.26 + (cy / h) * 0.1);
      const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g2.addColorStop(0, frost ? 'rgba(236,246,255,0.20)' : 'rgba(58,44,38,0.16)');
      g2.addColorStop(1, frost ? 'rgba(236,246,255,0)' : 'rgba(58,44,38,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // perspective polygonal patterned ground (ice-wedge polygons): cells grow and
    // un-squash toward the camera; dark troughs with a frosty raised rim
    let y = 4;
    let row = 0;
    while (y < h) {
      const t = y / h;
      const cw = 20 + Math.pow(t, 1.4) * 200;
      const ch = cw * (0.13 + t * 0.27);
      const lw = 0.5 + t * 2.8;
      for (let x = -cw + (row % 2) * cw * 0.5; x < w + cw; x += cw * 0.94) {
        const cx = x + (rng() - 0.5) * cw * 0.22;
        const cy = y + (rng() - 0.5) * ch * 0.2;
        const sides = 6 + (rng() < 0.4 ? 1 : 0);
        const pts: Array<[number, number]> = [];
        for (let s = 0; s < sides; s++) {
          const a = (s / sides) * Math.PI * 2 + (rng() - 0.5) * 0.3;
          const k = 0.46 + rng() * 0.08;
          pts.push([cx + Math.cos(a) * cw * k, cy + Math.sin(a) * ch * k]);
        }
        this.tracePoly(ctx, pts);
        ctx.fillStyle =
          rng() < 0.5 ? `rgba(235,246,255,${0.02 + rng() * 0.07})` : `rgba(10,20,30,${0.03 + rng() * 0.08})`;
        ctx.fill();
        ctx.lineWidth = lw;
        ctx.strokeStyle = `rgba(9,19,29,${0.38 + t * 0.25})`;
        ctx.stroke();
        ctx.save();
        ctx.translate(-lw * 0.8, -lw * 0.8);
        this.tracePoly(ctx, pts);
        ctx.lineWidth = lw * 0.6;
        ctx.strokeStyle = 'rgba(225,240,250,0.2)';
        ctx.stroke();
        ctx.restore();
      }
      y += ch * 0.82;
      row++;
    }

    // scattered basalt stones with snow caps (far → near so nearer stones overlap)
    const stones: Array<{ x: number; y: number; r: number }> = [];
    for (let i = 0; i < 260; i++) {
      const sy = Math.pow(rng(), 0.9) * h;
      stones.push({ x: rng() * w, y: sy, r: 1.5 + (sy / h) * 22 * (0.4 + rng()) });
    }
    stones.sort((a, b) => a.y - b.y);
    stones.forEach(s => {
      ctx.fillStyle = 'rgba(5,12,20,0.32)';
      ctx.beginPath();
      ctx.ellipse(s.x + s.r * 0.3, s.y + s.r * 0.25, s.r * 1.15, s.r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3b4249';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.r, s.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(236,246,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(s.x - s.r * 0.1, s.y - s.r * 0.18, s.r * 0.78, s.r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // horizon haze baked into the top of the ground plane
    const haze = ctx.createLinearGradient(0, 0, 0, 160);
    haze.addColorStop(0, 'rgba(200,222,235,0.6)');
    haze.addColorStop(1, 'rgba(200,222,235,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, 160);
  }

  private drawForegroundRocks(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const rng = makeRng(991);
    const count = 14;
    for (let i = 0; i < count; i++) {
      const cx = (i + 0.2 + rng() * 0.6) * (w / count);
      const rw = 90 + rng() * 170;
      const rh = 36 + rng() * 80;
      const x0 = cx - rw / 2;
      const top: Array<[number, number]> = [];
      const n = 6 + Math.floor(rng() * 3);
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        top.push([x0 + u * rw, h - rh * Math.sin(u * Math.PI) * (0.75 + rng() * 0.25)]);
      }
      const body: Array<[number, number]> = [[x0 - 10, h + 6], ...top, [x0 + rw + 10, h + 6]];
      this.tracePoly(ctx, body);
      const g = ctx.createLinearGradient(0, h - rh, 0, h);
      g.addColorStop(0, '#27384a');
      g.addColorStop(1, '#0b121b');
      ctx.fillStyle = g;
      ctx.fill();

      // snow cap
      ctx.beginPath();
      ctx.moveTo(top[0][0], top[0][1]);
      top.forEach(p => ctx.lineTo(p[0], p[1]));
      for (let k = n; k >= 0; k--) ctx.lineTo(top[k][0], top[k][1] + 5 + rng() * 10);
      ctx.closePath();
      ctx.fillStyle = 'rgba(236,246,255,0.72)';
      ctx.fill();

      // rim light
      ctx.beginPath();
      ctx.moveTo(top[0][0], top[0][1]);
      top.forEach(p => ctx.lineTo(p[0], p[1]));
      ctx.strokeStyle = 'rgba(200,228,245,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  private buildTextures() {
    this.canvasTex('arc_sky', 4, 512, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1b2f42');
      g.addColorStop(0.35, '#35566d');
      g.addColorStop(0.7, '#6f94a9');
      g.addColorStop(1, '#bcd6e3');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });

    this.canvasTex('arc_glow', 128, 128, ctx => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });

    this.softDot('arc_flake_a', 8);
    this.softDot('arc_flake_b', 16);
    this.softDot('arc_flake_c', 32);

    this.canvasTex('arc_sparkle', 24, 24, ctx => {
      const gh = ctx.createLinearGradient(0, 12, 24, 12);
      gh.addColorStop(0, 'rgba(255,255,255,0)');
      gh.addColorStop(0.5, 'rgba(255,255,255,1)');
      gh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gh;
      ctx.fillRect(0, 11, 24, 2);
      const gv = ctx.createLinearGradient(12, 0, 12, 24);
      gv.addColorStop(0, 'rgba(255,255,255,0)');
      gv.addColorStop(0.5, 'rgba(255,255,255,1)');
      gv.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gv;
      ctx.fillRect(11, 0, 2, 24);
      const gc = ctx.createRadialGradient(12, 12, 0, 12, 12, 6);
      gc.addColorStop(0, 'rgba(255,255,255,0.9)');
      gc.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gc;
      ctx.fillRect(0, 0, 24, 24);
    });

    this.canvasTex('arc_streak', 256, 6, ctx => {
      const g = ctx.createLinearGradient(0, 0, 256, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 2, 256, 2);
    });

    this.canvasTex('arc_cloud', 512, 256, (ctx, w, h) => this.paintNoise(ctx, w, h, 101, 'cloud'));
    this.canvasTex('arc_fog', 512, 256, (ctx, w, h) => this.paintNoise(ctx, w, h, 202, 'fog'));

    this.canvasTex('arc_grain', 256, 256, (ctx, w, h) => {
      const rng = makeRng(303);
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        img.data[i * 4] = 255;
        img.data[i * 4 + 1] = 255;
        img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = Math.round(rng() * 60);
      }
      ctx.putImageData(img, 0, 0);
    });

    this.canvasTex('arc_haze', 4, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(210,230,242,0)');
      g.addColorStop(0.62, 'rgba(210,230,242,0.7)');
      g.addColorStop(1, 'rgba(210,230,242,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });

    this.canvasTex('arc_vignette', 512, 288, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 90, w / 2, h / 2, 340);
      g.addColorStop(0, 'rgba(2,6,14,0)');
      g.addColorStop(0.6, 'rgba(2,6,14,0.15)');
      g.addColorStop(1, 'rgba(2,6,14,0.78)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });

    this.canvasTex('arc_ridge_far', 2400, 300, (ctx, w, h) =>
      this.drawRidge(ctx, w, h, 11, { rough: 0.55, base: 200, amp: 130, top: '#9ab8cb', bottom: '#adc9d8', edge: 'rgba(235,246,255,0.65)', gullies: 90 })
    );
    this.canvasTex('arc_ridge_mid', 2400, 240, (ctx, w, h) =>
      this.drawRidge(ctx, w, h, 23, { rough: 0.5, base: 170, amp: 110, top: '#6a8a9a', bottom: '#82a2b0', edge: 'rgba(225,240,250,0.55)', gullies: 120 })
    );
    this.canvasTex('arc_ridge_near', 2400, 170, (ctx, w, h) =>
      this.drawRidge(ctx, w, h, 37, { rough: 0.42, base: 125, amp: 72, top: '#47657a', bottom: '#6f8998', edge: 'rgba(215,235,248,0.5)', gullies: 80 })
    );

    this.canvasTex('arc_ground', W, 700, (ctx, w, h) => this.drawGround(ctx, w, h));
    this.canvasTex('arc_fg_rocks', 2400, 170, (ctx, w, h) => this.drawForegroundRocks(ctx, w, h));
  }

  /* ═══════════════════════════ backdrop & parallax ═══════════════════════════ */

  private addParallax(obj: Phaser.GameObjects.Image, baseX: number, factor: number) {
    this.parallaxLayers.push({ obj, baseX, factor });
  }

  private addDriftBand(key: string, y: number, sx: number, sy: number, depth: number, alpha: number, tint: number, speed: number) {
    const h = Math.round(256 * sy);
    const band = this.add
      .tileSprite(W / 2, y, W, h, key)
      .setTileScale(sx, sy)
      .setAlpha(alpha)
      .setTint(tint)
      .setDepth(depth);
    this.drift.push({ obj: band, speed });
    return band;
  }

  private createProceduralArcadiaBackdrop() {
    // Sky dome
    this.add.image(W / 2, 0, 'arc_sky').setOrigin(0.5, 0).setDisplaySize(W, HORIZON_Y + 60).setDepth(DEPTH.sky);

    // Diffuse sun behind the overcast
    const sun = this.add
      .image(1400, 270, 'arc_glow')
      .setTint(0xfff1d6)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(7.5)
      .setAlpha(0.32)
      .setDepth(DEPTH.sky + 0.1);
    this.addParallax(sun, 1400, 0.004);

    // Drifting overcast (two speeds)
    this.addDriftBand('arc_cloud', 190, 2.4, 1.3, DEPTH.cloud, 0.5, 0xcfe3ee, 0.12);
    this.addDriftBand('arc_cloud', 250, 3.2, 1.0, DEPTH.cloud + 0.1, 0.32, 0xe6f2f8, 0.22).setTilePosition(200, 90);

    // Three ridge layers, each with its own parallax factor
    const far = this.add.image(W / 2, HORIZON_Y + 8, 'arc_ridge_far').setOrigin(0.5, 1).setDepth(DEPTH.ridge);
    const mid = this.add.image(W / 2, HORIZON_Y + 8, 'arc_ridge_mid').setOrigin(0.5, 1).setDepth(DEPTH.ridge + 0.2);
    const near = this.add.image(W / 2, HORIZON_Y + 8, 'arc_ridge_near').setOrigin(0.5, 1).setDepth(DEPTH.ridge + 0.4);
    this.addParallax(far, W / 2, 0.02);
    this.addParallax(mid, W / 2, 0.05);
    this.addParallax(near, W / 2, 0.09);

    // Atmospheric haze sitting on the horizon
    this.add
      .image(W / 2, HORIZON_Y - 10, 'arc_haze')
      .setDisplaySize(W + 200, 170)
      .setAlpha(0.55)
      .setDepth(DEPTH.ridge + 0.6);

    // Ground plane + low ground fog
    this.add.image(W / 2, HORIZON_Y - 4, 'arc_ground').setOrigin(0.5, 0).setDepth(DEPTH.ground);
    this.addDriftBand('arc_fog', HORIZON_Y + 90, 3, 0.9, DEPTH.ground + 1, 0.2, 0xcfe3ee, 0.35);

    // Ice glints across the polygonal ground
    for (let i = 0; i < 28; i++) {
      const glint = this.add
        .image(Phaser.Math.Between(80, 1840), Phaser.Math.Between(470, 900), 'arc_sparkle')
        .setTint(COL.ice)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(Phaser.Math.FloatBetween(0.5, 1.1))
        .setAlpha(0.3)
        .setDepth(DEPTH.groundFx);
      this.tweens.add({
        targets: glint,
        alpha: { from: 0.1, to: 0.9 },
        duration: Phaser.Math.Between(900, 2200),
        delay: Phaser.Math.Between(0, 1500),
        repeat: -1,
        yoyo: true
      });
    }

    // Foreground boulders move against the player for strong depth
    const rocks = this.add.image(W / 2, H + 14, 'arc_fg_rocks').setOrigin(0.5, 1).setDepth(DEPTH.foreground);
    this.addParallax(rocks, W / 2, -0.16);
  }

  /* ═══════════════════════════ header & HUD ═══════════════════════════ */

  private createHeader() {
    const header = this.add.container(960, 90).setDepth(DEPTH.hud);
    const frame = this.add.graphics();
    this.drawPlate(frame, -560, -31, 1120, 62, 14);
    frame.fillStyle(COL.cyan, 0.9);
    frame.fillRect(-560, -10, 3, 20);
    frame.fillRect(557, -10, 3, 20);

    const title = this.txt(0, -10, 'ACT II: ARCADIA PLANITIA — SUBSURFACE ICE & REGOLITH ISRU', FONT_HEAD, 14, '#38bdf8', {
      letterSpacing: 2
    }).setOrigin(0.5);

    this.expStatusText = this.txt(0, 14, '', FONT_MONO, 12, '#94a3b8').setOrigin(0.5);

    this.progressPips = this.add.graphics();

    header.add([frame, title, this.expStatusText, this.progressPips]);
    this.updateStatus();
  }

  private drawProgressPips(done: number) {
    const g = this.progressPips;
    if (!g) return;
    g.clear();
    for (let i = 0; i < 4; i++) {
      const x = 430 + i * 26;
      const on = i < done;
      const pts = [
        v2(x, -8),
        v2(x + 8, 0),
        v2(x, 8),
        v2(x - 8, 0)
      ];
      g.fillStyle(on ? COL.mint : 0x0f172a, on ? 1 : 0.9);
      g.fillPoints(pts, true);
      g.lineStyle(1, on ? 0xa7f3d0 : 0x475569, 1);
      g.strokePoints(pts, true);
    }
  }

  private createHud() {
    const plates = this.add.graphics().setDepth(DEPTH.hud);
    this.drawPlate(plates, 36, 928, 300, 112);
    this.drawPlate(plates, W - 36 - 340, 928, 340, 112);
    this.drawPlate(plates, 960 - 330, 1004, 660, 30, 8);

    this.txt(52, 936, 'SUIT SYSTEMS', FONT_HEAD, 10, '#38bdf8', { letterSpacing: 2 }).setDepth(DEPTH.hud + 1);
    ['SUIT BATTERY', 'WATER-ICE RESERVE', 'POWER'].forEach((label, i) => {
      this.txt(52, 968 + i * 24, label, FONT_BODY, 12, '#94a3b8').setOrigin(0, 0.5).setDepth(DEPTH.hud + 1);
      this.hudValues.push(
        this.txt(324, 968 + i * 24, '', FONT_MONO, 11, '#e0f2fe').setOrigin(1, 0.5).setDepth(DEPTH.hud + 1)
      );
    });
    this.hudBars = this.add.graphics().setDepth(DEPTH.hud + 1);

    this.txt(W - 36 - 340 + 16, 936, 'ENVIRONMENT', FONT_HEAD, 10, '#38bdf8', { letterSpacing: 2 }).setDepth(DEPTH.hud + 1);
    this.stormText = this.txt(W - 36 - 340 + 16, 958, '', FONT_MONO, 11, '#bae6fd', { lineSpacing: 7 }).setDepth(
      DEPTH.hud + 1
    );

    // Terrain readout — created here (not in the backdrop) so it always exists, Blender slot or not
    this.hazardText = this.txt(
      960,
      1019,
      `LOCAL TERRAIN: ICE TRACTION 0.62 // BATTERY: ${Math.round(gameState.suitBattery)}%`,
      FONT_MONO,
      11,
      '#bae6fd'
    )
      .setOrigin(0.5)
      .setDepth(DEPTH.hud + 1);

    this.refreshHud();
  }

  private refreshHud() {
    const g = this.hudBars;
    if (g) {
      g.clear();
      const rows = [
        { y: 968, v: gameState.suitBattery, c: COL.cyan },
        { y: 992, v: gameState.waterIceReserve, c: COL.cyanSoft },
        { y: 1016, v: gameState.resources.power, c: COL.amber }
      ];
      rows.forEach((r, i) => {
        const frac = clamp01(r.v / 100);
        g.fillStyle(0x0f172a, 1);
        g.fillRect(168, r.y - 3, 110, 6);
        g.fillStyle(frac < 0.2 ? 0xef4444 : r.c, 1);
        g.fillRect(168, r.y - 3, 110 * frac, 6);
        g.lineStyle(1, 0x334155, 1);
        g.strokeRect(168, r.y - 3, 110, 6);
        this.hudValues[i]?.setText(`${Math.round(r.v)}%`);
      });
    }
    if (this.stormText) {
      const windMs = (this.wind / 16).toFixed(1);
      const vis = (2.4 - this.gust * 0.9).toFixed(1);
      this.stormText.setText(
        `ATMOS    LIGHT ICE-SNOW FLURRY\nWIND     ${windMs} m/s   VIS ${vis} km\nAMBIENT  -63 °C   GRIP 0.62\nCONTROL  WASD MOVE · CLICK SITE`
      );
    }
  }

  /* ═══════════════════════════ astronaut ═══════════════════════════ */

  private createAstronautCharacter() {
    if (this.textures.exists('astronaut_walk')) {
      this.astronautShadow = this.add.ellipse(320, 700, 56, 16, 0x000000, 0.32);
      this.astronautSprite = this.add.sprite(320, 680, 'astronaut_walk', 0).setScale(1.2).setDepth(50);
      this.astronautSprite.play('astro_idle_anim');
      this.syncAstronautVisuals();
    }
  }

  /** Depth-scale + y-sort + contact shadow so the astronaut sits in the terrain. */
  private syncAstronautVisuals() {
    const a = this.astronautSprite;
    if (!a) return;
    const t = clamp01((a.y - 430) / (900 - 430));
    const s = 0.95 + t * 0.45;
    a.setScale(s);
    a.setDepth(ySort(a.y) + 0.5);
    const feetY = a.y + a.displayHeight * 0.46;
    this.astronautShadow?.setPosition(a.x, feetY).setScale(s).setDepth(ySort(a.y) - 0.1);
  }

  private maybeDropFootprint() {
    const a = this.astronautSprite;
    if (!a) return;
    const feetY = a.y + a.displayHeight * 0.46;
    if (Phaser.Math.Distance.Between(a.x, feetY, this.lastPrint.x, this.lastPrint.y) < 36) return;
    this.lastPrint.set(a.x, feetY);
    this.printSide *= -1;
    const print = this.add.ellipse(a.x + this.printSide * 6, feetY, 11, 5, 0x0b1a26, 0.38).setDepth(DEPTH.footprint);
    this.tweens.add({ targets: print, alpha: 0, duration: 6000, onComplete: () => print.destroy() });
  }

  private walkAstronautTo(targetX: number, targetY: number, onArrival?: () => void) {
    if (!this.astronautSprite) {
      if (onArrival) onArrival();
      return;
    }

    const dist = Phaser.Math.Distance.Between(this.astronautSprite.x, this.astronautSprite.y, targetX, targetY);
    const duration = (dist / 140) * 1000;

    this.astronautSprite.setFlipX(targetX < this.astronautSprite.x);
    this.astronautSprite.play('astro_walk_anim');
    this.autoWalking = true;

    this.tweens.killTweensOf(this.astronautSprite);
    this.tweens.add({
      targets: this.astronautSprite,
      x: targetX,
      y: targetY,
      duration: duration,
      ease: 'Linear',
      onUpdate: () => {
        this.syncAstronautVisuals();
        this.maybeDropFootprint();
      },
      onComplete: () => {
        this.autoWalking = false;
        this.astronautSprite.play('astro_idle_anim');
        if (onArrival) onArrival();
      }
    });
  }

  /* ═══════════════════════════ movement & rover ═══════════════════════════ */

  private createFieldMovement() {
    this.movementKeys = {
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S)
    };
    this.createRover();
  }

  private createRover() {
    const rx = 960;
    const ry = 800;
    const cont = this.add.container(rx, ry).setDepth(ySort(ry));
    const g = this.add.graphics();

    g.fillStyle(0x000000, 0.35);
    g.fillEllipse(0, 6, 250, 34);

    // wheels
    [-76, 0, 76].forEach(wx => {
      g.fillStyle(0x0b1220, 1);
      g.fillCircle(wx, -18, 19);
      g.lineStyle(3, 0x475569, 1);
      g.strokeCircle(wx, -18, 19);
      g.fillStyle(0x334155, 1);
      g.fillCircle(wx, -18, 8);
      g.lineStyle(2, COL.steel, 0.9);
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        g.lineBetween(wx + Math.cos(a) * 8, -18 + Math.sin(a) * 8, wx - Math.cos(a) * 8, -18 - Math.sin(a) * 8);
      }
    });

    // rocker arm + chassis
    g.lineStyle(4, 0x475569, 1);
    g.lineBetween(-76, -18, -38, -40);
    g.lineBetween(76, -18, 38, -40);
    g.fillStyle(0x253449, 1);
    g.fillPoints(
      [
        v2(-98, -38),
        v2(98, -38),
        v2(88, -64),
        v2(-88, -64)
      ],
      true
    );
    g.lineStyle(3, COL.cyanSoft, 1);
    g.lineBetween(-98, -38, 98, -38);

    // cabin + glass
    g.fillStyle(COL.steel, 1);
    g.fillRoundedRect(-44, -96, 92, 36, 8);
    g.fillStyle(0x0ea5e9, 0.55);
    g.fillRoundedRect(-36, -90, 40, 22, 5);
    g.fillStyle(0xffffff, 0.18);
    g.fillRect(-34, -88, 36, 5);

    // drill module + tank on the back
    g.fillStyle(0x334155, 1);
    g.fillRoundedRect(54, -84, 38, 18, 8);
    g.lineStyle(3, 0x94a3b8, 1);
    g.lineBetween(92, -76, 108, -52);

    // solar wing
    g.fillStyle(0x1e3a8a, 1);
    g.fillPoints(
      [
        v2(-88, -68),
        v2(-30, -68),
        v2(-22, -80),
        v2(-80, -80)
      ],
      true
    );
    g.lineStyle(1, 0x60a5fa, 0.6);
    for (let i = 1; i < 4; i++) g.lineBetween(-88 + i * 15, -68, -80 + i * 15, -80);

    // mast + camera head + dish
    g.lineStyle(3, 0x94a3b8, 1);
    g.lineBetween(26, -96, 26, -134);
    g.fillStyle(0x1e293b, 1);
    g.fillRoundedRect(14, -146, 26, 14, 4);
    g.fillStyle(COL.cyanSoft, 1);
    g.fillCircle(20, -139, 3);
    g.lineStyle(3, 0x94a3b8, 1);
    g.lineBetween(-60, -96, -60, -122);
    g.lineStyle(2, 0xe0f2fe, 0.9);
    g.strokeEllipse(-60, -126, 26, 10);

    // headlights + beacon
    const beamL = this.add
      .image(-118, -48, 'arc_glow')
      .setTint(0xfef3c7)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(2.6, 1)
      .setAlpha(0.45);
    const beacon = this.add.circle(26, -150, 3, 0xef4444, 1);
    this.tweens.add({ targets: beacon, alpha: 0.15, duration: 700, yoyo: true, repeat: -1 });

    const label = this.txt(0, 40, 'CRYO-01', FONT_MONO, 10, '#67e8f9').setOrigin(0.5);

    cont.add([g, beamL, beacon, label]);
    this.roverSprite = cont;
  }

  /* ═══════════════════════════ extraction nodes (ice veins) ═══════════════════════════ */

  private createExtractionNodes() {
    [
      { x: 620, y: 700, label: 'ICE VEIN A' },
      { x: 1010, y: 625, label: 'ICE VEIN B' },
      { x: 1470, y: 770, label: 'ICE VEIN C' }
    ].forEach(node => {
      const d = ySort(node.y);

      // crystalline vein cluster
      const crystals = this.add.graphics().setDepth(d - 0.2);
      crystals.fillStyle(0x000000, 0.28);
      crystals.fillEllipse(node.x, node.y + 8, 64, 14);
      const spikes: Array<[number, number, number]> = [
        [-20, 18, 8],
        [-9, 30, 9],
        [4, 24, 8],
        [15, 34, 10],
        [26, 16, 7]
      ];
      spikes.forEach(([dx, hgt, wd]) => {
        crystals.fillStyle(0xbae6fd, 0.9);
        crystals.fillTriangle(node.x + dx - wd / 2, node.y + 6, node.x + dx + wd / 2, node.y + 6, node.x + dx, node.y + 6 - hgt);
        crystals.fillStyle(0xffffff, 0.55);
        crystals.fillTriangle(node.x + dx - wd / 2, node.y + 6, node.x + dx, node.y + 6, node.x + dx, node.y + 6 - hgt);
      });

      const halo = this.add
        .image(node.x, node.y, 'arc_glow')
        .setTint(COL.cyanSoft)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(1.5)
        .setAlpha(0.4)
        .setDepth(d - 0.1);
      this.tweens.add({ targets: halo, alpha: 0.12, scale: 1.1, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

      const marker = this.add
        .circle(node.x, node.y, 14, 0x67e8f9, 0.75)
        .setStrokeStyle(2, 0xe0f2fe)
        .setInteractive({ useHandCursor: true })
        .setDepth(d);
      this.txt(node.x, node.y + 22, node.label, FONT_MONO, 9, '#e0f2fe').setOrigin(0.5).setDepth(d);

      marker.on('pointerdown', () => {
        const yieldPercent = 8;
        gameState.waterIceReserve = Math.min(100, gameState.waterIceReserve + yieldPercent);
        gameState.resources.power = Math.max(0, gameState.resources.power - 4);
        gameState.addLog(`${node.label}: Cryo-extraction yielded ${yieldPercent}% accessible water-ice.`, 'science');
        this.hazardText.setText(`LOCAL TERRAIN: ICE EXTRACTION ACTIVE // ICE RESERVE: ${Math.round(gameState.waterIceReserve)}%`);
        this.tweens.add({ targets: marker, scale: 1.8, alpha: 0, duration: 280, yoyo: true });
        for (let i = 0; i < 10; i++) {
          const particle = this.add.circle(node.x, node.y, 3, 0xe0f2fe, 0.8).setDepth(d + 1);
          this.tweens.add({
            targets: particle,
            x: node.x + Phaser.Math.Between(-30, 30),
            y: node.y - Phaser.Math.Between(15, 55),
            alpha: 0,
            duration: 500,
            onComplete: () => particle.destroy()
          });
        }
      });
    });
  }

  /* ═══════════════════════════ experiment sites ═══════════════════════════ */

  private createScienceWorkstations() {
    const experiments: ExperimentDef[] = [
      {
        id: 'exp_arcadia_gpr',
        title: 'EXP A: GPR ICE SCAN',
        sub: '6x6 Ground Radar Survey',
        x: 360,
        y: 600,
        stand: { x: 440, y: 662 },
        scale: 1,
        propHeight: 74,
        build: c => this.buildGprSite(c),
        run: () => this.runGprMiniGame()
      },
      {
        id: 'exp_arcadia_core',
        title: 'EXP B: ICE CORING',
        sub: 'Rotary Drill Depth Trade-off',
        x: 820,
        y: 505,
        stand: { x: 820, y: 575 },
        scale: 0.85,
        propHeight: 165,
        build: c => this.buildDrillSite(c),
        run: () => this.runCoringMiniGame()
      },
      {
        id: 'exp_arcadia_mreu',
        title: 'EXP C: MREU EXTRACTION',
        sub: 'Thermal Sublimation & Salts',
        x: 1270,
        y: 655,
        stand: { x: 1190, y: 716 },
        scale: 1,
        propHeight: 130,
        build: c => this.buildMreuSite(c),
        run: () => this.runMreuMiniGame()
      },
      {
        id: 'exp_arcadia_regolith',
        title: 'EXP D: ISRU BEARING',
        sub: 'Soil Compaction Assessment',
        x: 1650,
        y: 550,
        stand: { x: 1650, y: 622 },
        scale: 0.9,
        propHeight: 95,
        build: c => this.buildRegolithSite(c),
        run: () => this.runRegolithMiniGame()
      }
    ];

    experiments.forEach(e => {
      // ground footprint: glow + pulsing beacon ring + the prop itself
      const site = this.add.container(e.x, e.y).setDepth(ySort(e.y)).setScale(e.scale);
      const glow = this.add
        .image(0, 2, 'arc_glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(4.4, 1.5)
        .setAlpha(0.22);
      const ring = this.add.ellipse(0, 4, 310, 98).setStrokeStyle(2, COL.cyanSoft, 0.8);
      site.add([glow, ring]);
      this.tweens.add({ targets: ring, scaleX: 1.07, scaleY: 1.1, alpha: 0.55, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      e.build(site);

      // floating holo-tag
      const tagY = e.y - e.propHeight - 78;
      const tag = this.add.container(e.x, tagY).setDepth(DEPTH.tags);
      const leader = this.add.graphics();
      leader.lineStyle(1, COL.cyan, 0.55);
      leader.lineBetween(0, 42, 0, 74);
      leader.fillStyle(COL.cyan, 0.9);
      leader.fillCircle(0, 76, 2.5);

      const box = this.add
        .rectangle(0, 0, 244, 84, COL.card, 0.92)
        .setStrokeStyle(2, COL.edge)
        .setInteractive({ useHandCursor: true });
      const ticks = this.add.graphics();

      const checkMark = this.txt(-108, 25, '●', FONT_HEAD, 14, '#38bdf8').setOrigin(0.5);
      const tText = this.txt(0, -20, e.title, FONT_HEAD, 12, '#38bdf8').setOrigin(0.5);
      const sText = this.txt(0, 2, e.sub, FONT_BODY, 12, '#94a3b8').setOrigin(0.5);
      const status = this.txt(0, 25, '[CLICK TO COMMENCE]', FONT_MONO, 10, '#f59e0b').setOrigin(0.5);

      tag.add([leader, box, ticks, checkMark, tText, sText, status]);
      this.tweens.add({ targets: tag, y: tagY - 4, duration: 1800 + Math.random() * 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

      const drawTicks = (color: number) => {
        ticks.clear();
        ticks.lineStyle(2, color, 1);
        [
          [-122, -42, 1, 1],
          [122, -42, -1, 1],
          [-122, 42, 1, -1],
          [122, 42, -1, -1]
        ].forEach(([x, y, sx, sy]) => {
          ticks.lineBetween(x, y, x + sx * 12, y);
          ticks.lineBetween(x, y, x, y + sy * 12);
        });
      };

      // Completion state is re-evaluated whenever progress changes (see updateStatus)
      const refresh = () => {
        const isDone = gameState.arcadiaCompletedExperiments.includes(e.id);
        box.setStrokeStyle(2, isDone ? COL.green : COL.edge);
        drawTicks(isDone ? COL.mint : COL.cyanSoft);
        checkMark.setText(isDone ? '✓' : '●').setColor(isDone ? '#34d399' : '#38bdf8');
        tText.setColor(isDone ? '#34d399' : '#38bdf8');
        status.setText(isDone ? '[DATA SECURED]' : '[CLICK TO COMMENCE]').setColor(isDone ? '#10b981' : '#f59e0b');
        ring.setStrokeStyle(2, isDone ? COL.mint : COL.cyanSoft, 0.8);
        glow.setTint(isDone ? COL.mint : COL.cyan);
      };
      refresh();
      this.sites.push({ id: e.id, refresh });

      // Tag and ground zone both trigger the same behaviour as the original card
      const zone = this.add
        .zone(e.x, e.y - e.propHeight / 2 + 12, 300 * e.scale, e.propHeight + 40)
        .setInteractive({ useHandCursor: true });

      const onDown = () => {
        soundFx.playClick(1000);
        this.walkAstronautTo(e.stand.x, e.stand.y, () => {
          e.run();
        });
      };
      const onOver = () => {
        box.setFillStyle(COL.cardHover, 0.95);
        glow.setAlpha(0.4);
        soundFx.playClick(850);
      };
      const onOut = () => {
        box.setFillStyle(COL.card, 0.92);
        glow.setAlpha(0.22);
      };
      [box, zone].forEach(o => {
        o.on('pointerdown', onDown);
        o.on('pointerover', onOver);
        o.on('pointerout', onOut);
      });
    });
  }

  /* ── site props (ground-contact at 0,0) ── */

  private buildGprSite(c: Phaser.GameObjects.Container) {
    const g = this.add.graphics();
    const gw = 250;
    const gh = 84;
    const skew = 28;
    const P = (u: number, v: number) => (v2(-gw / 2 + u * gw + (0.5 - v) * skew, -gh / 2 + v * gh));
    const corners = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];

    // surveyed 6x6 patch
    g.fillStyle(0x0b2233, 0.38);
    g.fillPoints(corners, true);
    g.lineStyle(1, COL.cyanSoft, 0.35);
    for (let i = 0; i <= 6; i++) {
      const a = P(i / 6, 0);
      const b = P(i / 6, 1);
      g.lineBetween(a.x, a.y, b.x, b.y);
      const l = P(0, i / 6);
      const r = P(1, i / 6);
      g.lineBetween(l.x, l.y, r.x, r.y);
    }
    g.lineStyle(2, COL.cyan, 0.7);
    g.strokePoints(corners, true);

    // corner stakes + flags
    corners.forEach(p => {
      g.lineStyle(2, 0xcbd5e1, 1);
      g.lineBetween(p.x, p.y, p.x, p.y - 24);
      g.fillStyle(0xf97316, 1);
      g.fillTriangle(p.x, p.y - 24, p.x + 12, p.y - 19, p.x, p.y - 14);
    });

    // GPR sled with push handle
    const sx = 40;
    const sy = 6;
    g.fillStyle(0x000000, 0.3);
    g.fillEllipse(sx, sy + 2, 70, 14);
    g.fillStyle(0x334155, 1);
    g.fillRoundedRect(sx - 30, sy - 22, 60, 20, 5);
    g.fillStyle(COL.amber, 1);
    g.fillRoundedRect(sx - 30, sy - 8, 60, 6, 3);
    g.fillStyle(0x0ea5e9, 0.9);
    g.fillRect(sx - 20, sy - 18, 16, 8);
    g.lineStyle(3, 0x94a3b8, 1);
    g.lineBetween(sx + 24, sy - 22, sx + 40, sy - 62);
    g.lineBetween(sx + 32, sy - 62, sx + 50, sy - 58);
    c.add(g);

    // radar pings rolling out under the sled
    for (let i = 0; i < 3; i++) {
      const ping = this.add.ellipse(sx, sy + 4, 40, 14).setStrokeStyle(2, COL.cyanSoft, 0.8);
      c.add(ping);
      this.tweens.add({ targets: ping, scaleX: 3.4, scaleY: 3.4, alpha: 0, duration: 1800, repeat: -1, delay: i * 600, ease: 'Sine.easeOut' });
    }
  }

  private buildDrillSite(c: Phaser.GameObjects.Container) {
    const g = this.add.graphics();

    // pad + borehole
    g.fillStyle(0x000000, 0.35);
    g.fillEllipse(0, 6, 190, 44);
    g.fillStyle(0x1f2937, 1);
    g.fillEllipse(0, 0, 150, 38);
    g.lineStyle(2, COL.cyanSoft, 0.6);
    g.strokeEllipse(0, 0, 150, 38);
    g.fillStyle(0x0b1220, 1);
    g.fillEllipse(0, 0, 36, 10);

    // ice shavings around the bore
    const rng = makeRng(42);
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      g.fillStyle(0xe0f2fe, 0.5 + rng() * 0.4);
      g.fillEllipse(Math.cos(a) * (28 + rng() * 26), Math.sin(a) * (7 + rng() * 6), 4 + rng() * 5, 2 + rng() * 2);
    }

    // lattice derrick
    const legX = (y: number) => 34 - 23 * ((-y - 2) / 163);
    g.lineStyle(4, 0x94a3b8, 1);
    g.lineBetween(-34, -2, -11, -165);
    g.lineBetween(34, -2, 11, -165);
    g.lineStyle(2, COL.steel, 1);
    for (let i = 0; i < 6; i++) {
      const y1 = -2 - i * 27;
      const y2 = y1 - 27;
      g.lineBetween(-legX(y1), y1, legX(y2), y2);
      g.lineBetween(legX(y1), y1, -legX(y2), y2);
      g.lineBetween(-legX(y2), y2, legX(y2), y2);
    }
    g.fillStyle(0x475569, 1);
    g.fillRect(-22, -180, 44, 16);
    g.fillStyle(0x94a3b8, 1);
    g.fillCircle(0, -172, 6);

    // drill string
    g.lineStyle(4, 0xcbd5e1, 1);
    g.lineBetween(0, -165, 0, -4);

    // core-tube rack and generator
    [
      [52, -34, 0xe0f2fe],
      [52, -24, 0xbae6fd],
      [52, -14, 0xe0f2fe]
    ].forEach(([x, y, col]) => {
      g.fillStyle(col, 1);
      g.fillRoundedRect(x, y, 56, 8, 4);
    });
    g.fillStyle(0x334155, 1);
    g.fillRect(-104, -32, 42, 30);
    g.fillStyle(COL.amber, 1);
    g.fillRect(-104, -20, 42, 4);
    g.lineStyle(2, 0x64748b, 1);
    g.lineBetween(-62, -22, -40, -10);
    g.lineBetween(-40, -10, -4, -8);
    c.add(g);

    // feed head travelling up/down the mast
    const head = this.add.rectangle(0, -120, 30, 26, COL.amber).setStrokeStyle(2, 0xfde68a);
    c.add(head);
    this.tweens.add({ targets: head, y: -92, duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // rotation marks running down the rod
    for (let i = 0; i < 3; i++) {
      const mark = this.add.rectangle(0, -160, 6, 8, 0xffffff, 0.8);
      c.add(mark);
      this.tweens.add({ targets: mark, y: -10, alpha: 0.1, duration: 1500, repeat: -1, delay: i * 500 });
    }

    // crown beacon
    const beacon = this.add.circle(0, -188, 4, 0xef4444, 1);
    c.add(beacon);
    this.tweens.add({ targets: beacon, alpha: 0.15, duration: 600, yoyo: true, repeat: -1 });
  }

  private buildMreuSite(c: Phaser.GameObjects.Container) {
    const heat = this.add
      .image(-17, -4, 'arc_glow')
      .setTint(0xf97316)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(3, 0.6)
      .setAlpha(0.25);
    c.add(heat);

    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35);
    g.fillEllipse(0, 6, 230, 40);

    // legs
    g.fillStyle(0x334155, 1);
    g.fillRect(-60, -30, 8, 30);
    g.fillRect(30, -30, 8, 30);

    // radiator fins
    for (let i = 0; i < 6; i++) {
      g.fillStyle(0x94a3b8, 1);
      g.fillRect(68 + i * 9, -92 + i * 3, 4, 56 - i * 6);
    }

    // main vacuum chamber
    g.fillStyle(0x475569, 1);
    g.fillRoundedRect(-90, -88, 150, 58, 28);
    g.fillStyle(0xffffff, 0.12);
    g.fillRoundedRect(-78, -84, 126, 10, 5);
    g.fillStyle(COL.amber, 0.85);
    g.fillRect(-30, -86, 26, 54);
    g.lineStyle(2, 0x94a3b8, 1);
    g.strokeRoundedRect(-90, -88, 150, 58, 28);
    g.fillStyle(0x0b1220, 1);
    g.fillCircle(32, -59, 9);
    g.lineStyle(2, COL.cyanSoft, 0.8);
    g.strokeCircle(32, -59, 9);

    // cold-trap tower + transfer pipe
    g.fillStyle(0x38bdf8, 0.55);
    g.fillRoundedRect(-142, -98, 36, 82, 8);
    g.lineStyle(2, 0xe0f2fe, 0.9);
    g.strokeRoundedRect(-142, -98, 36, 82, 8);
    g.fillStyle(0xffffff, 0.5);
    g.fillRoundedRect(-138, -96, 28, 8, 4);
    g.lineStyle(5, 0x94a3b8, 1);
    g.lineBetween(-106, -60, -90, -60);

    // vent stack
    g.lineStyle(5, 0x94a3b8, 1);
    g.lineBetween(10, -88, 10, -108);

    // solar mast + panel
    g.lineStyle(3, 0x94a3b8, 1);
    g.lineBetween(110, -34, 110, -96);
    g.fillStyle(0x1e3a8a, 1);
    g.fillPoints(
      [
        v2(84, -128),
        v2(152, -118),
        v2(144, -92),
        v2(76, -102)
      ],
      true
    );
    g.lineStyle(1, 0x60a5fa, 0.6);
    for (let i = 1; i < 4; i++) g.lineBetween(84 + i * 17 - 2, -128 + i * 2.5, 76 + i * 17 - 2, -102 + i * 2.5);
    c.add(g);

    // heater pulse
    this.tweens.add({ targets: heat, alpha: 0.5, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // sublimated vapour rising from the vent
    for (let i = 0; i < 6; i++) {
      const puff = this.add.circle(10, -112, 7, 0xe0f2fe, 0.55);
      c.add(puff);
      this.tweens.add({
        targets: puff,
        y: -175,
        x: 10 + Phaser.Math.Between(6, 26),
        scale: { from: 0.6, to: 2.2 },
        alpha: { from: 0.55, to: 0 },
        duration: 2200,
        repeat: -1,
        delay: i * 440
      });
    }
  }

  private buildRegolithSite(c: Phaser.GameObjects.Container) {
    const g = this.add.graphics();

    // compacted landing pad markings
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(0, 4, 260, 76);
    g.lineStyle(3, COL.ice, 0.55);
    g.strokeEllipse(0, 0, 240, 70);
    g.lineStyle(2, COL.cyanSoft, 0.5);
    g.strokeEllipse(0, 0, 150, 44);
    g.strokeEllipse(0, 0, 60, 18);
    g.lineStyle(1, COL.ice, 0.4);
    g.lineBetween(-120, 0, 120, 0);
    g.lineBetween(0, -35, 0, 35);
    [
      [-120, 0],
      [120, 0],
      [0, -35],
      [0, 35]
    ].forEach(([x, y]) => {
      g.fillStyle(COL.amber, 1);
      g.fillCircle(x, y, 3.5);
    });

    // test pit
    g.fillStyle(0x1b1410, 1);
    g.fillEllipse(-40, 8, 54, 15);
    g.fillStyle(0x3b2a20, 1);
    g.fillEllipse(-40, 6, 48, 11);

    // penetrometer tripod + rod
    g.lineStyle(3, 0x94a3b8, 1);
    g.lineBetween(-40, -92, -78, 10);
    g.lineBetween(-40, -92, -4, 10);
    g.lineBetween(-40, -92, -40, 6);
    g.fillStyle(0x475569, 1);
    g.fillRect(-50, -98, 20, 6);

    // plate-load test rig
    g.fillStyle(0x64748b, 1);
    g.fillEllipse(62, 2, 44, 12);
    g.fillStyle(0x94a3b8, 1);
    g.fillEllipse(62, 0, 44, 10);
    g.lineStyle(5, COL.steel, 1);
    g.lineBetween(62, 0, 62, -56);
    g.fillStyle(0x475569, 1);
    g.fillRect(36, -62, 52, 8);
    g.fillStyle(0xf8fafc, 1);
    g.fillCircle(62, -72, 7);
    g.lineStyle(1, 0x0f172a, 1);
    g.lineBetween(62, -72, 66, -76);
    c.add(g);

    // hammer weight sliding on the rod
    const weight = this.add.rectangle(-40, -80, 14, 12, 0xcbd5e1).setStrokeStyle(1, 0x475569);
    c.add(weight);
    this.tweens.add({ targets: weight, y: -46, duration: 650, yoyo: true, repeat: -1, hold: 350, ease: 'Quad.easeIn' });
  }

  /* ═══════════════════════════ snow storm & atmosphere ═══════════════════════════ */

  private createSnowStorm() {
    const layers = [
      { count: 120, tex: 'arc_flake_a', depth: DEPTH.snowFar, scale: [0.55, 1.0], alpha: [0.22, 0.5], vy: [34, 60], windMul: 0.55, sway: [4, 10] },
      { count: 70, tex: 'arc_flake_b', depth: DEPTH.snowMid, scale: [0.4, 0.8], alpha: [0.35, 0.65], vy: [68, 105], windMul: 1, sway: [8, 18] },
      { count: 26, tex: 'arc_flake_c', depth: DEPTH.snowNear, scale: [0.45, 0.9], alpha: [0.18, 0.38], vy: [130, 190], windMul: 1.7, sway: [14, 30] }
    ];

    layers.forEach(l => {
      for (let i = 0; i < l.count; i++) {
        const baseAlpha = Phaser.Math.FloatBetween(l.alpha[0], l.alpha[1]);
        const img = this.add
          .image(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), l.tex)
          .setDepth(l.depth)
          .setScale(Phaser.Math.FloatBetween(l.scale[0], l.scale[1]))
          .setAlpha(baseAlpha);
        this.flakes.push({
          img,
          vy: Phaser.Math.FloatBetween(l.vy[0], l.vy[1]),
          windMul: l.windMul,
          sway: Phaser.Math.FloatBetween(l.sway[0], l.sway[1]),
          phase: Math.random() * Math.PI * 2,
          freq: Phaser.Math.FloatBetween(0.0009, 0.0022),
          baseAlpha
        });
      }
    });

    // a few faint gust streaks racing across the field
    for (let i = 0; i < 9; i++) {
      const img = this.add
        .image(Phaser.Math.Between(0, W), Phaser.Math.Between(430, 940), 'arc_streak')
        .setScale(Phaser.Math.FloatBetween(0.6, 1.6), 1)
        .setAlpha(Phaser.Math.FloatBetween(0.05, 0.12))
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.snowMid);
      this.streaks.push({ img, speed: Phaser.Math.FloatBetween(4, 7) });
    }
  }

  private createAtmosphereOverlay() {
    // ground-hugging blowing-snow haze that sits in front of everything
    this.addDriftBand('arc_fog', 800, 2.6, 1.7, DEPTH.fogFront, 0.07, COL.ice, 0.45);

    this.snowVeil = this.add.rectangle(W / 2, H / 2, W, H, 0xd6ecfa, 0.05).setDepth(DEPTH.veil);

    this.grain = this.add
      .tileSprite(W / 2, H / 2, W, H, 'arc_grain')
      .setAlpha(0.06)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.grain);

    this.add.image(W / 2, H / 2, 'arc_vignette').setDisplaySize(W, H).setDepth(DEPTH.vignette);
  }

  private updateAtmosphere(time: number, dt: number, rawDelta: number) {
    // Parallax: layers shift against the astronaut's X so the horizon feels deep
    const ax = this.astronautSprite ? this.astronautSprite.x : W / 2;
    const off = ax - W / 2;
    const k = 1 - Math.exp(-dt * 8);
    this.parallaxLayers.forEach(l => {
      l.obj.x = Phaser.Math.Linear(l.obj.x, l.baseX - off * l.factor, k);
    });

    // Wandering gusts
    const gustWave = 0.5 + 0.5 * Math.sin(time * 0.00027) * Math.cos(time * 0.00091 + 1.1);
    this.gust = gustWave;
    this.wind = Phaser.Math.Linear(this.wind, 55 + gustWave * 90, Math.min(1, dt * 1.5));
    const intensity = 0.8 + 0.2 * Math.sin(time * 0.0004);

    for (const f of this.flakes) {
      f.img.x += (this.wind * f.windMul + Math.sin(time * f.freq + f.phase) * f.sway) * dt;
      f.img.y += f.vy * dt * (0.85 + gustWave * 0.3);
      if (f.img.y > H + 20) {
        f.img.y = -20;
        f.img.x = Phaser.Math.Between(-40, W);
      }
      if (f.img.x > W + 40) f.img.x = -40;
      else if (f.img.x < -40) f.img.x = W + 40;
      f.img.setAlpha(f.baseAlpha * intensity);
    }

    for (const s of this.streaks) {
      s.img.x += this.wind * s.speed * dt;
      if (s.img.x - s.img.displayWidth / 2 > W) {
        s.img.x = -s.img.displayWidth / 2;
        s.img.y = Phaser.Math.Between(430, 940);
      }
    }

    this.drift.forEach(d => {
      d.obj.tilePositionX += this.wind * d.speed * dt;
    });

    this.snowVeil?.setAlpha(0.03 + gustWave * 0.05);

    this.grainClock += rawDelta;
    if (this.grain && this.grainClock > 90) {
      this.grainClock = 0;
      this.grain.tilePositionX = Math.random() * 256;
      this.grain.tilePositionY = Math.random() * 256;
    }

    this.hudClock += rawDelta;
    if (this.hudClock > 150) {
      this.hudClock = 0;
      this.refreshHud();
    }
  }

  /* ═══════════════════════════ mini-game panel plumbing ═══════════════════════════ */

  private openPanel(w: number, titleStr: string): Phaser.GameObjects.Container {
    this.closeActivePanel();
    const panel = this.add.container(960, 720).setDepth(DEPTH.panel);
    this.activePanelContainer = panel;

    const hw = w / 2;
    const hh = 170;
    const frame = this.add.graphics();
    frame.fillStyle(COL.panel, 0.97);
    frame.fillRect(-hw, -hh, w, hh * 2);
    frame.fillStyle(0x0b1b30, 1);
    frame.fillRect(-hw, -hh, w, 44);
    frame.lineStyle(1, COL.cyan, 0.5);
    frame.lineBetween(-hw, -hh + 44, hw, -hh + 44);
    for (let y = -hh + 48; y < hh; y += 4) {
      frame.fillStyle(0xffffff, 0.015);
      frame.fillRect(-hw + 2, y, w - 4, 1);
    }
    frame.lineStyle(2, COL.cyan, 1);
    frame.strokeRect(-hw, -hh, w, hh * 2);
    frame.lineStyle(3, COL.ice, 0.9);
    [
      [-hw, -hh, 1, 1],
      [hw, -hh, -1, 1],
      [-hw, hh, 1, -1],
      [hw, hh, -1, -1]
    ].forEach(([x, y, sx, sy]) => {
      frame.lineBetween(x, y, x + sx * 18, y);
      frame.lineBetween(x, y, x, y + sy * 18);
    });

    // swallow clicks so the world underneath doesn't react while a panel is open
    const blocker = this.add.rectangle(0, 0, w, hh * 2, 0x000000, 0.001).setInteractive();
    const title = this.txt(0, -148, titleStr, FONT_HEAD, 14, '#38bdf8').setOrigin(0.5);

    panel.add([frame, blocker, title]);
    panel.setAlpha(0).setY(750);
    this.tweens.add({ targets: panel, y: 720, alpha: 1, duration: 220, ease: 'Cubic.easeOut' });
    return panel;
  }

  private addCloseButton() {
    const btn = this.add.rectangle(352, -148, 28, 28, 0x0f172a).setStrokeStyle(1, 0x475569).setInteractive({ useHandCursor: true });
    const x = this.txt(352, -148, '✕', FONT_BODY, 16, '#94a3b8').setOrigin(0.5);
    btn.on('pointerover', () => {
      btn.setStrokeStyle(1, COL.cyan);
      x.setColor('#e0f2fe');
    });
    btn.on('pointerout', () => {
      btn.setStrokeStyle(1, 0x475569);
      x.setColor('#94a3b8');
    });
    btn.on('pointerdown', () => this.closeActivePanel());
    this.activePanelContainer.add([btn, x]);
  }

  private closeActivePanel() {
    if (this.activePanelContainer) {
      this.activePanelContainer.destroy();
    }
  }

  /* ═══════════════════════════ Experiment A: GPR 6x6 Grid Scan ═══════════════════════════ */

  private runGprMiniGame() {
    const panel = this.openPanel(760, 'GROUND-PENETRATING RADAR (GPR) POLYGONAL ICE SCANNER');

    const inst = this.txt(0, -108, 'Scan cells to identify high-dielectric subsurface pure ice slabs (Need 4 ice signatures):', FONT_BODY, 13, '#cbd5e1').setOrigin(0.5);
    panel.add(inst);

    const gridSize = 6;
    const cellSize = 34;
    const gridCenterX = -150;
    const startY = -80;

    let foundIce = 0;

    // grid back-plate
    const plate = this.add.graphics();
    plate.fillStyle(0x07101f, 1);
    plate.fillRoundedRect(gridCenterX - 124, -104, 248, 248, 6);
    plate.lineStyle(1, 0x1e3a5f, 1);
    plate.strokeRoundedRect(gridCenterX - 124, -104, 248, 248, 6);
    panel.add(plate);

    // readout column
    const rx = 195;
    const label = this.txt(rx, -78, 'ICE SIGNATURES', FONT_HEAD, 11, '#38bdf8').setOrigin(0.5);
    const counter = this.txt(rx, -44, '0 / 4', FONT_HEAD, 30, '#e0f2fe').setOrigin(0.5);
    const barG = this.add.graphics();
    const drawBar = () => {
      barG.clear();
      barG.fillStyle(0x0f172a, 1);
      barG.fillRect(rx - 100, -14, 200, 8);
      barG.fillStyle(COL.cyan, 1);
      barG.fillRect(rx - 100, -14, 200 * Math.min(1, foundIce / 4), 8);
      barG.lineStyle(1, 0x334155, 1);
      barG.strokeRect(rx - 100, -14, 200, 8);
    };
    drawBar();
    panel.add([label, counter, barG]);

    const legend: Array<[number, string]> = [
      [0x38bdf8, 'PURE ICE SLAB (high dielectric)'],
      [0x78350f, 'DRY REGOLITH / BASALT DUST'],
      [0x1e293b, 'NOT YET SCANNED']
    ];
    legend.forEach(([col, text], i) => {
      const ly = 30 + i * 26;
      const sw = this.add.rectangle(rx - 128, ly, 14, 14, col).setStrokeStyle(1, 0x475569);
      const lt = this.txt(rx - 112, ly, text, FONT_BODY, 13, '#94a3b8').setOrigin(0, 0.5);
      panel.add([sw, lt]);
    });

    const alreadyDone = gameState.arcadiaCompletedExperiments.includes('exp_arcadia_gpr');
    const statusText = this.txt(rx, 118, alreadyDone ? 'SURVEY ARCHIVED // DATA SECURED' : 'AWAITING FIRST RETURN', FONT_MONO, 11, alreadyDone ? '#34d399' : '#f59e0b', {
      align: 'center',
      wordWrap: { width: 290 }
    }).setOrigin(0.5);
    panel.add(statusText);

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const x = gridCenterX + (c - 2.5) * (cellSize + 6);
        const y = startY + r * (cellSize + 6);

        const isIce = (r + c * 2) % 3 === 0;

        const cell = this.add.rectangle(x, y, cellSize, cellSize, 0x1e293b)
          .setStrokeStyle(1, 0x475569)
          .setInteractive({ useHandCursor: true });

        cell.on('pointerover', () => cell.setStrokeStyle(2, COL.cyanSoft));
        cell.on('pointerout', () => cell.setStrokeStyle(1, 0x475569));

        cell.on('pointerdown', () => {
          soundFx.playClick(isIce ? 1400 : 700);
          cell.disableInteractive();
          cell.setStrokeStyle(1, isIce ? COL.ice : 0x92400e);

          // radar ping out of the scanned cell
          const ping = this.add.circle(x, y, 6).setStrokeStyle(2, isIce ? COL.cyanSoft : 0xd97706, 0.9);
          panel.add(ping);
          this.tweens.add({ targets: ping, scale: 3.2, alpha: 0, duration: 450, onComplete: () => ping.destroy() });

          if (isIce) {
            cell.setFillStyle(0x38bdf8);
            foundIce++;
            counter.setText(`${Math.min(foundIce, 4)} / 4`);
            drawBar();
            statusText.setText('HIGH-DIELECTRIC RETURN: ICE LOGGED').setColor('#67e8f9');
            if (foundIce >= 4 && !gameState.arcadiaCompletedExperiments.includes('exp_arcadia_gpr')) {
              gameState.arcadiaCompletedExperiments.push('exp_arcadia_gpr');
              gameState.addLog('GPR SCAN COMPLETE: 1.2m pure slab ice layer mapped under polygonal regolith.', 'science');
              this.updateStatus();
              this.time.delayedCall(800, () => this.runGprMiniGame());
            }
          } else {
            cell.setFillStyle(0x78350f);
            statusText.setText('LOW-DIELECTRIC RETURN: DRY REGOLITH').setColor('#d97706');
          }
        });

        panel.add(cell);
      }
    }

    this.addCloseButton();
  }

  /* ═══════════════════════════ Experiment B: Ice Core Extraction Depth Selection ═══════════════════════════ */

  private runCoringMiniGame() {
    const panel = this.openPanel(780, 'PRCD ROTARY CRYO-DRILL // EXTRACTION DEPTH SELECTION');

    const drillOptions = [
      { depth: 'SHALLOW (0.5m)', pwr: '15% Power', yield: '35% Ice Yield', dust: '42% Basalt Dust', deep: false },
      { depth: 'MID-DEPTH (1.5m)', pwr: '28% Power', yield: '68% Ice Yield', dust: '22% Basalt Dust', deep: false },
      { depth: 'DEEP CORE (3.2m)', pwr: '45% Power', yield: '96% Ice Yield', dust: '6% Basalt Dust', deep: true }
    ];
    const num = (s: string) => parseInt(s, 10);

    drillOptions.forEach((opt, idx) => {
      const cx = -240 + idx * 240;
      const cy = 12;

      const optBg = this.add.rectangle(cx, cy, 210, 200, 0x0f172a)
        .setStrokeStyle(1, 0x0284c7)
        .setInteractive({ useHandCursor: true });

      const dTxt = this.txt(cx, cy - 76, opt.depth, FONT_HEAD, 12, '#38bdf8').setOrigin(0.5);

      const btn = this.add.rectangle(cx, cy + 68, 160, 32, 0x0284c7).setStrokeStyle(1, 0xffffff);
      const bTxt = this.txt(cx, cy + 68, 'COMMENCE DRILL', FONT_HEAD, 10, '#ffffff').setOrigin(0.5);

      panel.add([optBg, dTxt]);

      // stat rows: label + bar (same figures as before, now readable at a glance)
      const rows = [
        { label: opt.pwr, v: num(opt.pwr), color: COL.amber },
        { label: opt.yield, v: num(opt.yield), color: COL.mint },
        { label: opt.dust, v: num(opt.dust), color: COL.rust }
      ];
      rows.forEach((row, i) => {
        const ry = cy - 44 + i * 30;
        const t = this.txt(cx - 86, ry, row.label, FONT_BODY, 13, '#cbd5e1').setOrigin(0, 0.5);
        const barG = this.add.graphics();
        barG.fillStyle(0x0b1220, 1);
        barG.fillRect(cx - 86, ry + 10, 172, 5);
        barG.fillStyle(row.color, 1);
        barG.fillRect(cx - 86, ry + 10, (172 * row.v) / 100, 5);
        panel.add([t, barG]);
      });
      panel.add([btn, bTxt]);

      optBg.on('pointerover', () => {
        optBg.setFillStyle(0x13233d);
        optBg.setStrokeStyle(2, COL.cyan);
        btn.setFillStyle(0x0ea5e9);
      });
      optBg.on('pointerout', () => {
        optBg.setFillStyle(0x0f172a);
        optBg.setStrokeStyle(1, 0x0284c7);
        btn.setFillStyle(0x0284c7);
      });

      optBg.on('pointerdown', () => {
        soundFx.playTelemetryChirp();
        this.cameras.main.shake(160, 0.0018);
        gameState.resources.power = Math.max(10, gameState.resources.power - (opt.deep ? 35 : 18));
        gameState.waterIceReserve = Math.min(100, gameState.waterIceReserve + (opt.deep ? 28 : 12));
        if (!gameState.arcadiaCompletedExperiments.includes('exp_arcadia_core')) {
          gameState.arcadiaCompletedExperiments.push('exp_arcadia_core');
          gameState.addLog(`CRYO-CORE EXTRACTED: ${opt.depth} drill completed. Stratified ice core secured.`, 'science');
          this.updateStatus();
          this.time.delayedCall(600, () => this.runCoringMiniGame());
        }
      });
    });

    this.addCloseButton();
  }

  /* ═══════════════════════════ Experiment C: MREU Sublimation & Perchlorates Discovery ═══════════════════════════ */

  private runMreuMiniGame() {
    const panel = this.openPanel(780, 'MREU THERMAL VAPOR CAPTURE & WATER PURITY ANALYSIS');

    const desc = this.txt(
      0,
      -76,
      'Sublimate ice-bearing regolith slurry at 120°C in vacuum chamber.\nCRITICAL SCIENTIFIC FINDING: Extracted water carries 0.72 wt% Magnesium/Calcium Perchlorates.\nWater is toxic without multi-stage ion exchange membranes (Unlocks Act III synthesis)!',
      FONT_BODY,
      13,
      '#f59e0b',
      { align: 'center', wordWrap: { width: 720 } }
    ).setOrigin(0.5);

    const testBtn = this.add.rectangle(0, 8, 280, 42, 0x0284c7)
      .setStrokeStyle(1, 0x38bdf8)
      .setInteractive({ useHandCursor: true });

    const btnText = this.txt(0, 8, 'EXECUTE SUBLIMATION CYCLE', FONT_HEAD, 12, '#ffffff').setOrigin(0.5);

    panel.add([desc, testBtn, btnText]);

    // process line: slurry → chamber → cold trap → water + salts
    const stageNames = ['ICE-REGOLITH SLURRY', '120°C VACUUM CHAMBER', 'COLD-TRAP CONDENSER', 'H2O + PERCHLORATE SALTS'];
    const stages: Phaser.GameObjects.Rectangle[] = [];
    stageNames.forEach((name, i) => {
      const sx = -279 + i * 186;
      const box = this.add.rectangle(sx, 108, 156, 40, 0x0b1b30).setStrokeStyle(1, i === 3 ? 0xf59e0b : 0x0284c7);
      const t = this.txt(sx, 108, name, FONT_BODY, 12, i === 3 ? '#f59e0b' : '#94a3b8', { fontStyle: 'bold' }).setOrigin(0.5);
      stages.push(box);
      panel.add([box, t]);
      if (i < 3) {
        const arrow = this.add.graphics();
        arrow.fillStyle(COL.cyan, 0.9);
        arrow.fillTriangle(sx + 86, 100, sx + 86, 116, sx + 100, 108);
        panel.add(arrow);
      }
    });

    testBtn.on('pointerover', () => testBtn.setFillStyle(0x0ea5e9));
    testBtn.on('pointerout', () => testBtn.setFillStyle(0x0284c7));
    testBtn.on('pointerdown', () => {
      soundFx.playAirlockHiss();
      stages.forEach((s, i) => {
        this.time.delayedCall(i * 120, () => {
          s.setStrokeStyle(2, COL.amber);
          this.tweens.add({ targets: s, scaleX: 1.06, scaleY: 1.06, yoyo: true, duration: 140 });
        });
      });
      if (!gameState.arcadiaCompletedExperiments.includes('exp_arcadia_mreu')) {
        gameState.arcadiaCompletedExperiments.push('exp_arcadia_mreu');
        gameState.addLog('MREU ANALYSIS COMPLETE: Toxic perchlorates detected. Water purification protocol logged for Gale return.', 'science');
        this.updateStatus();
        this.time.delayedCall(600, () => this.runMreuMiniGame());
      }
    });

    this.addCloseButton();
  }

  /* ═══════════════════════════ Experiment D: Regolith Geomechanics Assessment ═══════════════════════════ */

  private runRegolithMiniGame() {
    const panel = this.openPanel(780, 'REGOLITH BEARING CAPACITY & ISRU LAUNCH PAD GEOTECHNICS');

    // left: soil column with the cone penetrometer and its resistance profile
    const cs = this.add.graphics();
    const sx = -340;
    const sw = 120;
    const top = -62;
    const bot = 128;
    const bands: Array<[number, number, number]> = [
      [top, -30, 0x9a7b5f],
      [-30, 20, 0x7a6350],
      [20, 70, 0x5e4e43],
      [70, bot, 0x45392f]
    ];
    bands.forEach(([y0, y1, col]) => {
      cs.fillStyle(col, 1);
      cs.fillRect(sx, y0, sw, y1 - y0);
    });
    const rng = makeRng(5);
    for (let i = 0; i < 90; i++) {
      cs.fillStyle(rng() < 0.5 ? 0xffffff : 0x000000, 0.08 + rng() * 0.1);
      cs.fillRect(sx + rng() * sw, top + rng() * (bot - top), 2, 2);
    }
    cs.lineStyle(2, COL.ice, 0.8);
    cs.lineBetween(sx, top, sx + sw, top);
    cs.lineStyle(1, 0x1e3a5f, 1);
    cs.strokeRect(sx, top, sw, bot - top);

    const rodX = sx + 36;
    cs.lineStyle(3, 0xcbd5e1, 1);
    cs.lineBetween(rodX, top - 30, rodX, 44);
    cs.fillStyle(COL.amber, 1);
    cs.fillTriangle(rodX - 6, 44, rodX + 6, 44, rodX, 58);
    cs.fillStyle(0x94a3b8, 1);
    cs.fillRect(rodX - 12, top - 34, 24, 6);

    const profile = [
      [0, top],
      [8, -40],
      [12, -10],
      [22, 20],
      [26, 50],
      [38, 80],
      [44, 112]
    ];
    const pts = profile.map(([dx, y]) => v2(sx + 66 + dx, y));
    cs.lineStyle(2, COL.mint, 1);
    cs.strokePoints(pts, false);
    pts.forEach(p => {
      cs.fillStyle(COL.mint, 1);
      cs.fillCircle(p.x, p.y, 2.5);
    });
    panel.add(cs);
    panel.add(this.txt(sx + sw / 2, -110, 'DYNAMIC CONE PENETROMETER', FONT_MONO, 9, '#94a3b8').setOrigin(0.5));
    panel.add(this.txt(sx + sw / 2, bot + 14, 'RESISTANCE vs DEPTH', FONT_MONO, 9, '#94a3b8').setOrigin(0.5));

    // right: measurements, cohesion gauge, ratify button
    const stats = this.txt(
      90,
      -58,
      'Dynamic Cone Penetrometer Measurements:\n• Cohesion: 1.45 kPa (Exceeds 1.2 nominal threshold)\n• Friction Angle: 37.2° (High angular basalt grains)\n• Ultimate Bearing Capacity: 240 kPa (Verified for heavy rocket landing legs)',
      FONT_MONO,
      12,
      '#34d399',
      { align: 'left', wordWrap: { width: 500 }, lineSpacing: 4 }
    ).setOrigin(0.5);

    const gx = -90;
    const gw = 360;
    const gauge = this.add.graphics();
    gauge.fillStyle(0x0f172a, 1);
    gauge.fillRect(gx, 24, gw, 8);
    gauge.fillStyle(COL.green, 1);
    gauge.fillRect(gx, 24, gw * (1.45 / 2.0), 8);
    gauge.lineStyle(1, 0x334155, 1);
    gauge.strokeRect(gx, 24, gw, 8);
    gauge.lineStyle(2, COL.amber, 1);
    gauge.lineBetween(gx + gw * (1.2 / 2.0), 19, gx + gw * (1.2 / 2.0), 37);
    const gaugeLabel = this.txt(gx, 10, 'COHESION 1.45 kPa  //  NOMINAL THRESHOLD 1.20 kPa', FONT_MONO, 10, '#94a3b8').setOrigin(0, 0.5);

    const logBtn = this.add.rectangle(90, 80, 280, 42, 0x10b981)
      .setStrokeStyle(1, 0xffffff)
      .setInteractive({ useHandCursor: true });

    const bText = this.txt(90, 80, 'RATIFY LANDING SITE STABILITY', FONT_HEAD, 11, '#050a14').setOrigin(0.5);

    logBtn.on('pointerover', () => logBtn.setFillStyle(0x34d399));
    logBtn.on('pointerout', () => logBtn.setFillStyle(0x10b981));
    logBtn.on('pointerdown', () => {
      soundFx.playTelemetryChirp();
      if (!gameState.arcadiaCompletedExperiments.includes('exp_arcadia_regolith')) {
        gameState.arcadiaCompletedExperiments.push('exp_arcadia_regolith');
        gameState.addLog('REGOLITH STABILITY RATIFIED: Arcadia sector qualified for future Mars Cargo Landers.', 'science');
        this.updateStatus();
        this.time.delayedCall(600, () => this.runRegolithMiniGame());
      }
    });

    panel.add([stats, gauge, gaugeLabel, logBtn, bText]);
    this.addCloseButton();
  }

  /* ═══════════════════════════ progress & return ═══════════════════════════ */

  private updateStatus() {
    const done = gameState.arcadiaCompletedExperiments.length;
    this.expStatusText.setText(`SCIENCE PROGRESS: ${done}/4 EXPERIMENTS EXECUTED`);
    this.drawProgressPips(done);
    this.sites.forEach(s => s.refresh());

    if (done >= 4) {
      this.expStatusText.setText('ALL ARCADIA EXPERIMENTS COMPLETE // READY TO RETURN TO GALE CRATER');
      this.expStatusText.setColor('#34d399');
      this.showReturnButton();
    }
  }

  private showReturnButton() {
    if (this.returnButtonShown) return;
    this.returnButtonShown = true;

    const cont = this.add.container(960, 960).setDepth(DEPTH.hud + 2);
    const glow = this.add
      .image(0, 0, 'arc_glow')
      .setTint(COL.mint)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(5.4, 1.3)
      .setAlpha(0.35);
    this.tweens.add({ targets: glow, alpha: 0.12, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Add Return to Gale Button
    const returnBtn = this.add.rectangle(0, 0, 380, 44, 0x10b981)
      .setStrokeStyle(1, 0xffffff)
      .setInteractive({ useHandCursor: true });

    const returnTxt = this.txt(0, 0, 'COMMENCE 4,180 KM RETURN TO GALE', FONT_HEAD, 13, '#050a14').setOrigin(0.5);

    returnBtn.on('pointerover', () => {
      returnBtn.setFillStyle(COL.mint);
      cont.setScale(1.03);
    });
    returnBtn.on('pointerout', () => {
      returnBtn.setFillStyle(COL.green);
      cont.setScale(1);
    });
    returnBtn.on('pointerdown', () => {
      soundFx.playTelemetryChirp();
      gameState.currentChapter = 'act_3_gale_return';
      gameState.save();
      gameState.currentLocation = 'gale';
      transitionToScene(this, 'ExpeditionMapScene');
    });

    cont.add([glow, returnBtn, returnTxt]);
  }
}