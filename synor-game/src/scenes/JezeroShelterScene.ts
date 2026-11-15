/**
 * Jezero Field Shelter Scene (Act V: 14-Day Solar Conjunction)
 * The Core Hard-Science Survival Simulation:
 * - 14-Day Event Schedule from conjunction.json
 * - Interactive Power Breaker Grid Load-Balancing
 * - Water-Tank Radiation Storm Bunker
 * - Cryogenic Biosignature Sample Preservation Dilemma
 * - Earth Radio Blackout & DSN Signal Recovery on Day 14
 *
 * UI REVISION (core logic untouched):
 * - Live Jezero viewport: delta-front scarp + crater rim parallax, dust storm that
 *   builds toward the Day-6 critical event and clears by Day 14
 * - Sun-Earth-Mars conjunction diagram (SEP angle, coronal scintillation, DSN packets)
 * - Water-wall shielding cross-section with animated SPE particles attenuated by the
 *   current hydro-shielding value
 * - Cryo-vault dewar with Perseverance-style sample tube, integrity ring, frost / thaw FX
 * - Live vitals panel, 14-sol timeline with per-day event tooltips, segmented sol HUD
 * All gameplay reads/writes (breakers, upgrades, stations, DecisionModal, effects,
 * scene transitions) are identical to the original.
 */

import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import { DecisionModal } from '../ui/DecisionModal';
import { attachBlenderSceneSlot } from '../utils/BlenderSceneBridge';
import { soundFx } from '../utils/ProceduralAudio';
import { audioManager } from '../state/AudioManager';
import { transitionToScene, fadeSceneIn } from '../utils/SceneTransition';

interface ConjunctionChoice {
  text: string;
  detail: string;
  powerDelta?: number;
  co2Delta?: number;
  o2Cost?: number;
  radiationDose?: number;
  thermalDelta?: number;
  foodDelta?: number;
  waterDelta?: number;
  evaRequired?: boolean;
  endingTrigger?: boolean;
}

interface ConjunctionEventDay {
  day: number;
  title: string;
  summary: string;
  event: string;
  choices: ConjunctionChoice[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme & Layout (UI only)
// ─────────────────────────────────────────────────────────────────────────────

const FONT_HEAD = 'Orbitron, sans-serif';
const FONT_MONO = 'Share Tech Mono, monospace';
const FONT_BODY = 'Rajdhani, sans-serif';

const COLOR = {
  panel: 0x070e1c,
  panelInner: 0x0a1628,
  ink: 0x030712,
  cyan: 0x38bdf8,
  cyanDeep: 0x0284c7,
  green: 0x34d399,
  greenDeep: 0x10b981,
  amber: 0xf59e0b,
  red: 0xef4444,
  slate: 0x475569,
  steel: 0x94a3b8,
};

/** Jezero palette: butterscotch dust sky, pale delta clays, dark basaltic floor. */
const JZ = {
  skyTop: 0x2e140b,
  skyMid: 0x7d3f1c,
  skyHorizon: 0xc77f42,
  storm: 0x9b5a2c,
  stormDeep: 0x5a2c14,
  dust: 0xdca86c,
  rim: 0x8a5434,
  rimHi: 0xa9714a,
  delta: [0xb78a5f, 0xa0694c, 0x8f7566, 0xc29a6e, 0x7c6a60],
  ground0: 0x7a4524,
  ground1: 0x2c1309,
};

// Outer viewport frame and inner glass area
const VP = { x: 450, y: 112, w: 1020, h: 300 };
const WIN = { x: 460, y: 142, w: 1000, h: 258 };
const HZ = 318; // horizon line inside the glass

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const snap = (v: number, step = 4) => Math.round(v / step) * step;

const mix = (a: number, b: number, t: number): number => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
};

type Gfx = Phaser.GameObjects.Graphics;

/** Scenario dust storm: builds toward the Day-6 critical event, clears by Day 14. Visual only. */
const stormAt = (day: number) => 0.35 + 0.6 * Math.exp(-Math.pow((day - 6) / 3.2, 2));
/** Simulated Sun-Earth-Probe angle. Blackout while below ~2 degrees. Visual only. */
const sepAt = (day: number) => (2.0 * Math.abs(day - 7.5)) / 6.5;

const statusColor = (v: number) => (v > 60 ? COLOR.green : v > 30 ? COLOR.amber : COLOR.red);

function drawBrackets(g: Gfx, cx: number, cy: number, w: number, h: number, len: number, color: number, alpha = 0.9) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  g.lineStyle(2, color, alpha);
  g.lineBetween(x0, y0, x0 + len, y0).lineBetween(x0, y0, x0, y0 + len);
  g.lineBetween(x1, y0, x1 - len, y0).lineBetween(x1, y0, x1, y0 + len);
  g.lineBetween(x0, y1, x0 + len, y1).lineBetween(x0, y1, x0, y1 - len);
  g.lineBetween(x1, y1, x1 - len, y1).lineBetween(x1, y1, x1, y1 - len);
}

interface DustP { x: number; y: number; z: number; s: number; a: number; ph: number }
interface SpeP { k: number; t: number; v: number }

export class JezeroShelterScene extends Phaser.Scene {
  private conjunctionData: ConjunctionEventDay[] = [];
  private dayIndicatorText!: Phaser.GameObjects.Text;
  private breakerWattageText!: Phaser.GameObjects.Text;
  private breakerSwitches: Record<string, { rect: Phaser.GameObjects.Rectangle; stateTxt: Phaser.GameObjects.Text }> = {};
  private cryoStatusText!: Phaser.GameObjects.Text;

  // ── UI-only state ──
  private breakerExtras: Record<
    string,
    { led: Phaser.GameObjects.Arc; track: Phaser.GameObjects.Rectangle; knob: Phaser.GameObjects.Arc }
  > = {};
  private breakerLoadFill?: Phaser.GameObjects.Rectangle;

  private lastDay = -1;
  private lastSig = '';
  private storm = 0.4;

  // viewport
  private vpSky?: Gfx;
  private vpRim?: Gfx;
  private vpDelta?: Gfx;
  private vpGround?: Gfx;
  private vpHaze?: Gfx;
  private vpDust?: Gfx;
  private vpVeil?: Phaser.GameObjects.Rectangle;
  private vpLabels: Array<{ obj: Phaser.GameObjects.Container; factor: number; baseX: number }> = [];
  private vpReadout?: Phaser.GameObjects.Text;
  private vpPhase?: Phaser.GameObjects.Text;
  private vpParticles: DustP[] = [];
  private vpOff = 0;

  // header / hud
  private linkChipTxt?: Phaser.GameObjects.Text;
  private linkChipBg?: Phaser.GameObjects.Rectangle;
  private advTxt?: Phaser.GameObjects.Text;
  private daySegGfx?: Gfx;

  // vitals / structure / stations
  private vitalRows: Array<{
    get: () => number;
    fill: Phaser.GameObjects.Rectangle;
    val: Phaser.GameObjects.Text;
  }> = [];
  private vitalCo2?: Phaser.GameObjects.Text;
  private vitalDose?: Phaser.GameObjects.Text;
  private structBarFill?: Phaser.GameObjects.Rectangle;
  private structBarTxt?: Phaser.GameObjects.Text;
  private stationReadouts: Array<{ txt: Phaser.GameObjects.Text; get: () => string }> = [];

  // bunker
  private bunkerGfx?: Gfx;
  private shieldStats?: Phaser.GameObjects.Text;
  private spe: SpeP[] = [];

  // cryo
  private cryoGfx?: Gfx;
  private frost: Array<{ x: number; y: number; ph: number }> = [];

  // conjunction diagram + timeline
  private conjGfx?: Gfx;
  private sepTxt?: Phaser.GameObjects.Text;
  private linkTxt?: Phaser.GameObjects.Text;
  private scintTxt?: Phaser.GameObjects.Text;
  private earthLbl?: Phaser.GameObjects.Text;
  private marsLbl?: Phaser.GameObjects.Text;
  private tlGfx?: Gfx;
  private tlDetail?: Phaser.GameObjects.Text;
  private tlTip?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'JezeroShelterScene' });
  }

  create() {
    // reset UI-only state so scene restarts are clean
    this.lastDay = -1;
    this.lastSig = '';
    this.vpLabels = [];
    this.vpParticles = [];
    this.vpOff = 0;
    this.vitalRows = [];
    this.stationReadouts = [];
    this.breakerExtras = {};
    this.breakerSwitches = {};
    this.spe = [];
    this.frost = [];

    gameState.currentLocation = 'jezero_shelter';
    gameState.save();
    audioManager.playMusic(this, 'music_game', { loop: true });
    fadeSceneIn(this);

    // Load conjunction data from cache
    const cachedData = this.cache.json.get('conjunction_data');
    if (cachedData && cachedData.conjunctionDays) {
      this.conjunctionData = cachedData.conjunctionDays;
    }

    // Attach Blender Slot or Procedural Shelter Interior
    attachBlenderSceneSlot(this, 'JEZERO_SHELTER', () => {
      this.createProceduralShelterBackdrop();
    });

    this.createExteriorViewport();
    this.createHeader();
    this.createPowerBreakerPanel();
    this.createWaterShieldingVisualizer();
    this.createCryoSampleVault();
    this.createStructuralSystems();
    this.createShelterStations();
    this.createVitalsPanel();
    this.createConjunctionPanel();
    this.createConjunctionTimeline();
    this.createDayProgressionHUD();

    // Check if initial conjunction day event needs to be triggered
    this.time.delayedCall(1200, () => {
      this.promptCurrentDayEvent();
    });
  }

  // ───────────────────────────── Shared UI helpers ─────────────────────────────

  private makePanel(cx: number, cy: number, w: number, h: number, title: string, accent: number = COLOR.cyan) {
    const c = this.add.container(cx, cy);
    const bg = this.add.rectangle(0, 0, w, h, COLOR.panel, 0.94).setStrokeStyle(1.5, accent, 0.75);
    const topLine = this.add.rectangle(0, -h / 2 + 1.5, w, 3, accent, 0.9);
    const br = this.add.graphics();
    drawBrackets(br, 0, 0, w + 8, h + 8, 14, accent, 0.9);
    const t = this.add
      .text(-w / 2 + 16, -h / 2 + 20, title, {
        fontFamily: FONT_HEAD,
        fontSize: '12px',
        color: hex(accent),
        letterSpacing: 1,
      })
      .setOrigin(0, 0.5);
    c.add([bg, topLine, br, t]);
    return { c, bg };
  }

  private stepRidge(
    g: Gfx,
    baseY: number,
    pts: Array<[number, number]>,
    colorAt: (x: number, y: number) => number,
    rimColor: number,
    alpha = 1,
    band = 8
  ) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      for (let x = x0; x < x1; x += 4) {
        const t = (x - x0) / Math.max(1, x1 - x0);
        const topY = snap(Phaser.Math.Linear(y0, y1, t), 4);
        let yy = topY;
        while (yy < baseY) {
          const next = Math.min(baseY, (Math.floor(yy / band) + 1) * band);
          g.fillStyle(colorAt(x, yy), alpha).fillRect(x, yy, 5, next - yy + 1);
          yy = next;
        }
        g.fillStyle(rimColor, alpha).fillRect(x, topY, 5, 3);
      }
    }
  }

  // ───────────────────────────── Backdrop & Exterior Viewport ─────────────────────────────

  private createProceduralShelterBackdrop() {
    // Interior pressurized cabin walls (dark titanium composites)
    this.add.rectangle(960, 540, 1920, 1080, 0x050912);

    const walls = this.add.graphics();
    // Wall panel seams
    walls.lineStyle(1, 0x1e293b, 0.55);
    for (let x = 0; x <= 1920; x += 120) walls.lineBetween(x, 0, x, 1080);
    for (let y = 0; y <= 1080; y += 120) walls.lineBetween(0, y, 1920, y);
    // Rivets at seam crossings
    walls.fillStyle(0x334155, 0.7);
    for (let x = 0; x <= 1920; x += 120) {
      for (let y = 0; y <= 1080; y += 120) walls.fillRect(x - 2, y - 2, 4, 4);
    }
    // Floor grating
    walls.fillStyle(0x0a1020, 1).fillRect(0, 1010, 1920, 70);
    walls.lineStyle(1, 0x1e293b, 0.8);
    for (let x = 0; x <= 1920; x += 24) walls.lineBetween(x, 1010, x - 30, 1080);
    walls.lineStyle(2, 0x334155, 0.9).lineBetween(0, 1010, 1920, 1010);
    // Hazard stripes along the floor edge
    for (let x = 0; x < 1920; x += 48) {
      walls.fillStyle(x % 96 === 0 ? 0xf59e0b : 0x0f172a, 0.35).fillRect(x, 1006, 24, 4);
    }
    // Ceiling conduit run
    walls.fillStyle(0x0f172a, 1).fillRect(0, 0, 1920, 22);
    walls.lineStyle(1.5, 0x334155, 0.9).lineBetween(0, 22, 1920, 22);
    for (let x = 80; x < 1920; x += 240) {
      walls.fillStyle(0x1e293b).fillRect(x, 0, 14, 22);
    }

    // Emergency red/amber cabin strip light
    const emergencyLight = this.add.rectangle(960, 30, 1800, 4, 0xef4444, 0.8);
    this.tweens.add({
      targets: emergencyLight,
      alpha: { from: 0.8, to: 0.3 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
    });

    // Soft red wash in the corners (pulses with the strip)
    const wash = this.add.graphics();
    for (let i = 0; i < 8; i++) {
      wash.fillStyle(0xef4444, 0.012 * (8 - i)).fillRect(0, i * 14, 1920, 14);
    }
    this.tweens.add({ targets: wash, alpha: { from: 1, to: 0.5 }, duration: 1600, yoyo: true, repeat: -1 });
  }

  private createExteriorViewport() {
    // Frame
    this.add
      .rectangle(VP.x + VP.w / 2, VP.y + VP.h / 2, VP.w, VP.h, 0x0b1220)
      .setStrokeStyle(3, 0x334155);
    this.add
      .text(VP.x + 16, VP.y + 15, 'EXTERNAL VIEWPORT // JEZERO CRATER  18.44°N 77.45°E', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: hex(COLOR.amber),
      })
      .setOrigin(0, 0.5);
    this.vpPhase = this.add
      .text(VP.x + VP.w - 16, VP.y + 15, '', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: hex(COLOR.amber),
      })
      .setOrigin(1, 0.5);

    // Geometry mask keeps parallax layers inside the glass
    const maskG = this.make.graphics({ x: 0, y: 0 }, false);
    maskG.fillStyle(0xffffff).fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    const mask = maskG.createGeometryMask();
    const layer = () => {
      const g = this.add.graphics();
      g.setMask(mask);
      return g;
    };

    this.vpSky = layer();
    this.vpRim = layer();
    this.vpDelta = layer();
    this.vpGround = layer();
    this.vpHaze = layer();
    this.vpDust = layer();

    const rnd = new Phaser.Math.RandomDataGenerator(['jezero-view-v1']);

    // Far crater rim (parallax 0.25)
    this.stepRidge(
      this.vpRim,
      HZ + 10,
      [
        [WIN.x - 60, 296], [560, 268], [700, 282], [860, 258],
        [1040, 276], [1200, 262], [1380, 280], [WIN.x + WIN.w + 60, 270],
      ],
      () => JZ.rim,
      JZ.rimHi,
      0.55
    );

    // Jezero western delta front + Kodiak butte (strata of clays / carbonates, parallax 0.55)
    const deltaColor = (_x: number, y: number) => {
      const i = ((Math.floor(y / 8) % JZ.delta.length) + JZ.delta.length) % JZ.delta.length;
      return mix(JZ.delta[i], 0xe3b27a, 0.2);
    };
    this.stepRidge(
      this.vpDelta,
      HZ + 10,
      [
        [WIN.x - 60, 310], [520, 300], [540, 258], [900, 252], [930, 270],
        [1010, 284], [1100, 296], [1200, 304], [WIN.x + WIN.w + 60, 310],
      ],
      deltaColor,
      0xe3b080,
      0.98
    );
    this.stepRidge(
      this.vpDelta,
      HZ + 10,
      [[1210, 310], [1240, 278], [1255, 264], [1305, 264], [1330, 282], [1360, 310]],
      deltaColor,
      0xe3b080,
      0.98
    );

    // Landmark callouts ride the delta layer
    const deltaLabel = this.makeViewportLabel(660, 230, 'DELTA FRONT', 700, 254);
    const kodiakLabel = this.makeViewportLabel(1270, 232, 'KODIAK BUTTE', 1280, 264);
    this.vpLabels.push({ obj: deltaLabel, factor: 7, baseX: 660 });
    this.vpLabels.push({ obj: kodiakLabel, factor: 7, baseX: 1270 });

    // Foreground regolith with boulders and wheel tracks (parallax 1.0)
    const gg = this.vpGround;
    const gx0 = WIN.x - 60;
    const gw = WIN.w + 120;
    const gy0 = HZ;
    const gh = WIN.y + WIN.h - HZ + 20;
    const bands = 14;
    for (let i = 0; i < bands; i++) {
      gg.fillStyle(mix(JZ.ground0, JZ.ground1, i / (bands - 1)));
      gg.fillRect(gx0, gy0 + (i * gh) / bands, gw, gh / bands + 1);
    }
    for (let i = 0; i < 70; i++) {
      const rx = rnd.between(gx0, gx0 + gw);
      const ry = rnd.between(gy0 + 6, gy0 + gh - 4);
      const s = 2 + Math.round(((ry - gy0) / gh) * 4);
      gg.fillStyle(0x2c0f05, 0.7).fillRect(rx, ry, s + 2, s);
      gg.fillStyle(0xb9784a, 0.4).fillRect(rx, ry, s + 2, 1);
    }
    for (let i = 0; i < 9; i++) {
      const rx = rnd.between(gx0 + 40, gx0 + gw - 40);
      const ry = rnd.between(gy0 + 26, gy0 + gh - 10);
      const sc = 0.6 + ((ry - gy0) / gh) * 1.4;
      gg.fillStyle(0x000000, 0.3).fillEllipse(rx - 4 * sc, ry + 4 * sc, 30 * sc, 7 * sc);
      gg.fillStyle(0x4a2a20).fillRoundedRect(rx - 12 * sc, ry - 10 * sc, 24 * sc, 14 * sc, 3);
      gg.fillStyle(0x8b5a3c).fillRect(rx - 9 * sc, ry - 10 * sc, 18 * sc, 3 * sc);
    }
    gg.lineStyle(2, 0x2c0f05, 0.45);
    gg.lineBetween(640, WIN.y + WIN.h, 770, HZ + 8).lineBetween(676, WIN.y + WIN.h, 780, HZ + 8);

    // Dust veil (alpha follows storm level)
    this.vpVeil = this.add.rectangle(
      WIN.x + WIN.w / 2, WIN.y + WIN.h / 2, WIN.w, WIN.h, JZ.storm, 0.3
    );

    // Wind-blown dust particles
    for (let i = 0; i < 120; i++) {
      const z = rnd.realInRange(0, 1);
      this.vpParticles.push({
        x: rnd.between(WIN.x, WIN.x + WIN.w),
        y: rnd.between(WIN.y + 8, WIN.y + WIN.h - 6),
        z,
        s: 2 + Math.round(z * 2) * 1,
        a: rnd.realInRange(0.15, 0.5) * (0.5 + z * 0.7),
        ph: rnd.realInRange(0, Math.PI * 2),
      });
    }

    // Glass reflections + edge vignette + bolts (static, unmasked)
    const glass = this.add.graphics();
    glass.fillStyle(0xffffff, 0.035);
    glass.beginPath();
    glass.moveTo(WIN.x + 120, WIN.y).lineTo(WIN.x + 220, WIN.y).lineTo(WIN.x + 80, WIN.y + WIN.h).lineTo(WIN.x - 20, WIN.y + WIN.h);
    glass.closePath().fillPath();
    glass.beginPath();
    glass.moveTo(WIN.x + 260, WIN.y).lineTo(WIN.x + 290, WIN.y).lineTo(WIN.x + 150, WIN.y + WIN.h).lineTo(WIN.x + 120, WIN.y + WIN.h);
    glass.closePath().fillPath();
    for (let i = 0; i < 8; i++) {
      glass.lineStyle(3, 0x000000, 0.16 - i * 0.018);
      glass.strokeRect(WIN.x + i * 3, WIN.y + i * 3, WIN.w - i * 6, WIN.h - i * 6);
    }
    glass.lineStyle(2, 0x1e293b, 1).strokeRect(WIN.x, WIN.y, WIN.w, WIN.h);
    glass.fillStyle(0x475569, 0.9);
    for (const [bx, by] of [
      [VP.x + 6, VP.y + 6], [VP.x + VP.w - 6, VP.y + 6],
      [VP.x + 6, VP.y + VP.h - 6], [VP.x + VP.w - 6, VP.y + VP.h - 6],
      [VP.x + VP.w / 2, VP.y + 6], [VP.x + VP.w / 2, VP.y + VP.h - 6],
    ]) {
      glass.fillCircle(bx, by, 3);
    }

    // Readout chips inside the glass
    this.vpReadout = this.add
      .text(WIN.x + 14, WIN.y + 12, '', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#fcd9a8',
        backgroundColor: 'rgba(4,8,17,0.72)',
        padding: { x: 8, y: 5 },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);

    this.storm = stormAt(gameState.conjunctionDay);
    this.drawViewportSky();
    this.drawViewportHaze();
  }

  private makeViewportLabel(x: number, y: number, text: string, toX: number, toY: number) {
    const c = this.add.container(x, y);
    const gl = this.add.graphics();
    gl.lineStyle(1.5, 0xfde68a, 0.6).lineBetween(0, 0, toX - x, toY - y);
    gl.fillStyle(0xfde68a, 0.95).fillRect(toX - x - 3, toY - y - 3, 6, 6);
    const t = this.add
      .text(6, 0, text, { fontFamily: FONT_MONO, fontSize: '11px', color: '#fde68a' })
      .setOrigin(0, 0.5)
      .setShadow(1, 1, '#2a0f04', 2, false, true);
    c.add([gl, t]);
    return c;
  }

  private drawViewportSky() {
    const g = this.vpSky;
    if (!g) return;
    const s = this.storm;
    g.clear();
    const top = mix(JZ.skyTop, JZ.stormDeep, s * 0.5);
    const mid = mix(JZ.skyMid, JZ.storm, s * 0.7);
    const hor = mix(JZ.skyHorizon, JZ.storm, s * 0.65);

    const topH = 90;
    for (let i = 0; i < 8; i++) {
      g.fillStyle(mix(top, mid, i / 7));
      g.fillRect(WIN.x - 20, WIN.y + (i * topH) / 8, WIN.w + 40, topH / 8 + 1);
    }
    const lowH = HZ + 12 - (WIN.y + topH);
    for (let i = 0; i < 10; i++) {
      g.fillStyle(mix(mid, hor, i / 9));
      g.fillRect(WIN.x - 20, WIN.y + topH + (i * lowH) / 10, WIN.w + 40, lowH / 10 + 1);
    }

    // Dust-dimmed Sun
    const cx = 1190;
    const cy = 212;
    for (const [r, col, a] of [
      [90, 0xfde0a8, 0.05 * (1 - s * 0.4)],
      [52, 0xfde0a8, 0.1 * (1 - s * 0.4)],
      [22, 0xfff3d1, 0.9 * (1 - s * 0.85)],
    ] as Array<[number, number, number]>) {
      for (let dy = -r; dy <= r; dy += 4) {
        const hw = snap(Math.sqrt(Math.max(0, r * r - dy * dy)));
        g.fillStyle(col, a).fillRect(cx - hw, cy + dy, hw * 2, 4);
      }
    }
  }

  private drawViewportHaze() {
    const g = this.vpHaze;
    if (!g) return;
    const s = this.storm;
    g.clear();
    for (let i = 0; i < 22; i++) {
      const dy = HZ - 70 + i * 5;
      const peak = 1 - Math.abs(i - 14) / 14;
      g.fillStyle(0xe3b27a, Math.max(0, peak) * (0.1 + s * 0.45)).fillRect(WIN.x - 20, dy, WIN.w + 40, 5);
    }
  }

  // ───────────────────────────── Header ─────────────────────────────

  private createHeader() {
    const header = this.add.container(960, 62);
    const bg = this.add.rectangle(0, 0, 1100, 56, 0x030712, 0.94).setStrokeStyle(2, 0xef4444, 0.8);
    const br = this.add.graphics();
    drawBrackets(br, 0, 0, 1108, 64, 14, COLOR.red, 0.9);

    const title = this.add.text(0, -10, 'ACT V: JEZERO FIELD SHELTER — SOLAR CONJUNCTION MODE', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '14px',
      color: '#ef4444',
      letterSpacing: 2
    }).setOrigin(0.5);

    const subtitle = this.add.text(0, 12, 'EARTH RADIO UPLINK INTERRUPTED BY CORONAL PLASMA // 14 SOLS OF SILENCE', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '11px',
      color: '#cbd5e1'
    }).setOrigin(0.5);

    // Location chip (left) + live link chip (right)
    const locBg = this.add.rectangle(-470, 0, 140, 28, COLOR.cyan, 0.1).setStrokeStyle(1, COLOR.cyan, 0.7);
    const locTxt = this.add
      .text(-470, 0, '◆ JEZERO CRATER', { fontFamily: FONT_MONO, fontSize: '11px', color: hex(COLOR.cyan) })
      .setOrigin(0.5);
    this.linkChipBg = this.add.rectangle(470, 0, 160, 28, COLOR.red, 0.14).setStrokeStyle(1, COLOR.red, 0.8);
    this.linkChipTxt = this.add
      .text(470, 0, 'LINK: BLACKOUT', { fontFamily: FONT_MONO, fontSize: '11px', color: hex(COLOR.red) })
      .setOrigin(0.5);

    header.add([bg, br, title, subtitle, locBg, locTxt, this.linkChipBg, this.linkChipTxt]);
  }

  // ───────────────────────────── Power Breaker Bus ─────────────────────────────

  private createPowerBreakerPanel() {
    const W_ = 380;
    const H_ = 500;
    const { c: panel } = this.makePanel(230, 362, W_, H_, 'POWER LOAD-BALANCING BUS');

    const { used, max } = gameState.getBreakerWattage();
    this.breakerWattageText = this.add.text(-W_ / 2 + 16, -H_ / 2 + 50, `NET BUS LOAD: ${used}W / ${max}W`, {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '12px',
      color: used > max ? '#ef4444' : '#34d399'
    }).setOrigin(0, 0.5);

    const loadTrack = this.add.rectangle(0, -H_ / 2 + 72, W_ - 32, 8, 0x1e293b).setOrigin(0.5, 0.5);
    this.breakerLoadFill = this.add
      .rectangle(-(W_ - 32) / 2, -H_ / 2 + 72, W_ - 32, 8, COLOR.green)
      .setOrigin(0, 0.5);
    this.breakerLoadFill.scaleX = 0.001;

    panel.add([this.breakerWattageText, loadTrack, this.breakerLoadFill]);

    const breakersList: { key: keyof typeof gameState.breakers; name: string; watt: number; y: number }[] = [
      { key: 'lifeSupport', name: 'ECLSS O2/CO2 SCRUBBERS', watt: 30, y: -108 },
      { key: 'thermalHeating', name: 'CABIN THERMAL HEATING', watt: 25, y: -38 },
      { key: 'waterFiltration', name: 'HYDRO RECYCLING UNIT', watt: 20, y: 32 },
      { key: 'sampleCryo', name: 'SAMPLE CRYO-VAULT', watt: 20, y: 102 },
      { key: 'commsGreenhouse', name: 'COMMS & GREENHOUSE', watt: 15, y: 172 }
    ];

    breakersList.forEach(b => {
      const isOn = gameState.breakers[b.key];

      const bBox = this.add.rectangle(0, b.y, W_ - 32, 58, 0x0f172a)
        .setStrokeStyle(1, isOn ? 0x10b981 : 0xef4444)
        .setInteractive({ useHandCursor: true });

      const led = this.add.circle(-W_ / 2 + 34, b.y, 5, isOn ? COLOR.green : COLOR.red, 0.95);

      const nameTxt = this.add.text(-W_ / 2 + 52, b.y - 11, b.name, {
        fontFamily: 'Rajdhani, sans-serif',
        fontSize: '14px',
        color: '#f8fafc'
      }).setOrigin(0, 0.5);

      const wattTxt = this.add.text(-W_ / 2 + 52, b.y + 11, `${b.watt}W DRAW`, {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: '10px',
        color: '#94a3b8'
      }).setOrigin(0, 0.5);

      const stateTxt = this.add.text(118, b.y - 10, isOn ? 'ONLINE' : 'OFFLINE', {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: '11px',
        color: isOn ? '#34d399' : '#ef4444'
      }).setOrigin(0.5);

      // Toggle switch visual
      const track = this.add
        .rectangle(118, b.y + 12, 46, 14, isOn ? 0x064e3b : 0x450a0a)
        .setStrokeStyle(1, isOn ? 0x34d399 : 0xef4444, 0.9);
      const knob = this.add.circle(isOn ? 118 + 15 : 118 - 15, b.y + 12, 6, isOn ? COLOR.green : COLOR.red);

      this.breakerSwitches[b.key] = { rect: bBox, stateTxt };
      this.breakerExtras[b.key] = { led, track, knob };

      bBox.on('pointerover', () => bBox.setFillStyle(0x16233b));
      bBox.on('pointerout', () => bBox.setFillStyle(0x0f172a));
      bBox.on('pointerdown', () => {
        const newState = gameState.toggleBreaker(b.key);
        soundFx.playClick(newState ? 1200 : 600);
        this.updateBreakersUI();
      });

      panel.add([bBox, led, nameTxt, wattTxt, stateTxt, track, knob]);
    });

    const hint = this.add
      .text(0, H_ / 2 - 20, 'CLICK A BREAKER TO SHED OR RESTORE LOAD', {
        fontFamily: FONT_MONO,
        fontSize: '10px',
        color: '#64748b',
      })
      .setOrigin(0.5);
    panel.add(hint);
  }

  private updateBreakersUI() {
    const { used, max } = gameState.getBreakerWattage();
    this.breakerWattageText.setText(`NET BUS LOAD: ${used}W / ${max}W`);
    this.breakerWattageText.setColor(used > max ? '#ef4444' : '#34d399');

    (Object.keys(this.breakerSwitches) as (keyof typeof gameState.breakers)[]).forEach(key => {
      const item = this.breakerSwitches[key];
      const isOn = gameState.breakers[key];
      item.rect.setStrokeStyle(1, isOn ? 0x10b981 : 0xef4444);
      item.stateTxt.setText(isOn ? 'ONLINE' : 'OFFLINE');
      item.stateTxt.setColor(isOn ? '#34d399' : '#ef4444');
    });

    // Update Cryo text
    if (!gameState.breakers.sampleCryo) {
      this.cryoStatusText.setText('CRYO-STORAGE: UNPOWERED [SAMPLES THAWING]');
      this.cryoStatusText.setColor('#ef4444');
    } else {
      this.cryoStatusText.setText(`CRYO-STORAGE: -80°C NOMINAL [${Math.round(gameState.sciencePreservedPercent)}% INTEGRITY]`);
      this.cryoStatusText.setColor('#34d399');
    }
  }

  /** UI-only: keep LED / switch / load bar in sync with whatever gameState says. */
  private refreshBreakerVisuals() {
    (Object.keys(this.breakerExtras) as (keyof typeof gameState.breakers)[]).forEach(key => {
      const ex = this.breakerExtras[key];
      const on = gameState.breakers[key];
      ex.led.setFillStyle(on ? COLOR.green : COLOR.red, 0.95);
      ex.track.setFillStyle(on ? 0x064e3b : 0x450a0a).setStrokeStyle(1, on ? 0x34d399 : 0xef4444, 0.9);
      ex.knob.setFillStyle(on ? COLOR.green : COLOR.red);
      ex.knob.x = ex.track.x + (on ? 15 : -15);
      const sw = this.breakerSwitches[key];
      if (sw) {
        sw.rect.setStrokeStyle(1, on ? 0x10b981 : 0xef4444);
        sw.stateTxt.setText(on ? 'ONLINE' : 'OFFLINE').setColor(on ? '#34d399' : '#ef4444');
      }
    });
    if (this.breakerLoadFill) {
      const { used, max } = gameState.getBreakerWattage();
      const ratio = max > 0 ? used / max : 1;
      this.breakerLoadFill.scaleX = Math.max(0.001, Math.min(1, ratio));
      this.breakerLoadFill.setFillStyle(ratio > 1 ? COLOR.red : ratio > 0.85 ? COLOR.amber : COLOR.green);
      this.breakerWattageText.setText(`NET BUS LOAD: ${used}W / ${max}W`);
      this.breakerWattageText.setColor(used > max ? '#ef4444' : '#34d399');
    }
  }

  // ───────────────────────────── Water-Shielded Storm Bunker ─────────────────────────────

  private createWaterShieldingVisualizer() {
    const { c: bunker } = this.makePanel(700, 608, 500, 360, 'WATER-SHIELDED STORM BUNKER');

    const desc = this.add.text(-234, -128, 'Stored habitat water tanks surround storm refuge,\nabsorbing secondary neutron and SPE cosmic rays.', {
      fontFamily: 'Rajdhani, sans-serif',
      fontSize: '13px',
      color: '#94a3b8',
      lineSpacing: 2
    }).setOrigin(0, 0.5);

    const refugeLbl = this.add
      .text(-100, 30, 'STORM\nREFUGE', {
        fontFamily: FONT_MONO,
        fontSize: '10px',
        color: '#cbd5e1',
        align: 'center',
      })
      .setOrigin(0.5);
    const wallLbl = this.add
      .text(-100, -78, 'WATER WALL', { fontFamily: FONT_MONO, fontSize: '10px', color: '#7dd3fc' })
      .setOrigin(0.5);

    // Reference box (right)
    const ref = this.add
      .text(
        42,
        -100,
        'WHY WATER?\nHydrogen-rich shielding makes fewer secondary neutrons than metal walls.\n\nMARS SURFACE REF\n≈ 0.7 mSv/day (Curiosity RAD)\n\nSPE ALERTS\nNASA DONKI space weather',
        {
          fontFamily: FONT_BODY,
          fontSize: '13px',
          color: '#cbd5e1',
          wordWrap: { width: 196 },
          lineSpacing: 2,
        }
      )
      .setOrigin(0, 0);

    this.bunkerGfx = this.add.graphics();

    const waterLevelRatio = gameState.resources.waterReserve / 100;
    const effShielding = Math.round(gameState.resources.shelterProtection * waterLevelRatio);
    this.shieldStats = this.add.text(0, 146, `EFFECTIVE HYDRO-SHIELDING: ${effShielding}%\nCUMULATIVE DOSE: ${gameState.hazards.radiationDoseMsv.toFixed(1)} mSv`, {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '12px',
      color: effShielding > 50 ? '#34d399' : '#ef4444',
      align: 'center'
    }).setOrigin(0.5);

    bunker.add([desc, this.bunkerGfx, refugeLbl, wallLbl, ref, this.shieldStats]);

    for (let i = 0; i < 26; i++) {
      this.spe.push({ k: Phaser.Math.FloatBetween(-1, 1), t: Math.random(), v: Phaser.Math.FloatBetween(0.22, 0.4) });
    }
  }

  private animateBunker(time: number, delta: number) {
    const g = this.bunkerGfx;
    if (!g) return;
    const ratio = Phaser.Math.Clamp(gameState.resources.waterReserve / 100, 0, 1);
    const eff = Phaser.Math.Clamp((gameState.resources.shelterProtection * ratio) / 100, 0, 1);
    g.clear();

    // Geometry (panel-local)
    const tx0 = -205, ty0 = -65, tw = 210, th = 170;
    const rx0 = -155, ry0 = -12, rw = 110, rh = 84;

    // Tank body
    g.fillStyle(0x0c1a30, 1).fillRoundedRect(tx0, ty0, tw, th, 8);

    // Water with a gentle surface wave
    const yTop = ty0 + th - ratio * th;
    if (ratio > 0.01) {
      g.fillStyle(0x0284c7, 0.55);
      g.beginPath();
      g.moveTo(tx0 + 2, ty0 + th - 2);
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const x = tx0 + 2 + ((tw - 4) * i) / steps;
        const y = yTop + Math.sin(time * 0.003 + i * 0.7) * 2;
        g.lineTo(x, y);
      }
      g.lineTo(tx0 + tw - 2, ty0 + th - 2);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, 0x7dd3fc, 0.9);
      g.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = tx0 + 2 + ((tw - 4) * i) / steps;
        const y = yTop + Math.sin(time * 0.003 + i * 0.7) * 2;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }

    // Refuge cabin (drawn over the water)
    g.fillStyle(0x1e293b, 1).fillRoundedRect(rx0, ry0, rw, rh, 6);
    g.lineStyle(2, 0x94a3b8, 0.9).strokeRoundedRect(rx0, ry0, rw, rh, 6);
    g.fillStyle(eff > 0.5 ? COLOR.green : COLOR.red, 0.1 + 0.05 * Math.sin(time * 0.004)).fillRoundedRect(rx0 + 3, ry0 + 3, rw - 6, rh - 6, 4);

    // Tank outline
    g.lineStyle(2.5, 0x38bdf8, 0.95).strokeRoundedRect(tx0, ty0, tw, th, 8);

    // SPE particles streaming in from the upper-left, thinned by the water wall
    const sx = -230, sy = -98, ex = -100, ey = 30;
    const dx = ex - sx, dy = ey - sy;
    const te = 0.26, tr = 0.67;
    for (const p of this.spe) {
      p.t += (p.v * delta) / 1000;
      if (p.t > 1) {
        p.t = 0;
        p.k = Phaser.Math.FloatBetween(-1, 1);
      }
      const ox = p.k * 30, oy = -p.k * 30;
      const x = sx + dx * p.t + ox;
      const y = sy + dy * p.t + oy;
      let a = 0.95;
      if (p.t > te) a *= 1 - eff * Math.min(1, (p.t - te) / (tr - te));
      if (p.t > tr) a *= 1 - eff;
      if (a < 0.03) continue;
      g.lineStyle(2, 0xfde68a, a * 0.5).lineBetween(x - dx * 0.04, y - dy * 0.04, x, y);
      g.fillStyle(0xfff3b0, a).fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }

  // ───────────────────────────── Astrobiology Cryo-Vault ─────────────────────────────

  private createCryoSampleVault() {
    const { c: vault } = this.makePanel(1220, 608, 500, 360, 'ASTROBIOLOGY CRYO-VAULT');

    this.cryoGfx = this.add.graphics();

    const tubeLbl = this.add.text(-130, -34, 'JEZERO\n#SY-09', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '9px',
      color: '#050a14',
      align: 'center'
    }).setOrigin(0.5);

    const ringLbl = this.add
      .text(110, -62, 'SAMPLE\nINTEGRITY', {
        fontFamily: FONT_MONO,
        fontSize: '9px',
        color: '#94a3b8',
        align: 'center',
      })
      .setOrigin(0.5);

    this.cryoStatusText = this.add.text(0, 82, `CRYO-STORAGE: -80°C NOMINAL [${Math.round(gameState.sciencePreservedPercent)}% INTEGRITY]`, {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '12px',
      color: '#34d399',
      align: 'center',
      wordWrap: { width: 460 }
    }).setOrigin(0.5);

    const ref = this.add
      .text(
        0,
        118,
        'NASA ref: Perseverance’s “Sapphire Canyon” core (Cheyava Falls, 2024) shows leopard-spot mineral patterns, a potential biosignature still under study.',
        {
          fontFamily: FONT_BODY,
          fontSize: '13px',
          color: '#fcd9a8',
          align: 'center',
          wordWrap: { width: 450 },
        }
      )
      .setOrigin(0.5);

    const tip = this.add.text(0, 156, 'Core Dilemma: Shutting off cryo-vault saves 20W power\nfor life-support, but degrades ancient biosignatures.', {
      fontFamily: 'Rajdhani, sans-serif',
      fontSize: '13px',
      color: '#f59e0b',
      align: 'center',
      wordWrap: { width: 460 }
    }).setOrigin(0.5);

    vault.add([this.cryoGfx, tubeLbl, ringLbl, this.cryoStatusText, ref, tip]);

    for (let i = 0; i < 16; i++) {
      this.frost.push({
        x: -130 + Phaser.Math.Between(-52, 52),
        y: -40 + Phaser.Math.Between(-78, 78),
        ph: Math.random() * Math.PI * 2,
      });
    }
  }

  private animateCryo(time: number) {
    const g = this.cryoGfx;
    if (!g) return;
    const powered = gameState.breakers.sampleCryo;
    const pct = Phaser.Math.Clamp(gameState.sciencePreservedPercent, 0, 100);
    g.clear();

    // Dewar housing
    g.fillStyle(0x0c1a30, 1).fillRoundedRect(-195, -125, 130, 182, 10);
    g.lineStyle(2.5, powered ? 0x38bdf8 : 0xf59e0b, 0.95).strokeRoundedRect(-195, -125, 130, 182, 10);
    g.lineStyle(1, 0x1e293b, 1);
    for (let y = -105; y < 50; y += 18) g.lineBetween(-190, y, -70, y);

    // Heat glow (unpowered) or cold glow (powered)
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.004);
    if (powered) {
      g.fillStyle(0x7dd3fc, 0.06 + 0.04 * pulse).fillRoundedRect(-190, -120, 120, 172, 8);
    } else {
      g.fillStyle(0xf59e0b, 0.1 + 0.12 * pulse).fillRoundedRect(-190, -120, 120, 172, 8);
    }

    // Titanium sample tube with gold band and cap (Perseverance-style)
    g.fillStyle(0x64748b, 1).fillRoundedRect(-142, -118, 24, 12, 3);
    g.fillStyle(0xd4af37, 0.9).fillRoundedRect(-153, -106, 46, 128, 6);
    g.lineStyle(3, 0xffffff, 0.9).strokeRoundedRect(-153, -106, 46, 128, 6);
    g.fillStyle(0xfff3b0, 0.35).fillRect(-148, -100, 6, 116);

    // Frost (powered) / drips (unpowered)
    if (powered) {
      for (const f of this.frost) {
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(time * 0.003 + f.ph));
        g.fillStyle(0xe0f2fe, a).fillRect(f.x, f.y, 2, 2);
      }
      for (let i = 0; i < 5; i++) {
        const my = -120 + ((time * 0.02 + i * 36) % 170);
        g.fillStyle(0xbae6fd, 0.1).fillEllipse(-130 + Math.sin(time * 0.001 + i) * 20, my, 40, 10);
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const dy = -70 + ((time * 0.05 + i * 40) % 130);
        g.fillStyle(0xfbbf24, 0.8).fillCircle(-150 + i * 14 + 6, dy, 2.5);
      }
    }

    // Thermometer
    g.fillStyle(0x0f172a, 1).fillRoundedRect(-52, -110, 14, 150, 5);
    g.lineStyle(1.5, 0x475569, 1).strokeRoundedRect(-52, -110, 14, 150, 5);
    const merc = powered ? 0.08 : 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(time * 0.0015));
    g.fillStyle(powered ? 0x38bdf8 : 0xef4444, 0.95).fillRoundedRect(-50, 38 - merc * 144, 10, merc * 144, 3);
    g.lineStyle(1, 0x64748b, 0.8);
    for (let i = 0; i <= 4; i++) g.lineBetween(-34, -108 + i * 36, -28, -108 + i * 36);

    // Integrity ring
    const cx = 110, cy = -28, r = 54;
    g.lineStyle(10, 0x1e293b, 1);
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2, false);
    g.strokePath();
    const col = pct > 75 ? COLOR.green : pct > 40 ? COLOR.amber : COLOR.red;
    g.lineStyle(10, col, 1);
    g.beginPath();
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * Math.PI * 2, false);
    g.strokePath();
    g.lineStyle(1, col, 0.35).strokeCircle(cx, cy, r - 12);
  }

  // ───────────────────────────── Structural Systems ─────────────────────────────

  private createStructuralSystems() {
    const PW = 380;
    const PH = 270;
    const { c: panel } = this.makePanel(1690, 247, PW, PH, 'OUTPOST STRUCTURE STATUS');

    const components: { key: keyof typeof gameState.shelterUpgrades; label: string; y: number }[] = [
      { key: 'dome', label: 'DOME PRESSURE SHELL', y: -62 },
      { key: 'rimshade', label: 'RIMSHADE THERMAL BAFFLE', y: -18 },
      { key: 'cap', label: 'HABITAT CAP SEAL', y: 26 },
      { key: 'radiationUmbrella', label: 'RADIATION UMBRELLA', y: 70 }
    ];
    components.forEach(component => {
      const state = gameState.shelterUpgrades[component.key];
      const row = this.add.rectangle(0, component.y, PW - 32, 38, state ? 0x064e3b : 0x1e293b, 0.9)
        .setStrokeStyle(1, state ? 0x34d399 : 0x475569)
        .setInteractive({ useHandCursor: true });
      const glyph = this.add.graphics({ x: -PW / 2 + 38, y: component.y });
      this.drawStructGlyph(glyph, component.key as string, state ? COLOR.green : COLOR.steel);
      const text = this.add.text(-PW / 2 + 64, component.y, `${component.label} // ${state ? 'ONLINE' : 'COMMISSION'}`, {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: '11px',
        color: state ? '#34d399' : '#cbd5e1'
      }).setOrigin(0, 0.5);
      row.on('pointerover', () => {
        if (!gameState.shelterUpgrades[component.key]) row.setFillStyle(0x273449, 0.95);
      });
      row.on('pointerout', () => {
        row.setFillStyle(gameState.shelterUpgrades[component.key] ? 0x064e3b : 0x1e293b, 0.9);
      });
      row.on('pointerdown', () => {
        gameState.shelterUpgrades[component.key] = true;
        gameState.resources.shelterProtection = Math.min(100, gameState.resources.shelterProtection + 5);
        gameState.save();
        row.setFillStyle(0x064e3b, 0.9);
        row.setStrokeStyle(1, 0x34d399);
        text.setText(`${component.label} // ONLINE`);
        text.setColor('#34d399');
        this.drawStructGlyph(glyph, component.key as string, COLOR.green);
      });
      panel.add([row, glyph, text]);
    });

    // Protection footer (live)
    const lbl = this.add
      .text(-PW / 2 + 16, PH / 2 - 26, 'SHELTER PROTECTION', { fontFamily: FONT_MONO, fontSize: '10px', color: '#94a3b8' })
      .setOrigin(0, 0.5);
    const track = this.add.rectangle(30, PH / 2 - 26, 150, 8, 0x1e293b).setOrigin(0, 0.5);
    this.structBarFill = this.add.rectangle(30, PH / 2 - 26, 150, 8, COLOR.green).setOrigin(0, 0.5);
    this.structBarTxt = this.add
      .text(PW / 2 - 16, PH / 2 - 26, '0%', { fontFamily: FONT_MONO, fontSize: '11px', color: '#cbd5e1' })
      .setOrigin(1, 0.5);
    panel.add([lbl, track, this.structBarFill, this.structBarTxt]);
  }

  private drawStructGlyph(g: Gfx, key: string, color: number) {
    g.clear();
    g.lineStyle(2, color, 1);
    switch (key) {
      case 'dome':
        g.beginPath();
        g.arc(0, 6, 11, Math.PI, 0, false);
        g.strokePath();
        g.lineBetween(-11, 6, 11, 6);
        g.lineBetween(-6, 6, -6, 10).lineBetween(6, 6, 6, 10);
        break;
      case 'rimshade':
        for (let i = 0; i < 4; i++) g.lineBetween(-10, -8 + i * 6, 10, -4 + i * 6);
        break;
      case 'cap':
        g.strokeCircle(0, 0, 10);
        g.strokeCircle(0, 0, 4);
        break;
      case 'radiationUmbrella':
        g.beginPath();
        g.arc(0, 3, 11, Math.PI, 0, false);
        g.strokePath();
        g.lineBetween(0, 3, 0, 12);
        g.lineStyle(1.5, color, 0.8)
          .lineBetween(-12, -12, -6, -6)
          .lineBetween(0, -14, 0, -8)
          .lineBetween(12, -12, 6, -6);
        break;
      default:
        g.strokeCircle(0, 0, 8);
    }
  }

  // ───────────────────────────── Shelter Stations ─────────────────────────────

  private createShelterStations() {
    const PW = 380;
    const PH = 222;
    const { c: panel } = this.makePanel(1690, 518, PW, PH, 'SHELTER SERVICE STATIONS');

    const addStation = (label: string, y: number, action: () => void, readout: () => string) => {
      const station = this.add.rectangle(0, y, PW - 32, 46, 0x0f172a, 0.95)
        .setStrokeStyle(1, 0x38bdf8)
        .setInteractive({ useHandCursor: true });
      const text = this.add.text(-PW / 2 + 28, y, label, {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: '11px',
        color: '#cbd5e1'
      }).setOrigin(0, 0.5);
      const ro = this.add
        .text(PW / 2 - 28, y, readout(), { fontFamily: FONT_MONO, fontSize: '10px', color: '#7dd3fc' })
        .setOrigin(1, 0.5);
      this.stationReadouts.push({ txt: ro, get: readout });
      station.on('pointerover', () => station.setFillStyle(0x16233b, 0.98));
      station.on('pointerout', () => station.setFillStyle(0x0f172a, 0.95));
      station.on('pointerdown', action);
      panel.add([station, text, ro]);
    };

    addStation('RECHARGE SUIT // O2 + POWER', -38, () => {
      gameState.suitO2 = 100;
      gameState.suitBattery = 100;
      gameState.resources.power = Math.max(0, gameState.resources.power - 3);
      gameState.addLog('SHELTER STATION: EVA suit O2 and battery recharged.', 'system');
      gameState.notifyChange('suit_recharged');
    }, () => `O2 ${Math.round(gameState.suitO2)}%  BAT ${Math.round(gameState.suitBattery)}%`);
    addStation('ANALYZE JEZERO CORE SAMPLES', 18, () => {
      gameState.addLog(`CORE LAB: ${gameState.regolithSamples} Jezero regolith samples available for analysis.`, 'science');
      gameState.notifyChange('core_analysis');
    }, () => `${gameState.regolithSamples} SAMPLES`);
    addStation('REVIEW SHELTER TELEMETRY', 74, () => {
      gameState.addLog(`SHELTER TELEMETRY: ${Math.round(gameState.resources.shelterProtection)}% protection, ${Math.round(gameState.resources.waterReserve)}% water reserve.`, 'system');
      gameState.notifyChange('shelter_review');
    }, () => `${Math.round(gameState.resources.shelterProtection)}% PROT`);
  }

  // ───────────────────────────── Vitals Panel (new, read-only) ─────────────────────────────

  private createVitalsPanel() {
    const PW = 380;
    const PH = 290;
    const { c: panel } = this.makePanel(230, 773, PW, PH, 'HABITAT VITALS');

    const defs: Array<[string, () => number]> = [
      ['POWER', () => gameState.resources.power],
      ['AIR', () => gameState.resources.airReserve],
      ['THERMAL', () => gameState.resources.thermalStability],
      ['WATER', () => gameState.resources.waterReserve],
      ['SHELTER', () => gameState.resources.shelterProtection],
    ];
    defs.forEach(([label, get], i) => {
      const y = -82 + i * 32;
      const lbl = this.add
        .text(-PW / 2 + 16, y, label, { fontFamily: FONT_MONO, fontSize: '11px', color: '#cbd5e1' })
        .setOrigin(0, 0.5);
      const track = this.add.rectangle(-86, y, 190, 10, 0x1e293b).setOrigin(0, 0.5).setStrokeStyle(1, 0x334155, 0.8);
      const fill = this.add.rectangle(-86, y, 190, 10, COLOR.green).setOrigin(0, 0.5);
      fill.scaleX = 0.001;
      const val = this.add
        .text(PW / 2 - 16, y, '0%', { fontFamily: FONT_MONO, fontSize: '11px', color: '#cbd5e1' })
        .setOrigin(1, 0.5);
      panel.add([lbl, track, fill, val]);
      this.vitalRows.push({ get, fill, val });
    });

    const divider = this.add.rectangle(0, 78, PW - 32, 1, COLOR.cyan, 0.25);
    this.vitalCo2 = this.add
      .text(-PW / 2 + 16, 98, '', { fontFamily: FONT_MONO, fontSize: '12px', color: '#cbd5e1' })
      .setOrigin(0, 0.5);
    this.vitalDose = this.add
      .text(-PW / 2 + 16, 120, '', { fontFamily: FONT_MONO, fontSize: '12px', color: '#cbd5e1' })
      .setOrigin(0, 0.5);
    const ref = this.add
      .text(-PW / 2 + 16, 134, 'MARS SURFACE REF ≈ 0.7 mSv/DAY (CURIOSITY RAD)', {
        fontFamily: FONT_MONO,
        fontSize: '9px',
        color: '#64748b',
      })
      .setOrigin(0, 0.5);
    panel.add([divider, this.vitalCo2, this.vitalDose, ref]);
  }

  // ───────────────────────────── Conjunction Diagram (new) ─────────────────────────────

  private createConjunctionPanel() {
    const PW = 380;
    const PH = 264;
    const { c: panel } = this.makePanel(1690, 786, PW, PH, 'SUN – EARTH – MARS GEOMETRY', COLOR.red);

    this.conjGfx = this.add.graphics();
    this.earthLbl = this.add
      .text(-135, -50, 'EARTH', { fontFamily: FONT_MONO, fontSize: '10px', color: '#93c5fd' })
      .setOrigin(0.5);
    this.marsLbl = this.add
      .text(135, -50, 'MARS', { fontFamily: FONT_MONO, fontSize: '10px', color: '#fdba74' })
      .setOrigin(0.5);
    const sunLbl = this.add
      .text(0, 12, 'SUN', { fontFamily: FONT_MONO, fontSize: '10px', color: '#fde68a' })
      .setOrigin(0.5);

    this.sepTxt = this.add
      .text(-PW / 2 + 16, 52, '', { fontFamily: FONT_MONO, fontSize: '12px', color: '#cbd5e1' })
      .setOrigin(0, 0.5);
    this.linkTxt = this.add
      .text(-PW / 2 + 16, 74, '', { fontFamily: FONT_MONO, fontSize: '12px', color: hex(COLOR.red) })
      .setOrigin(0, 0.5);
    this.scintTxt = this.add
      .text(-PW / 2 + 16, 96, '', { fontFamily: FONT_MONO, fontSize: '11px', color: '#94a3b8' })
      .setOrigin(0, 0.5);
    const foot = this.add
      .text(-PW / 2 + 16, PH / 2 - 16, 'NASA PRACTICE: NO COMMANDS WHEN SEP < ~2°', {
        fontFamily: FONT_MONO,
        fontSize: '10px',
        color: '#64748b',
      })
      .setOrigin(0, 0.5);

    panel.add([this.conjGfx, this.earthLbl, this.marsLbl, sunLbl, this.sepTxt, this.linkTxt, this.scintTxt, foot]);
  }

  private animateConjunction(time: number) {
    const g = this.conjGfx;
    if (!g) return;
    const day = gameState.conjunctionDay;
    const sep = sepAt(day);
    const blackout = day > 1 && day < 14;
    const off = ((day - 7.5) / 6.5) * 30;
    const sy = -22; // sun y
    const ey = sy + off;
    const exX = -135;
    const mxX = 135;
    g.clear();

    // Ecliptic reference
    g.lineStyle(1, 0x334155, 0.6).lineBetween(-165, sy, 165, sy);

    // Corona streamers + glow
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.003);
    g.fillStyle(0xfde68a, 0.06 + 0.03 * pulse).fillCircle(0, sy, 40);
    g.fillStyle(0xfde68a, 0.12).fillCircle(0, sy, 28);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + time * 0.0003;
      const len = 26 + 12 * Math.sin(time * 0.004 + i * 1.7);
      g.lineStyle(1.5, 0xfde68a, 0.35).lineBetween(
        Math.cos(a) * 15, sy + Math.sin(a) * 15, Math.cos(a) * len, sy + Math.sin(a) * len
      );
    }
    g.fillStyle(0xfff7d6, 1).fillCircle(0, sy, 13);

    // Radio link (dashed)
    const linkCol = blackout ? COLOR.red : day >= 14 ? COLOR.green : COLOR.amber;
    for (let x = exX + 12; x < mxX - 12; x += 14) {
      const noisy = blackout && Math.abs(x) < 44 ? Math.sin(time * 0.02 + x) * 5 : 0;
      g.lineStyle(2, linkCol, blackout && Math.abs(x) < 44 ? 0.35 : 0.85).lineBetween(x, ey + noisy, x + 8, ey + noisy);
    }

    // DSN packets Earth -> Mars (vanish inside the corona during blackout)
    for (let i = 0; i < 4; i++) {
      const s = ((time * 0.0003 + i * 0.25) % 1);
      const px = Phaser.Math.Linear(exX, mxX, s);
      let a = 0.95;
      if (blackout && px > -40) a = 0;
      if (a > 0) g.fillStyle(linkCol, a).fillRect(px - 2, ey - 2, 4, 4);
    }
    if (blackout) {
      // Dead-air marker where the signal dies
      g.lineStyle(2, COLOR.red, 0.8).lineBetween(-42, ey - 8, -42, ey + 8);
      g.lineBetween(-46, ey - 4, -38, ey + 4).lineBetween(-46, ey + 4, -38, ey - 4);
    }

    // Earth + Mars
    g.fillStyle(0x3b82f6, 1).fillCircle(exX, ey, 10);
    g.fillStyle(0x34d399, 0.8).fillCircle(exX - 3, ey - 2, 4);
    g.lineStyle(1.5, 0x93c5fd, 0.8).strokeCircle(exX, ey, 10);
    g.fillStyle(0xc2410c, 1).fillCircle(mxX, ey, 8);
    g.fillStyle(0x7c2d12, 0.7).fillCircle(mxX + 2, ey + 2, 3);
    g.lineStyle(1.5, 0xfdba74, 0.8).strokeCircle(mxX, ey, 8);
    this.earthLbl?.setPosition(exX, ey - 20);
    this.marsLbl?.setPosition(mxX, ey - 20);

    // Readouts
    this.sepTxt?.setText(`SEP ANGLE: ${sep.toFixed(1)}°   (BLACKOUT < 2.0°)`);
    const state = day >= 14 ? 'REACQUIRING' : day <= 1 ? 'FADING' : 'BLACKOUT';
    this.linkTxt?.setText(`DSN LINK: ${state}`);
    this.linkTxt?.setColor(hex(linkCol));
    const scint = blackout ? (sep < 0.8 ? 'SEVERE' : 'HIGH') : 'MODERATE';
    this.scintTxt?.setText(`CORONAL SCINTILLATION: ${scint}`);
  }

  // ───────────────────────────── Conjunction Timeline (new) ─────────────────────────────

  private createConjunctionTimeline() {
    const PW = 1020;
    const PH = 108;
    const { c: panel } = this.makePanel(960, 858, PW, PH, 'CONJUNCTION TIMELINE // 14 SOLS', COLOR.red);

    this.tlGfx = this.add.graphics();
    panel.add(this.tlGfx);

    const x0 = -450;
    const dxStep = 900 / 13;
    const nodeY = -4;
    for (let d = 1; d <= 14; d++) {
      const x = x0 + (d - 1) * dxStep;
      const lbl = this.add
        .text(x, nodeY + 22, `D${d}`, { fontFamily: FONT_MONO, fontSize: '10px', color: '#94a3b8' })
        .setOrigin(0.5);
      const hit = this.add.circle(x, nodeY, 14, 0xffffff, 0).setInteractive({ useHandCursor: false });
      hit.on('pointerover', () => {
        const ev = this.conjunctionData.find(e => e.day === d);
        const t = ev ? `D${d}: ${ev.title.toUpperCase()}` : `D${d}: NO SCHEDULED EVENT`;
        this.tlTip?.setText(t).setPosition(960 + x, 858 + nodeY - 38).setVisible(true);
      });
      hit.on('pointerout', () => this.tlTip?.setVisible(false));
      panel.add([lbl, hit]);
    }

    this.tlDetail = this.add
      .text(0, PH / 2 - 16, '', { fontFamily: FONT_BODY, fontSize: '14px', color: '#e2e8f0' })
      .setOrigin(0.5);
    panel.add(this.tlDetail);

    this.tlTip = this.add
      .text(0, 0, '', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#f8fafc',
        backgroundColor: 'rgba(3,7,18,0.95)',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setVisible(false);
  }

  private drawTimeline() {
    const g = this.tlGfx;
    if (!g) return;
    const day = gameState.conjunctionDay;
    const x0 = -450;
    const dxStep = 900 / 13;
    const nodeY = -4;
    const eventDays = new Set(this.conjunctionData.map(e => e.day));

    g.clear();
    g.lineStyle(3, 0x1e293b, 1).lineBetween(x0, nodeY, x0 + 900, nodeY);
    g.lineStyle(3, COLOR.cyan, 0.9).lineBetween(x0, nodeY, x0 + (Math.min(day, 14) - 1) * dxStep, nodeY);

    // Blackout window shading (days 2-13)
    g.fillStyle(COLOR.red, 0.07).fillRect(x0 + dxStep, nodeY - 20, dxStep * 11, 40);

    for (let d = 1; d <= 14; d++) {
      const x = x0 + (d - 1) * dxStep;
      const past = d < day;
      const cur = d === day;
      const col = cur ? COLOR.amber : past ? COLOR.cyan : 0x334155;
      if (eventDays.has(d)) {
        g.fillStyle(d === 6 ? COLOR.red : COLOR.steel, 0.9);
        g.fillTriangle(x - 4, nodeY - 16, x + 4, nodeY - 16, x, nodeY - 10);
      }
      if (cur) g.fillStyle(COLOR.amber, 0.2).fillCircle(x, nodeY, 13);
      g.fillStyle(col, 1).fillCircle(x, nodeY, cur ? 8 : 6);
      g.lineStyle(2, d === 14 ? COLOR.green : 0x0f172a, 1).strokeCircle(x, nodeY, cur ? 8 : 6);
    }
  }

  // ───────────────────────────── Day Progression HUD ─────────────────────────────

  private createDayProgressionHUD() {
    const hud = this.add.container(960, 968);
    const bg = this.add.rectangle(0, 0, 1000, 64, 0x030712, 0.95)
      .setStrokeStyle(2, 0x38bdf8);
    const br = this.add.graphics();
    drawBrackets(br, 0, 0, 1008, 72, 14, COLOR.cyan, 0.9);

    this.dayIndicatorText = this.add.text(-470, -12, `SOLAR CONJUNCTION: DAY ${gameState.conjunctionDay} / 14`, {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '15px',
      color: '#38bdf8'
    }).setOrigin(0, 0.5);

    this.daySegGfx = this.add.graphics();

    const advBtn = this.add.rectangle(350, 0, 260, 42, 0x0284c7)
      .setStrokeStyle(1, 0xffffff)
      .setInteractive({ useHandCursor: true });

    this.advTxt = this.add.text(350, 0, 'ADVANCE TO NEXT SOL', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '12px',
      color: '#ffffff'
    }).setOrigin(0.5);

    advBtn.on('pointerover', () => advBtn.setFillStyle(0x0ea5e9));
    advBtn.on('pointerout', () => advBtn.setFillStyle(0x0284c7));
    advBtn.on('pointerdown', () => {
      this.advanceConjunctionSol();
    });

    hud.add([bg, br, this.dayIndicatorText, this.daySegGfx, advBtn, this.advTxt]);
  }

  private advanceConjunctionSol() {
    soundFx.playTelemetryChirp();

    if (gameState.conjunctionDay < 14) {
      gameState.conjunctionDay++;
      this.dayIndicatorText.setText(`SOLAR CONJUNCTION: DAY ${gameState.conjunctionDay} / 14`);
      gameState.addLog(`SOLAR CONJUNCTION: Sol ${gameState.conjunctionDay} commenced.`, 'system');
      gameState.save();
      this.promptCurrentDayEvent();
    } else {
      // Day 14 Signal Recovery!
      soundFx.playTelemetryChirp();
      gameState.dsnLocked = true;
      gameState.currentChapter = 'ending';
      gameState.save();
      transitionToScene(this, 'EndingScene');
    }
  }

  private promptCurrentDayEvent() {
    const dayEvent = this.conjunctionData.find(d => d.day === gameState.conjunctionDay);
    if (!dayEvent) return;

    new DecisionModal(this, {
      title: `DAY ${dayEvent.day}: ${dayEvent.title.toUpperCase()}`,
      summary: `${dayEvent.summary}\n\n[EVENT]: ${dayEvent.event}`,
      hazardLevel: dayEvent.day === 6 ? 'CRITICAL' : 'ELEVATED',
      choices: dayEvent.choices.map(c => ({
        text: c.text,
        detail: c.detail,
        powerDelta: c.powerDelta,
        o2Cost: c.o2Cost,
        radiationDose: c.radiationDose,
        thermalDelta: c.thermalDelta,
        onSelect: () => {
          this.applyChoiceEffects(c);
        }
      }))
    });
  }

  private applyChoiceEffects(choice: ConjunctionChoice) {
    if (choice.powerDelta) {
      gameState.resources.power = Math.max(0, Math.min(100, gameState.resources.power + choice.powerDelta));
    }
    if (choice.co2Delta) {
      gameState.hazards.co2Ppm = Math.max(400, gameState.hazards.co2Ppm + choice.co2Delta);
    }
    if (choice.radiationDose) {
      gameState.hazards.radiationDoseMsv += choice.radiationDose;
    }
    if (choice.thermalDelta) {
      gameState.resources.thermalStability = Math.max(0, Math.min(100, gameState.resources.thermalStability + choice.thermalDelta));
    }
    if (choice.waterDelta) {
      gameState.resources.waterReserve = Math.max(0, Math.min(100, gameState.resources.waterReserve + choice.waterDelta));
    }
    if (choice.evaRequired) {
      soundFx.playAirlockHiss();
      gameState.addLog(`EVA EXECUTED: Performed exterior mission in dust storm.`, 'warning');
    }
    if (choice.endingTrigger) {
      transitionToScene(this, 'EndingScene');
    }
    this.updateBreakersUI();
  }

  // ───────────────────────────── Live UI sync & animation (read-only) ─────────────────────────────

  update(time: number, delta: number) {
    const day = gameState.conjunctionDay;
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.onDayChanged();
    }

    const r = gameState.resources;
    const sig = [
      Math.round(r.power), Math.round(r.airReserve), Math.round(r.thermalStability),
      Math.round(r.waterReserve), Math.round(r.shelterProtection),
      Math.round(gameState.hazards.co2Ppm), gameState.hazards.radiationDoseMsv.toFixed(1),
      Math.round(gameState.suitO2), Math.round(gameState.suitBattery), gameState.regolithSamples,
      Math.round(gameState.sciencePreservedPercent),
      Object.values(gameState.breakers).map(b => (b ? 1 : 0)).join(''),
      Object.values(gameState.shelterUpgrades).map(b => (b ? 1 : 0)).join(''),
    ].join('|');
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.refreshLiveReadouts();
    }

    this.animateViewport(time, delta);
    this.animateBunker(time, delta);
    this.animateCryo(time);
    this.animateConjunction(time);
  }

  private onDayChanged() {
    const day = gameState.conjunctionDay;
    this.storm = stormAt(day);
    this.drawViewportSky();
    this.drawViewportHaze();
    this.vpVeil?.setFillStyle(mix(JZ.storm, JZ.stormDeep, this.storm * 0.5), 0.05 + this.storm * 0.4);

    const tau = (0.8 + this.storm * 4.4).toFixed(1);
    const wind = Math.round(5 + this.storm * 24);
    const vis = Math.max(0.3, 18 * Math.exp(-(0.8 + this.storm * 4.4) * 0.5)).toFixed(1);
    this.vpReadout?.setText(`DUST TAU ${tau} (SIM)\nWIND ${wind} m/s (SIM)\nVISIBILITY ~${vis} km`);
    const phase = day < 4 ? 'BUILDING' : day <= 8 ? 'PEAK' : day <= 12 ? 'DECAYING' : 'CLEARING';
    this.vpPhase?.setText(`STORM PHASE: ${phase}`);

    // Header link chip
    const blackout = day > 1 && day < 14;
    const label = day >= 14 ? 'REACQUIRING' : day <= 1 ? 'FADING' : 'BLACKOUT';
    const col = blackout ? COLOR.red : day >= 14 ? COLOR.green : COLOR.amber;
    this.linkChipTxt?.setText(`LINK: ${label}`).setColor(hex(col));
    this.linkChipBg?.setFillStyle(col, 0.14).setStrokeStyle(1, col, 0.8);

    // Timeline + detail
    this.drawTimeline();
    const ev = this.conjunctionData.find(e => e.day === day);
    this.tlDetail?.setText(ev ? `SOL ${day}: ${ev.title}` : `SOL ${day}: NO SCHEDULED EVENT`);

    // Day HUD
    this.advTxt?.setText(day >= 14 ? 'RESTORE DSN LINK ➔' : 'ADVANCE TO NEXT SOL');
    const sg = this.daySegGfx;
    if (sg) {
      sg.clear();
      for (let i = 1; i <= 14; i++) {
        const x = -470 + (i - 1) * 28;
        const col2 = i < day ? COLOR.cyan : i === day ? COLOR.amber : 0x1e293b;
        sg.fillStyle(col2, i <= day ? 0.95 : 0.9).fillRect(x, 12, 24, 7);
        if (i === 6) sg.lineStyle(1, COLOR.red, 0.9).strokeRect(x - 1, 11, 26, 9);
      }
    }
  }

  private refreshLiveReadouts() {
    this.refreshBreakerVisuals();

    // Vitals
    for (const row of this.vitalRows) {
      const v = Phaser.Math.Clamp(row.get(), 0, 100);
      row.fill.scaleX = Math.max(0.001, v / 100);
      row.fill.setFillStyle(statusColor(v));
      row.val.setText(`${Math.round(v)}%`);
    }
    const co2 = gameState.hazards.co2Ppm;
    this.vitalCo2?.setText(`CO2: ${Math.round(co2)} ppm`);
    this.vitalCo2?.setColor(co2 < 1000 ? '#34d399' : co2 < 4000 ? '#f59e0b' : '#ef4444');
    this.vitalDose?.setText(`RADIATION DOSE: ${gameState.hazards.radiationDoseMsv.toFixed(1)} mSv`);

    // Structure footer
    const prot = Phaser.Math.Clamp(gameState.resources.shelterProtection, 0, 100);
    if (this.structBarFill) {
      this.structBarFill.scaleX = Math.max(0.001, prot / 100);
      this.structBarFill.setFillStyle(statusColor(prot));
    }
    this.structBarTxt?.setText(`${Math.round(prot)}%`);

    // Stations
    for (const s of this.stationReadouts) s.txt.setText(s.get());

    // Bunker stats (same format as the original)
    const ratio = gameState.resources.waterReserve / 100;
    const effShielding = Math.round(gameState.resources.shelterProtection * ratio);
    this.shieldStats?.setText(
      `EFFECTIVE HYDRO-SHIELDING: ${effShielding}%\nCUMULATIVE DOSE: ${gameState.hazards.radiationDoseMsv.toFixed(1)} mSv`
    );
    this.shieldStats?.setColor(effShielding > 50 ? '#34d399' : '#ef4444');

    // Cryo status text (same format as updateBreakersUI)
    if (this.cryoStatusText) {
      if (!gameState.breakers.sampleCryo) {
        this.cryoStatusText.setText('CRYO-STORAGE: UNPOWERED [SAMPLES THAWING]');
        this.cryoStatusText.setColor('#ef4444');
      } else {
        this.cryoStatusText.setText(`CRYO-STORAGE: -80°C NOMINAL [${Math.round(gameState.sciencePreservedPercent)}% INTEGRITY]`);
        this.cryoStatusText.setColor('#34d399');
      }
    }
  }

  private animateViewport(time: number, delta: number) {
    const dust = this.vpDust;
    if (!dust) return;
    const dt = delta / 1000;
    const s = this.storm;

    // Pointer parallax inside the glass
    const ptr = this.input.activePointer;
    const norm = ((ptr.x || 960) - 960) / 960;
    this.vpOff = Phaser.Math.Linear(this.vpOff, norm, 0.08);
    if (this.vpRim) this.vpRim.x = snap(-this.vpOff * 3, 1);
    if (this.vpDelta) this.vpDelta.x = snap(-this.vpOff * 7, 1);
    if (this.vpGround) this.vpGround.x = snap(-this.vpOff * 12, 1);
    for (const l of this.vpLabels) l.obj.x = snap(l.baseX - this.vpOff * l.factor, 1);

    // Gusting wind
    const gust = 0.78 + 0.22 * Math.sin(time * 0.0004) + 0.18 * Math.sin(time * 0.0013 + 1.7);
    const wind = (60 + s * 340) * gust;
    const active = Math.floor(40 + s * 80);

    dust.clear();
    // Slow dust curtains in the storm
    for (let i = 0; i < 3; i++) {
      const cx = WIN.x + ((time * (0.02 + i * 0.01) + i * 380) % (WIN.w + 400)) - 200;
      dust.fillStyle(JZ.dust, 0.05 * s).fillEllipse(cx, WIN.y + 90 + i * 60, 420, 120);
    }
    for (let i = 0; i < active && i < this.vpParticles.length; i++) {
      const p = this.vpParticles[i];
      p.x += wind * (0.3 + p.z) * dt;
      p.y += Math.sin(time * 0.002 + p.ph) * 8 * dt;
      if (p.x > WIN.x + WIN.w + 30) p.x = WIN.x - 30;
      const streak = p.s * (1.5 + gust * s * 6 * (0.4 + p.z));
      dust.fillStyle(JZ.dust, p.a * (0.55 + 0.45 * gust)).fillRect(
        snap(p.x, 2), snap(p.y, 2), Math.max(2, snap(streak, 2)), p.s > 3 ? 4 : 2
      );
    }
  }
}