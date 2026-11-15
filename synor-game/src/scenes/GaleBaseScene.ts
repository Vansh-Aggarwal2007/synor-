/**
 * Gale Crater Base Scene (Act I Prologue & Act III Return)
 * - Unstuck Modal Architecture (works with Mouse Click, ENTER, SPACE, and ESC)
 * - Full WASD / Arrow Key movement + Click-to-Walk + [E / SPACE] Interact + [M] Orbital Map
 * - 16-Bit Stepped Martian Parallax + Isometric Outpost Modules & Ares Rocket Lander
 * - Live NASA DONKI Space Weather, Mars Trek MOLA/SHARAD, and NASA OSDR Bio-Archive
 *
 * UI REVISION (core logic untouched):
 * - Curiosity-referenced Gale terrain: layered Aeolis Mons strata, Bagnold dark dunes,
 *   Yellowknife Bay mudstone + veins, Peace Vallis alluvial fan, JPL morse wheel tracks
 * - Butterscotch Mastcam sky with blue sun halo, atmospheric horizon haze
 * - Flowing wind-driven dust + dust devil, intensity derived from telemetry
 *   (solar irradiance loss + DONKI radiation multiplier)
 * - DONKI flare-class alert frame, commissioning checklist, site mini-map, keycap control bar
 */

import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import { resourceEngine } from '../state/ResourceEngine';
import { MARS_SITES } from '../utils/MarsGeo';
import { attachBlenderSceneSlot } from '../utils/BlenderSceneBridge';
import { soundFx } from '../utils/ProceduralAudio';
import { uiSfx } from '../utils/UISoundFX';
import { attachUIInteraction } from '../utils/UIInteraction';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Theme
// ─────────────────────────────────────────────────────────────────────────────

const W = 1920;
const H = 1080;
const HORIZON_Y = 340;
const PX = 4;
const WALK = { minX: 110, maxX: 1810, minY: 390, maxY: 920 };
const WALK_SPEED = 260;
const INTERACT_RADIUS = 155;

const FONT_HEAD = 'Orbitron, sans-serif';
const FONT_MONO = 'Share Tech Mono, monospace';
const FONT_BODY = 'Rajdhani, sans-serif';

const COLOR = {
  panel: 0x060d1a,
  panelInner: 0x0a1628,
  ink: 0x040811,
  cyan: 0x38bdf8,
  cyanDeep: 0x0284c7,
  green: 0x34d399,
  greenDeep: 0x10b981,
  amber: 0xf59e0b,
  red: 0xef4444,
  slate: 0x475569,
  steel: 0x94a3b8,
};

/** Curiosity Mastcam-inspired Gale palette (butterscotch sky, ochre regolith, dark basaltic dunes) */
const PAL = {
  skyTop: 0x4a2819,
  skyMid: 0xa9683f,
  skyHorizon: 0xe8bb85,
  sunHalo: 0x8fc3de,
  sunCore: 0xfffbeb,
  haze: 0xe3b27a,
  dust: 0xdca86c,
  dustVeil: 0xc98a52,
  devil: 0xd9a572,
  groundFar: 0xa9622f,
  groundNear: 0x3a170b,
  bedrock: 0x6e5f60,
  bedrockHi: 0x8f7c76,
  vein: 0xe9e1d3,
  duneDark: 0x1f222c,
  duneMid: 0x333746,
  duneHi: 0x5b6174,
  regolith: 0x7a3a1c,
  // Mount Sharp strata (orange, tan, grey-brown, red, pale sulfate)
  strata: [0xb8783f, 0xa5603a, 0xc79a68, 0x8d5a3c, 0x7d6a5e, 0xb07a4a, 0xd0a878],
};

const DEPTH = {
  sky: 10,
  stars: 11,
  sun: 12,
  craterRimFar: 13,
  mountSharp: 14,
  mesaMid: 15,
  ridgeNear: 16,
  haze: 17,
  ground: 18,
  groundHaze: 18.5,
  craters: 19,
  groundDetail: 19.5,
  devil: 20,
  conduits: 21,
  dust: 1100,
  dustVeil: 1090,
  markers: 1200,
  alert: 1995,
  hud: 2000,
  dialogShade: 5000,
  dialogPanel: 5010,
  dialogButtons: 5020,
  toast: 6000,
};

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const snap = (v: number, step = PX) => Math.round(v / step) * step;

const mix = (a: number, b: number, t: number): number => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
};

type Pt = { x: number; y: number };
type Gfx = Phaser.GameObjects.Graphics;

interface ParallaxLayer {
  target: Phaser.GameObjects.GameObject & { x: number; y: number };
  baseX: number;
  baseY: number;
  factorX: number;
  factorY: number;
}

interface OutpostModule {
  id: string;
  category: string;
  name: string;
  short: string;
  locale: string;
  curiosityRef: string;
  x: number;
  y: number;
  markerDy: number;
  desc: string;
  effect: string;
  osdrId: string;
  osdrKeyword: string;
  osdrNote: string;
  draw: (g: Gfx) => void;
  onCommission: () => void;
}

interface ModuleView {
  marker: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Arc;
  pulseRing: Phaser.GameObjects.Arc;
  iconTxt: Phaser.GameObjects.Text;
  labelTxt: Phaser.GameObjects.Text;
  promptRing: Phaser.GameObjects.Arc;
  glow: Phaser.GameObjects.Ellipse;
  pointer: Phaser.GameObjects.Triangle;
}

interface DustP {
  x: number;
  y: number;
  z: number; // 0 = far, 1 = near
  s: number;
  a: number;
  ph: number;
}

function getGaleTelemetry() {
  const rawSite = (MARS_SITES.GALE_CRATER || {}) as Record<string, any>;
  const rawDonki = ((resourceEngine as Record<string, any>).donkiWeather || {}) as Record<string, any>;

  return {
    lat: typeof rawSite.lat === 'number' ? rawSite.lat : -5.4,
    lon: typeof rawSite.lon === 'number' ? rawSite.lon : 137.8,
    elevationMeters: typeof rawSite.elevationMeters === 'number' ? rawSite.elevationMeters : -4500,
    slopeDeg: typeof rawSite.slopeDeg === 'number' ? rawSite.slopeDeg : 6.2,
    subsurfaceIceDepthM: typeof rawSite.subsurfaceIceDepthM === 'number' ? rawSite.subsurfaceIceDepthM : 18.5,
    solarIrradianceFactor: typeof rawSite.solarIrradianceFactor === 'number' ? rawSite.solarIrradianceFactor : 0.98,
    flareClass: typeof rawDonki.flareClass === 'string' ? rawDonki.flareClass : 'M3.8',
    radiationMultiplier: typeof rawDonki.radiationMultiplier === 'number' ? rawDonki.radiationMultiplier : 1.85,
    isLive: Boolean(rawDonki.isLive),
  };
}

/**
 * UI-only atmosphere model. Dust loading rises as Mars Trek solar irradiance drops
 * (more suspended dust = less sunlight reaching the surface) and nudges up with the
 * DONKI radiation multiplier so space-weather events read visually in the sky.
 */
function getDustModel() {
  const t = getGaleTelemetry();
  const loss = Phaser.Math.Clamp(1 - t.solarIrradianceFactor, 0, 0.6);
  const boost = Math.max(0, t.radiationMultiplier - 1);
  const level = Phaser.Math.Clamp(0.3 + loss * 6 + boost * 0.12, 0.2, 1);
  const flareLetter = t.flareClass.charAt(0).toUpperCase();
  const flareTier = flareLetter === 'X' ? 'SEVERE' : flareLetter === 'M' ? 'ELEVATED' : 'NOMINAL';
  const flareColor = flareLetter === 'X' ? COLOR.red : flareLetter === 'M' ? COLOR.amber : COLOR.green;
  const label =
    level < 0.4 ? 'CLEAR SKY' : level < 0.62 ? 'DUSTY HAZE' : level < 0.82 ? 'DUST EVENT' : 'REGIONAL STORM';
  return {
    level,
    tau: Number((0.35 + level * 1.9).toFixed(2)),
    windMs: Math.round(4 + level * 16),
    label,
    flareLetter,
    flareTier,
    flareColor,
  };
}
type DustModel = ReturnType<typeof getDustModel>;

/** Sols since Curiosity landing (Bradbury Landing, 6 Aug 2012 05:17:57 UTC). Display only. */
function curiosityRefSol(): number {
  const landing = Date.UTC(2012, 7, 6, 5, 17, 57);
  return Math.max(0, Math.floor((Date.now() - landing) / 88775244));
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-Safe Polygon Helpers (Avoids Phaser.Geom.Point TS errors)
// ─────────────────────────────────────────────────────────────────────────────

function fillPoly(g: Gfx, pts: Pt[], close = true): Gfx {
  if (pts.length === 0) return g;
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    g.lineTo(pts[i].x, pts[i].y);
  }
  if (close) g.closePath();
  g.fillPath();
  return g;
}

function strokePoly(g: Gfx, pts: Pt[], close = true): Gfx {
  if (pts.length === 0) return g;
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    g.lineTo(pts[i].x, pts[i].y);
  }
  if (close) g.closePath();
  g.strokePath();
  return g;
}

function arcPoints(
  cx: number, cy: number, rx: number, ry: number,
  a0: number, a1: number, rot = 0, steps = 28
): Pt[] {
  const pts: Pt[] = [];
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    const px = Math.cos(a) * rx;
    const py = Math.sin(a) * ry;
    pts.push({
      x: snap(cx + px * cos - py * sin, 2),
      y: snap(cy + px * sin + py * cos, 2),
    });
  }
  return pts;
}

/** Sci-fi corner brackets centered on (cx, cy). */
function drawBrackets(g: Gfx, cx: number, cy: number, w: number, h: number, len: number, color: number, alpha = 0.9) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  g.lineStyle(2, color, alpha);
  g.lineBetween(x0, y0, x0 + len, y0).lineBetween(x0, y0, x0, y0 + len);
  g.lineBetween(x1, y0, x1 - len, y0).lineBetween(x1, y0, x1, y0 + len);
  g.lineBetween(x0, y1, x0 + len, y1).lineBetween(x0, y1, x0, y1 - len);
  g.lineBetween(x1, y1, x1 - len, y1).lineBetween(x1, y1, x1, y1 - len);
}

// ─────────────────────────────────────────────────────────────────────────────
// Isometric 16-Bit Outpost Structure Renderers
// ─────────────────────────────────────────────────────────────────────────────

/** 1. CENTRAL HABITAT STATION (Top-Left Isometric Pressurized Module) */
function drawCentralHabitat(g: Gfx) {
  g.fillStyle(0x000000, 0.4).fillEllipse(-30, 8, 300, 90);

  // Isometric foundation plinth
  const base: Pt[] = [
    { x: -120, y: 0 }, { x: 0, y: 46 }, { x: 120, y: 0 }, { x: 0, y: -46 }
  ];
  g.fillStyle(0x334155);
  fillPoly(g, base, true);
  g.lineStyle(2, 0x0f172a);
  strokePoly(g, base, true);

  // Main isometric habitat hull
  g.fillStyle(0xcbd5e1).fillRoundedRect(-104, -78, 208, 78, 14);
  g.fillStyle(0x94a3b8).fillRoundedRect(-104, -38, 208, 38, 8);
  // Sun from the right: warm rim light + cool shade on the left
  g.fillStyle(0xfff1d6, 0.22).fillRect(62, -72, 38, 66);
  g.fillStyle(0x0f172a, 0.2).fillRect(-100, -74, 30, 66);
  g.lineStyle(2.5, 0x0f172a).strokeRoundedRect(-104, -78, 208, 78, 14);

  // Roof solar panel skylight & thermal unit
  const roof: Pt[] = [
    { x: -64, y: -74 }, { x: 0, y: -96 }, { x: 64, y: -74 }, { x: 0, y: -52 }
  ];
  g.fillStyle(0x1e3a8a);
  fillPoly(g, roof, true);
  g.lineStyle(2, COLOR.cyan);
  strokePoly(g, roof, true);

  // Illuminated side viewports
  for (const vx of [-72, -42, 42, 72]) {
    g.fillStyle(0x0f172a).fillRect(vx - 10, -52, 20, 14);
    g.fillStyle(0xfbbf24, 0.9).fillRect(vx - 8, -50, 16, 10);
  }

  // Pressurized airlock door & isometric entry stairs
  g.fillStyle(0x1e293b).fillRect(-22, -56, 44, 52);
  g.lineStyle(2, COLOR.cyan).strokeRect(-22, -56, 44, 52);
  g.fillStyle(COLOR.cyan, 0.7).fillRect(-10, -44, 20, 14);

  const stairs: Pt[] = [
    { x: -24, y: -4 }, { x: 24, y: -4 }, { x: 38, y: 34 }, { x: -38, y: 34 }
  ];
  g.fillStyle(0x475569);
  fillPoly(g, stairs, true);
  g.lineStyle(2, 0x94a3b8);
  strokePoly(g, stairs, true);
  for (let sy = 2; sy <= 28; sy += 7) {
    g.lineBetween(-26, sy, 26, sy);
  }

  // Comms mast with status beacon
  g.lineStyle(3, 0x475569).lineBetween(84, -76, 84, -122);
  g.fillStyle(COLOR.red, 0.95).fillCircle(84, -124, 4);
  g.lineStyle(2, 0x94a3b8).lineBetween(76, -112, 92, -112);

  // Wind-blown regolith drifts against the plinth
  g.fillStyle(0xb8763f, 0.4).fillEllipse(-96, 12, 70, 14);
  g.fillStyle(0xb8763f, 0.3).fillEllipse(104, 6, 54, 10);
}

/** 2. LREV ROVER GARAGE & KILOPOWER BAY (Top-Center Hangar) */
function drawRoverGarage(g: Gfx) {
  g.fillStyle(0x000000, 0.4).fillEllipse(-20, 6, 280, 82);

  // Hangar arch & blast bay
  g.fillStyle(0x475569).fillRoundedRect(-96, -74, 192, 74, 10);
  g.fillStyle(0xfff1d6, 0.14).fillRect(56, -68, 34, 62);
  g.fillStyle(0x0f172a, 0.22).fillRect(-92, -70, 22, 62);
  g.lineStyle(2.5, 0x0f172a).strokeRoundedRect(-96, -74, 192, 74, 10);

  // Open garage bay interior & ramp
  g.fillStyle(0x0f172a).fillRect(-48, -54, 96, 54);
  g.lineStyle(2, COLOR.amber).strokeRect(-48, -54, 96, 54);
  // Interior work lights
  g.fillStyle(COLOR.amber, 0.55).fillRect(-40, -50, 20, 4).fillRect(20, -50, 20, 4);

  const ramp: Pt[] = [
    { x: -48, y: 0 }, { x: 48, y: 0 }, { x: 68, y: 36 }, { x: -68, y: 36 }
  ];
  g.fillStyle(0x334155);
  fillPoly(g, ramp, true);
  g.lineStyle(2, 0x64748b);
  strokePoly(g, ramp, true);
  for (let ry = 8; ry <= 30; ry += 8) {
    g.lineStyle(1, 0x64748b, 0.7).lineBetween(-52 - ry * 0.4, ry, 52 + ry * 0.4, ry);
  }

  // Kilopower Stirling Fission Mast & Solar Wing on right
  g.fillStyle(0x334155).fillRect(112, -98, 14, 98);
  g.fillStyle(COLOR.amber, 0.9).fillCircle(119, -104, 10);
  g.fillStyle(0xfef3c7, 0.5).fillCircle(116, -107, 3);
  g.fillStyle(0x1e3a8a).fillRect(-76, -90, 152, 14);
  g.lineStyle(1.5, COLOR.cyan).strokeRect(-76, -90, 152, 14);
  for (let px = -76; px <= 76; px += 19) {
    g.lineStyle(1, COLOR.cyan, 0.5).lineBetween(px, -90, px, -76);
  }
}

/** 3. ARES DESCENT ROCKET LANDER (Center-Right Tall Vertical Methalox Lander) */
function drawAresLander(g: Gfx) {
  // Long late-afternoon shadow cast away from the sun
  g.fillStyle(0x000000, 0.2);
  fillPoly(g, [{ x: -30, y: 8 }, { x: 30, y: 8 }, { x: -200, y: 30 }, { x: -270, y: 14 }], true);

  // Scorched landing pad & blast crater shadow
  g.fillStyle(0x2a0f04, 0.75).fillEllipse(0, 12, 220, 74);
  g.lineStyle(2, 0x7c2d12, 0.8).strokeEllipse(0, 12, 200, 64);
  // Retro-propulsion scour streaks (Bradbury Landing blast zone)
  for (let a = 0; a < 10; a++) {
    const ang = (a / 10) * Math.PI * 2;
    g.lineStyle(1.5, 0x2a0f04, 0.5).lineBetween(
      Math.cos(ang) * 70, 12 + Math.sin(ang) * 22,
      Math.cos(ang) * 130, 12 + Math.sin(ang) * 40
    );
  }

  // 4 Deployable carbon-composite landing legs
  g.lineStyle(5, 0x334155)
    .lineBetween(-36, -42, -74, 14)
    .lineBetween(36, -42, 74, 14)
    .lineBetween(-18, -32, -42, 24)
    .lineBetween(18, -32, 42, 24);
  for (const [fx, fy] of [[-74, 14], [74, 14], [-42, 24], [42, 24]]) {
    g.fillStyle(0x475569).fillEllipse(fx, fy, 24, 10);
  }

  // Lower Propulsion Skirt & Methalox Thruster Bells
  g.fillStyle(0x1e293b).fillRect(-40, -56, 80, 36);
  g.lineStyle(2, 0x0f172a).strokeRect(-40, -56, 80, 36);

  // Main Cylindrical fuselage
  g.fillStyle(0xe2e8f0).fillRect(-40, -156, 80, 102);
  g.fillStyle(0xcbd5e1).fillRect(10, -156, 30, 102);
  g.fillStyle(0xfff1d6, 0.25).fillRect(26, -156, 14, 102);
  g.lineStyle(2.5, 0x0f172a).strokeRect(-40, -156, 80, 102);

  // Orange thermal tile band & NASA/ARES markings
  g.fillStyle(0xc2410c).fillRect(-40, -156, 80, 14);
  g.fillStyle(0x0f172a).fillRect(-26, -124, 18, 28);
  g.fillStyle(COLOR.cyan, 0.85).fillRect(10, -120, 16, 12);
  g.fillStyle(0xc2410c).fillRect(-40, -62, 80, 6);

  // Conical Nose Fairing & Red Tip Cap
  const cone: Pt[] = [
    { x: -40, y: -156 }, { x: 0, y: -228 }, { x: 40, y: -156 }
  ];
  g.fillStyle(0xf8fafc);
  fillPoly(g, cone, true);
  g.lineStyle(2.5, 0x0f172a);
  strokePoly(g, cone, true);

  const noseTip: Pt[] = [
    { x: -15, y: -200 }, { x: 0, y: -228 }, { x: 15, y: -200 }
  ];
  g.fillStyle(0xc2410c);
  fillPoly(g, noseTip, true);

  // Side External O2 / Methalox Fuel Cylinders
  for (const tx of [-72, 62]) {
    g.fillStyle(0x0284c7).fillRoundedRect(tx, -64, 24, 58, 6);
    g.lineStyle(2, 0x0f172a).strokeRoundedRect(tx, -64, 24, 58, 6);
    g.fillStyle(0xe2e8f0).fillRect(tx + 2, -42, 20, 10);
  }
}

/** 4. SUBSURFACE SCIENCE MODULE & DRILL RIG (Bottom-Left Lab + Parabolic Dish) */
function drawScienceDrillRig(g: Gfx) {
  g.fillStyle(0x000000, 0.42).fillEllipse(-20, 10, 310, 94);

  // Main Lab Hull
  g.fillStyle(0xcbd5e1).fillRoundedRect(-110, -82, 220, 82, 12);
  g.fillStyle(0x94a3b8).fillRoundedRect(-110, -38, 220, 38, 8);
  g.fillStyle(0xfff1d6, 0.2).fillRect(68, -76, 38, 70);
  g.fillStyle(0x0f172a, 0.2).fillRect(-106, -78, 26, 70);
  g.lineStyle(2.5, 0x0f172a).strokeRoundedRect(-110, -82, 220, 82, 12);

  // Side SHARAD Drill Tower & Cryo-Tank (left)
  g.fillStyle(0x0284c7).fillRoundedRect(-142, -62, 32, 54, 6);
  g.lineStyle(2, COLOR.cyan).strokeRoundedRect(-142, -62, 32, 54, 6);

  // Roof Parabolic Telemetry Dish & Mast
  g.lineStyle(5, 0x475569).lineBetween(-24, -82, -24, -128);
  const dish = arcPoints(-24, -138, 44, 22, 0, Math.PI, -0.45);
  g.fillStyle(0xe2e8f0);
  fillPoly(g, dish, true);
  g.lineStyle(2, 0x0f172a);
  strokePoly(g, dish, true);
  g.lineStyle(2, COLOR.cyan).lineBetween(-24, -138, -2, -162);
  g.fillStyle(COLOR.amber).fillCircle(-2, -162, 4);

  // Right Roof Ventilation & Drill Derrick
  g.fillStyle(0x475569).fillRect(32, -110, 38, 28);
  g.lineStyle(2, 0x0f172a).strokeRect(32, -110, 38, 28);
  // Derrick lattice (John Klein / Cumberland style drill stem)
  g.lineStyle(2, 0x94a3b8)
    .lineBetween(124, 0, 140, -96)
    .lineBetween(156, 0, 140, -96)
    .lineBetween(128, -30, 152, -30)
    .lineBetween(133, -62, 147, -62);
  g.fillStyle(COLOR.amber).fillCircle(140, -98, 4);

  // Lab Entry Door & Stairs
  g.fillStyle(0x0f172a).fillRect(-36, -54, 42, 50);
  g.lineStyle(2, COLOR.cyan).strokeRect(-36, -54, 42, 50);
  const stairs: Pt[] = [
    { x: -38, y: -4 }, { x: 8, y: -4 }, { x: -4, y: 36 }, { x: -52, y: 36 }
  ];
  g.fillStyle(0x475569);
  fillPoly(g, stairs, true);
  g.lineStyle(2, 0x94a3b8);
  strokePoly(g, stairs, true);
}

/** 5. REGOLITH STORM BUNKER & RADIATION VAULT (Bottom-Right Shielded Dome) */
function drawRegolithBunker(g: Gfx) {
  g.fillStyle(0x000000, 0.42).fillEllipse(-14, 8, 280, 84);

  // Sintered Martian regolith berm
  const mound = arcPoints(0, 4, 124, 82, Math.PI, Math.PI * 2);
  g.fillStyle(0x5b2a0f);
  fillPoly(g, mound, true);
  const inner = arcPoints(0, 4, 108, 66, Math.PI, Math.PI * 2);
  g.fillStyle(PAL.regolith, 0.92);
  fillPoly(g, inner, true);
  // Sun-facing slope highlight
  const lit = arcPoints(0, 4, 100, 60, Math.PI * 1.55, Math.PI * 2);
  g.fillStyle(0xb8763f, 0.35);
  fillPoly(g, lit, true);
  g.lineStyle(2.5, 0x2a0f04);
  strokePoly(g, mound, true);
  // Rock armour texture
  for (const [rx, ry] of [[-84, -6], [-62, -30], [58, -26], [88, -8], [-20, -62], [30, -64]]) {
    g.fillStyle(0x3a1507, 0.8).fillRect(rx, ry, 10, 6);
    g.fillStyle(0xa8693a, 0.5).fillRect(rx, ry, 10, 2);
  }

  // Armored blast portal & hazard chevrons
  g.fillStyle(0x1e293b).fillRect(-34, -54, 68, 56);
  g.lineStyle(2, COLOR.amber).strokeRect(-34, -54, 68, 56);
  for (let i = 0; i < 8; i++) {
    g.fillStyle(i % 2 ? COLOR.amber : 0x0f172a).fillRect(-32 + i * 8, -62, 8, 8);
  }
  g.fillStyle(COLOR.cyan, 0.85).fillRect(-14, -36, 28, 8);
}

/** Static Curiosity rover prop (landmark; not interactive). */
function drawCuriosityProp(g: Gfx) {
  g.fillStyle(0x000000, 0.35).fillEllipse(0, 8, 84, 16);
  // Rocker-bogie + six wheels (side view)
  g.lineStyle(3, 0x64748b)
    .lineBetween(-28, -6, 0, -16)
    .lineBetween(0, -16, 28, -6)
    .lineBetween(-28, -6, -28, 2)
    .lineBetween(28, -6, 28, 2);
  for (const wx of [-30, 0, 30]) {
    g.fillStyle(0x1f2937).fillCircle(wx, 0, 7);
    g.lineStyle(1.5, 0x94a3b8).strokeCircle(wx, 0, 7);
    g.fillStyle(0x94a3b8).fillRect(wx - 1, -1, 2, 2);
  }
  // Warm electronics body + deck
  g.fillStyle(0xcbd5e1).fillRect(-32, -34, 64, 18);
  g.fillStyle(0x94a3b8).fillRect(-32, -22, 64, 6);
  g.lineStyle(2, 0x0f172a).strokeRect(-32, -34, 64, 18);
  // MMRTG aft
  g.fillStyle(0x334155).fillRect(32, -30, 18, 8);
  for (let f = 0; f < 4; f++) g.fillStyle(0x64748b).fillRect(34 + f * 4, -34, 2, 4);
  // Mast + Mastcam head
  g.lineStyle(3, 0x94a3b8).lineBetween(-18, -34, -18, -58);
  g.fillStyle(0xe2e8f0).fillRect(-26, -64, 16, 8);
  g.fillStyle(COLOR.cyan, 0.9).fillRect(-24, -62, 4, 4).fillRect(-16, -62, 4, 4);
  // Robotic arm
  g.lineStyle(3, 0x94a3b8).lineBetween(-32, -26, -48, -16).lineBetween(-48, -16, -42, -8);
  // Hi-gain antenna
  g.fillStyle(0xe2e8f0).fillCircle(10, -40, 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene Class
// ─────────────────────────────────────────────────────────────────────────────

export class GaleBaseScene extends Phaser.Scene {
  private modules: OutpostModule[] = [];
  private moduleViews = new Map<string, ModuleView>();
  private parallaxLayers: ParallaxLayer[] = [];

  private astronaut!: Phaser.GameObjects.Container;
  private astroSprite?: Phaser.GameObjects.Sprite;
  private pulseGfx?: Gfx;

  // Input keys
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    E: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
    M: Phaser.Input.Keyboard.Key;
  };

  // Modal & UI state
  private modalElements: Phaser.GameObjects.GameObject[] = [];
  private isModalOpen = false;
  private modalCooldownUntil = 0;
  private windowKeyHandler?: (e: KeyboardEvent) => void;

  private statusBanner!: Phaser.GameObjects.Text;
  private progressFill!: Phaser.GameObjects.Rectangle;
  private donkiHudText?: Phaser.GameObjects.Text;
  private toastText?: Phaser.GameObjects.Text;
  private traverseBtn?: Phaser.GameObjects.Container;
  private nearestModule?: OutpostModule;

  private camOffsetX = 0;
  private camOffsetY = 0;
  private leaving = false;

  // ── UI / atmosphere (visual only) ──
  private dust!: DustModel;
  private dustGfx?: Gfx;
  private dustParticles: DustP[] = [];
  private dustVeil?: Phaser.GameObjects.Rectangle;
  private devilGfx?: Gfx;
  private devil = { active: false, x: 0, y: 0, dir: 1, h: 100, nextAt: 4000 };
  private alertFrame?: Phaser.GameObjects.Rectangle;
  private checklistRows: Array<{ dot: Phaser.GameObjects.Rectangle; status: Phaser.GameObjects.Text }> = [];
  private miniGfx?: Gfx;

  constructor() {
    super({ key: 'GaleBaseScene' });
  }

  init() {
    this.moduleViews.clear();
    this.parallaxLayers = [];
    this.modalElements = [];
    this.isModalOpen = false;
    this.modalCooldownUntil = 0;
    this.toastText = undefined;
    this.traverseBtn = undefined;
    this.astroSprite = undefined;
    this.pulseGfx = undefined;
    this.donkiHudText = undefined;
    this.nearestModule = undefined;
    this.camOffsetX = 0;
    this.camOffsetY = 0;
    this.leaving = false;
    this.dustGfx = undefined;
    this.dustParticles = [];
    this.dustVeil = undefined;
    this.devilGfx = undefined;
    this.devil = { active: false, x: 0, y: 0, dir: 1, h: 100, nextAt: 4000 };
    this.alertFrame = undefined;
    this.checklistRows = [];
    this.miniGfx = undefined;
    this.removeWindowKeyListener();
  }

  create() {
    gameState.currentLocation = 'gale';
    gameState.save();
    // Keep main camera pinned at (0,0) so screen-space UI hitboxes never drift
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.fadeIn(400, 5, 10, 20);

    // Prevent 0% power soft-lock on Act I boot
    if (gameState.resources.power <= 0) {
      gameState.resources.power = 65;
    }

    this.dust = getDustModel();
    this.modules = this.buildModuleDefs();

    // Attach optional Blender backdrop, then always layer our 16-bit parallax + outpost modules
    attachBlenderSceneSlot(this, 'GALE_BASE', () => {});
    this.createProceduralOutpostWorld();
    this.createAtmosphere();

    this.modules.forEach(m => this.createModuleMarker(m));
    this.createAstronautCharacter();
    this.createTopMissionHeader();
    this.createNasaTelemetryHud();
    this.createCommissionChecklist();
    this.createSiteMiniMap();
    this.createBottomControlBar();
    this.setupKeyboardControls();

    // Click terrain to walk astronaut
    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (this.isModalOpen || over.length > 0) return;
        if (pointer.y < WALK.minY - 40 || pointer.y > WALK.maxY + 20) return;
        this.pingAt(pointer.x, pointer.y);
        this.walkAstronautTo(pointer.x, pointer.y);
      }
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeWindowKeyListener();
    });

    if (gameState.currentChapter === 'act_3_gale_return') {
      this.createAct3Upgrades();
    }
  }

  // ───────────────────────────── Update Loop (WASD + Parallax + Proximity) ─────────────────────────────

  update(time: number, delta: number) {
    // 1. Handle WASD / Arrow Key Astronaut Walking when modal is closed
    if (!this.isModalOpen && this.astronaut && this.wasd && this.cursors) {
      let vx = 0;
      let vy = 0;
      if (this.cursors.left.isDown || this.wasd.A.isDown) vx -= 1;
      if (this.cursors.right.isDown || this.wasd.D.isDown) vx += 1;
      if (this.cursors.up.isDown || this.wasd.W.isDown) vy -= 1;
      if (this.cursors.down.isDown || this.wasd.S.isDown) vy += 1;

      if (vx !== 0 || vy !== 0) {
        // Cancel any active click-to-walk tween when player uses keyboard
        this.tweens.killTweensOf(this.astronaut);
        const len = Math.hypot(vx, vy);
        const step = (WALK_SPEED * delta) / 1000;
        this.astronaut.x = Phaser.Math.Clamp(this.astronaut.x + (vx / len) * step, WALK.minX, WALK.maxX);
        this.astronaut.y = Phaser.Math.Clamp(this.astronaut.y + (vy / len) * step, WALK.minY, WALK.maxY);
        this.astronaut.setDepth(this.astronaut.y);
        if (vx !== 0) this.astronaut.scaleX = vx < 0 ? -1 : 1;
        this.setAstronautAnim('walk');
      } else if (!this.tweens.isTweening(this.astronaut)) {
        this.setAstronautAnim('idle');
      }

      // Check [E] or [SPACE] to interact with nearest module
      if (
        time > this.modalCooldownUntil &&
        (Phaser.Input.Keyboard.JustDown(this.wasd.E) || Phaser.Input.Keyboard.JustDown(this.wasd.SPACE))
      ) {
        if (this.nearestModule) {
          soundFx.playClick(1100);
          this.openModuleModal(this.nearestModule);
        } else {
          this.toast('MOVE CLOSER TO AN OUTPOST MODULE TO INTERACT', COLOR.amber);
        }
      }

      // Check [M] for Mars Travel Map
      if (Phaser.Input.Keyboard.JustDown(this.wasd.M)) {
        this.openOrbitalMap();
      }
    }

    // 2. Highlight nearest module within interaction radius
    this.updateNearestModuleHighlight();

    // 3. 16-Bit Pixel-Snapped Parallax Update
    const ptr = this.input.activePointer;
    const ptrNormX = ((ptr.x || W / 2) - W / 2) / (W / 2);
    const ptrNormY = ((ptr.y || H / 2) - H / 2) / (H / 2);
    const astroNormX = this.astronaut ? (this.astronaut.x - W / 2) / (W / 2) : 0;

    const targetX = (astroNormX * 0.65 + ptrNormX * 0.35) * 60;
    const targetY = ptrNormY * 14;

    this.camOffsetX = Phaser.Math.Linear(this.camOffsetX, targetX, 0.08);
    this.camOffsetY = Phaser.Math.Linear(this.camOffsetY, targetY, 0.08);

    for (const layer of this.parallaxLayers) {
      layer.target.x = snap(layer.baseX - this.camOffsetX * layer.factorX, 2);
      layer.target.y = snap(layer.baseY - this.camOffsetY * layer.factorY, 2);
    }

    // 4. Conduit Energy Pulses
    if (this.pulseGfx && this.modules.length > 1) {
      this.pulseGfx.clear();
      const hub = this.modules[0];
      const phase = (time * 0.00045) % 1;

      for (let i = 1; i < this.modules.length; i++) {
        const m = this.modules[i];
        const done = this.isDone(m.id);
        const t = (phase + i * 0.19) % 1;
        const px = snap(Phaser.Math.Linear(m.x, hub.x, t), 2);
        const py = snap(Phaser.Math.Linear(m.y, hub.y, t), 2);
        const col = done ? COLOR.green : COLOR.cyan;
        this.pulseGfx.fillStyle(col, 0.9).fillRect(px - 3, py - 3, 6, 6);
        this.pulseGfx.fillStyle(col, 0.25).fillRect(px - 7, py - 7, 14, 14);
      }
    }

    // 5. Atmosphere (wind-driven dust, dust devil) + HUD mini-map (visual only)
    this.updateAtmosphere(time, delta);
    this.updateMiniMap(time);
  }

  private setupKeyboardControls() {
    if (!this.input.keyboard) return;
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      E: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      SPACE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      M: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M),
    };
  }

  // ───────────────────────────── 5 Outpost Modules (Curiosity-referenced sites) ─────────────────────────────

  private buildModuleDefs(): OutpostModule[] {
    const gale = getGaleTelemetry();
    return [
      {
        id: 'hab_station',
        category: 'CREW QUARTERS & ECLSS',
        name: 'Central Habitat Station',
        short: 'HABITAT',
        locale: 'PEACE VALLIS · ALLUVIAL FAN APRON',
        curiosityRef:
          'Curiosity ref: Peace Vallis is an ancient stream channel feeding an alluvial fan on the Gale floor, evidence that liquid water once flowed into the crater.',
        x: 400,
        y: 450,
        markerDy: 120,
        desc: `Pressurized normoxic crew habitat at Gale Crater (${gale.elevationMeters}m MOLA). Run 101.3 kPa bulkhead seal verification and Sabatier CO2 scrubbers.`,
        effect: '+10% AIR  //  CO2 SCRUBBED TO 450 PPM',
        osdrId: 'OSD-168',
        osdrKeyword: 'hypoxia',
        osdrNote: 'Maintains normoxic 101.3 kPa cabin pressure to prevent hypoxic cognitive latency.',
        draw: drawCentralHabitat,
        onCommission: () => {
          gameState.resources.airReserve = Math.min(100, gameState.resources.airReserve + 10);
          gameState.hazards.co2Ppm = 450;
          gameState.addLog('CENTRAL HABITAT: 101.3 kPa normoxic seal verified. ECLSS CO2 scrubbed to 450 ppm.', 'system');
        },
      },
      {
        id: 'rover_garage',
        category: 'GARAGE & KILOPOWER BUS',
        name: 'LREV Garage & Kilopower Array',
        short: 'KILOPOWER',
        locale: 'GLEN TORRIDON · CLAY-BEARING UNIT',
        curiosityRef:
          'Curiosity ref: Glen Torridon, a clay-mineral-rich trough on lower Mount Sharp, was driven from late 2019, a natural staging corridor toward the foothills.',
        x: 860,
        y: 395,
        markerDy: 120,
        desc: `Couple 10 kWe Kilopower Stirling fission core and photovoltaic arrays (${Math.round(gale.solarIrradianceFactor * 100)}% Mars Trek irradiance) to main habitat power bus.`,
        effect: '+30% POWER  //  +15% THERMAL STABILITY',
        osdrId: 'OSD-242',
        osdrKeyword: 'thermoregulation',
        osdrNote: 'Prevents habitat thermal drops that elevate crew metabolic caloric burn by 22%.',
        draw: drawRoverGarage,
        onCommission: () => {
          gameState.resources.power = Math.min(100, Math.max(55, gameState.resources.power + 30));
          gameState.resources.thermalStability = Math.min(100, gameState.resources.thermalStability + 15);
          gameState.addLog('KILOPOWER BUS: Fission core & solar trackers online. Habitat power bus nominal.', 'system');
        },
      },
      {
        id: 'ares_lander',
        category: 'LANDING PLATFORM',
        name: 'Ares Descent Rocket Lander',
        short: 'ARES LANDER',
        locale: 'BRADBURY LANDING · SOL 0',
        curiosityRef:
          'Curiosity ref: Curiosity touched down at Bradbury Landing in August 2012, lowered by sky-crane onto the floor of 154 km-wide Gale Crater.',
        x: 1260,
        y: 540,
        markerDy: 250,
        desc: 'The single-stage Ares lander and primary cargo platform that brought you through atmospheric entry to Gale Crater. Inspect methalox descent fuel cells and telemetry avionics.',
        effect: '+25% POWER  //  AVIONICS & FUEL CELLS LINKED',
        osdrId: 'OSD-48',
        osdrKeyword: 'circadian',
        osdrNote: 'Stabilizes post-landing vestibular & circadian telemetry synchronization for surface EVA.',
        draw: drawAresLander,
        onCommission: () => {
          gameState.resources.power = Math.min(100, Math.max(50, gameState.resources.power + 25));
          gameState.dsnLocked = true;
          gameState.addLog('ARES LANDER: Methalox fuel-cell umbilical & DSN avionics coupled to outpost grid.', 'capcom');
        },
      },
      {
        id: 'science_drill',
        category: 'SHARAD ICE & ASTROBIOLOGY',
        name: 'Subsurface Science Module & Drill Rig',
        short: 'DRILL RIG',
        locale: 'YELLOWKNIFE BAY · JOHN KLEIN & CUMBERLAND',
        curiosityRef:
          'Curiosity ref: its first drill holes (2013) in Yellowknife Bay mudstone revealed clay minerals and key elements for life, an ancient habitable lake environment.',
        x: 400,
        y: 830,
        markerDy: 175,
        desc: `Initialize SHARAD subsurface ice auger (${gale.subsurfaceIceDepthM}m depth) and closed-loop graywater distillation to fill perimeter water-wall radiation shields.`,
        effect: '+15% WATER RESERVE  //  HYDRO-SHIELD PRIMED',
        osdrId: 'OSD-115',
        osdrKeyword: 'metabolism',
        osdrNote: 'Sustains closed-loop crew hydration and hydrogen-dense perimeter radiation shielding.',
        draw: drawScienceDrillRig,
        onCommission: () => {
          gameState.resources.waterReserve = Math.min(100, gameState.resources.waterReserve + 15);
          gameState.addLog('SCIENCE & DRILL RIG: SHARAD subsurface ice extractor online. 93% water recovery.', 'science');
        },
      },
      {
        id: 'storm_bunker',
        category: 'RADIATION VAULT & SHIELDING',
        name: 'Regolith Storm Bunker',
        short: 'STORM BUNKER',
        locale: 'BAGNOLD DUNES · LOWER MOUNT SHARP',
        curiosityRef:
          'Curiosity ref: the dark basaltic Bagnold Dunes were the first active dunes studied up close on another planet (2015–2016).',
        x: 1560,
        y: 790,
        markerDy: 115,
        desc: `Deploy autonomous dozers across ${gale.slopeDeg}° MOLA slope to heap 1.5m sintered regolith over the storm vault against NASA DONKI solar particle events.`,
        effect: 'SHELTER PROTECTION 95%  //  GCR ATTENUATED',
        osdrId: 'OSD-379',
        osdrKeyword: 'radiation',
        osdrNote: 'Attenuates DONKI solar particle events & GCRs to prevent DNA double-strand breaks.',
        draw: drawRegolithBunker,
        onCommission: () => {
          gameState.resources.shelterProtection = 95;
          gameState.addLog('STORM BUNKER: 1.5m Martian regolith shielding completed. GCR & SPE dose attenuated.', 'system');
        },
      },
    ];
  }

  private isDone(id: string) {
    return gameState.galeCommissionedNodes.includes(id);
  }

  // ───────────────────────────── Unstuck Modal Implementation ─────────────────────────────

  private openModuleModal(mod: OutpostModule) {
    if (this.isModalOpen || this.time.now < this.modalCooldownUntil) return;

    this.isModalOpen = true;
    if (this.astronaut) {
      this.tweens.killTweensOf(this.astronaut);
      this.setAstronautAnim('idle');
    }

    const done = this.isDone(mod.id);
    const gale = getGaleTelemetry();
    const PW = 760;
    const PH = 470;
    const CX = W / 2;
    const CY = H / 2;
    const accent = done ? COLOR.green : COLOR.cyan;

    // 1. Full-screen dim blocker (direct scene object, no container scroll offset)
    const shade = this.add
      .rectangle(CX, CY, W, H, 0x02060d, 0.76)
      .setDepth(DEPTH.dialogShade)
      .setInteractive();

    shade.on('pointerdown', () => {
      soundFx.playClick(700);
      this.closeModuleModal();
    });

    // 2. Modal Chassis Panel (stops click propagation so clicking inside panel doesn't close it)
    const panelBg = this.add
      .rectangle(CX, CY, PW, PH, COLOR.panel, 0.98)
      .setStrokeStyle(2, accent)
      .setDepth(DEPTH.dialogPanel)
      .setInteractive();

    panelBg.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
      }
    );

    const topAccent = this.add
      .rectangle(CX, CY - PH / 2 + 3, PW, 6, accent)
      .setDepth(DEPTH.dialogPanel + 1);

    const frame = this.add.graphics().setDepth(DEPTH.dialogPanel + 1);
    drawBrackets(frame, CX, CY, PW - 16, PH - 16, 20, accent, 0.85);

    const statusChip = this.add
      .text(CX - PW / 2 + 26, CY - PH / 2 + 34, done ? '● OPERATIONAL' : '○ AWAITING COMMISSION', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: hex(accent),
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.dialogPanel + 1);

    // 3. Category, Title & Curiosity locale
    const catTxt = this.add
      .text(CX, CY - 205, `[ ${mod.category} ]`, {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        color: hex(COLOR.amber),
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.dialogPanel + 1);

    const titleTxt = this.add
      .text(CX, CY - 174, mod.name.toUpperCase(), {
        fontFamily: FONT_HEAD,
        fontSize: '22px',
        color: '#f8fafc',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.dialogPanel + 1);

    const localeTxt = this.add
      .text(CX, CY - 146, `◆ ${mod.locale}  //  ${Math.abs(gale.lat)}°${gale.lat < 0 ? 'S' : 'N'} ${gale.lon}°E`, {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#fcd9a8',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.dialogPanel + 1);

    const descTxt = this.add
      .text(CX, CY - 90, mod.desc, {
        fontFamily: FONT_BODY,
        fontSize: '17px',
        color: '#cbd5e1',
        align: 'center',
        wordWrap: { width: PW - 90 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.dialogPanel + 1);

    // 3b. Curiosity reference strip
    const factBar = this.add
      .rectangle(CX - (PW - 100) / 2, CY - 10, 3, 46, COLOR.amber)
      .setDepth(DEPTH.dialogPanel + 1);

    const factTxt = this.add
      .text(CX - (PW - 100) / 2 + 14, CY - 10, mod.curiosityRef, {
        fontFamily: FONT_BODY,
        fontSize: '14px',
        color: '#fcd9a8',
        wordWrap: { width: PW - 130 },
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.dialogPanel + 1);

    // 4. NASA OSDR + DONKI + Mars Trek Science Brief Box
    const osdrBg = this.add
      .rectangle(CX, CY + 58, PW - 80, 68, COLOR.panelInner)
      .setStrokeStyle(1, COLOR.green, 0.6)
      .setDepth(DEPTH.dialogPanel + 1);

    const osdrHeader = this.add
      .text(
        CX - (PW - 80) / 2 + 14,
        CY + 38,
        `🧬 NASA OSDR [${mod.osdrId}]  //  DONKI FLARE: ${gale.flareClass} (${gale.radiationMultiplier}x)  //  EFFECT: ${mod.effect}`,
        {
          fontFamily: FONT_MONO,
          fontSize: '10px',
          color: hex(COLOR.green),
        }
      )
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.dialogPanel + 2);

    const osdrNoteTxt = this.add
      .text(CX - (PW - 80) / 2 + 14, CY + 66, mod.osdrNote, {
        fontFamily: FONT_BODY,
        fontSize: '14px',
        color: '#e2e8f0',
        wordWrap: { width: PW - 110 },
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.dialogPanel + 2);

    // Live OSDR API query
    fetch(`https://osdr.nasa.gov/osdr/data/search?term=${encodeURIComponent(mod.osdrKeyword)}&size=1`)
      .then(r => r.json())
      .then(json => {
        const hit = json?.hits?.hits?.[0]?._source;
        if (hit && hit['Accession'] && osdrHeader.active) {
          osdrHeader.setText(
            `🧬 NASA OSDR LIVE [${hit['Accession']}]  //  DONKI: ${gale.flareClass}  //  ${mod.effect}`
          );
        }
      })
      .catch(() => {});

    // 5. COMMISSION MODULE [ENTER] Button......
    const commBtn = this.add
      .rectangle(CX, CY + 136, 330, 46, done ? COLOR.greenDeep : COLOR.cyanDeep)
      .setStrokeStyle(1.5, accent)
      .setDepth(DEPTH.dialogButtons)
      .setInteractive({ useHandCursor: true });

    const commTxt = this.add
      .text(CX, CY + 136, done ? 'MODULE OPERATIONAL [ENTER]' : 'COMMISSION MODULE [ENTER]', {
        fontFamily: FONT_HEAD,
        fontSize: '13px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.dialogButtons + 1);

    // 6. EXIT [ESC] Button
    const exitBtn = this.add
      .rectangle(CX, CY + 190, 180, 36, 0x0f172a)
      .setStrokeStyle(1, COLOR.slate)
      .setDepth(DEPTH.dialogButtons)
      .setInteractive({ useHandCursor: true });

    const exitTxt = this.add
      .text(CX, CY + 190, 'EXIT [ESC]', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        color: '#94a3b8',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.dialogButtons + 1);

    // 7. Top-Right [X] Button
    const closeBtn = this.add
      .rectangle(CX + PW / 2 - 34, CY - PH / 2 + 34, 34, 34, 0x1e293b)
      .setStrokeStyle(1.5, COLOR.amber)
      .setDepth(DEPTH.dialogButtons)
      .setInteractive({ useHandCursor: true });

    const closeTxt = this.add
      .text(CX + PW / 2 - 34, CY - PH / 2 + 34, '✕', {
        fontFamily: FONT_MONO,
        fontSize: '16px',
        color: hex(COLOR.amber),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.dialogButtons + 1);

    // Action Handlers
    const triggerCommission = () => {
      soundFx.playTelemetryChirp();
      this.commissionModule(mod);
      this.closeModuleModal();
    };

    const triggerClose = () => {
      soundFx.playClick(700);
      this.closeModuleModal();
    };

    commBtn.on('pointerover', () => commBtn.setFillStyle(done ? COLOR.green : 0x0ea5e9));
    commBtn.on('pointerout', () => commBtn.setFillStyle(done ? COLOR.greenDeep : COLOR.cyanDeep));
    commBtn.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        triggerCommission();
      }
    );

    // Enhanced commission button interaction (additive)
    attachUIInteraction(this, commBtn, {
      colorTarget:    commBtn,
      hoverFill:      done ? COLOR.green : 0x0ea5e9,
      defaultFill:    done ? COLOR.greenDeep : COLOR.cyanDeep,
      hoverStroke:    done ? COLOR.green : COLOR.cyan,
      hoverStrokeWidth: 2,
      defaultStroke:  done ? COLOR.green : COLOR.cyan,
      defaultStrokeWidth: 1.5,
      soundType:      done ? 'telemetry' : 'confirm',
      hoverScale:     1.03,
      pressScale:     0.97,
      tooltip:        done ? 'Module already commissioned.' : `Commission module: ${mod.effect}`,
      tooltipOffsetX: 24,
      tooltipOffsetY: -38,
      tooltipDepth:   DEPTH.dialogButtons + 20,
    });

    exitBtn.on('pointerover', () => exitBtn.setStrokeStyle(1.5, COLOR.cyan));
    exitBtn.on('pointerout', () => exitBtn.setStrokeStyle(1, COLOR.slate));
    exitBtn.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        triggerClose();
      }
    );

    // Enhanced exit button interaction (additive)
    attachUIInteraction(this, exitBtn, {
      colorTarget:    exitBtn,
      hoverStroke:    COLOR.cyan,
      hoverStrokeWidth: 1.5,
      defaultStroke:  COLOR.slate,
      defaultStrokeWidth: 1,
      soundType:      'cancel',
      hoverScale:     1.03,
      pressScale:     0.97,
      tooltip:        'Close module panel and return to Gale Base.',
      tooltipOffsetX: 24,
      tooltipOffsetY: -34,
      tooltipDepth:   DEPTH.dialogButtons + 20,
    });

    closeBtn.on('pointerover', () => closeBtn.setFillStyle(0x334155));
    closeBtn.on('pointerout', () => closeBtn.setFillStyle(0x1e293b));
    closeBtn.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        triggerClose();
      }
    );

    // Enhanced close [X] button interaction (additive)
    attachUIInteraction(this, closeBtn, {
      colorTarget:    closeBtn,
      hoverFill:      0x334155,
      defaultFill:    0x1e293b,
      hoverStroke:    COLOR.amber,
      hoverStrokeWidth: 2,
      defaultStroke:  COLOR.amber,
      defaultStrokeWidth: 1.5,
      soundType:      'cancel',
      hoverScale:     1.06,
      pressScale:     0.94,
      tooltipDepth:   DEPTH.dialogButtons + 20,
    });

    // Native Window Keydown Handler (Guarantees ENTER and ESC always work)
    this.removeWindowKeyListener();
    this.windowKeyHandler = (e: KeyboardEvent) => {
      if (!this.isModalOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        triggerClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        triggerCommission();
      }
    };
    window.addEventListener('keydown', this.windowKeyHandler, true);

    this.modalElements = [
      shade,
      panelBg,
      topAccent,
      frame,
      statusChip,
      catTxt,
      titleTxt,
      localeTxt,
      descTxt,
      factBar,
      factTxt,
      osdrBg,
      osdrHeader,
      osdrNoteTxt,
      commBtn,
      commTxt,
      exitBtn,
      exitTxt,
      closeBtn,
      closeTxt,
    ];
  }

  private removeWindowKeyListener() {
    if (this.windowKeyHandler) {
      window.removeEventListener('keydown', this.windowKeyHandler, true);
      this.windowKeyHandler = undefined;
    }
  }

  private closeModuleModal() {
    this.isModalOpen = false;
    this.modalCooldownUntil = this.time.now + 400;
    this.removeWindowKeyListener();

    for (const el of this.modalElements) {
      el.destroy();
    }
    this.modalElements = [];
  }

  private commissionModule(mod: OutpostModule) {
    if (!this.isDone(mod.id)) {
      gameState.galeCommissionedNodes.push(mod.id);
      if (gameState.resources.power <= 0) {
        gameState.resources.power = 55;
      }
      mod.onCommission();
      gameState.save();
      gameState.notifyChange?.('commission');
    }

    this.refreshModuleView(mod.id);
    this.burstAt(mod.x, mod.y - mod.markerDy);
    this.updateStatusBanner();
    this.toast(`${mod.name.toUpperCase()} COMMISSIONED  //  ${mod.effect}`, COLOR.green);
  }

  // ───────────────────────────── 16-Bit Parallax Backdrop & Outpost World ─────────────────────────────

  private addParallaxLayer(
    target: Phaser.GameObjects.GameObject & { x: number; y: number },
    factorX: number,
    factorY: number
  ) {
    this.parallaxLayers.push({
      target,
      baseX: target.x,
      baseY: target.y,
      factorX,
      factorY,
    });
  }

  private paintBands(
    x: number, y: number, w: number, h: number,
    from: number, to: number, steps: number, depth: number
  ) {
    const a = Phaser.Display.Color.IntegerToColor(from);
    const b = Phaser.Display.Color.IntegerToColor(to);
    const g = this.add.graphics().setDepth(depth);
    const bandH = Math.ceil(h / steps);
    for (let i = 0; i < steps; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, steps - 1, i);
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      g.fillRect(x, y + i * bandH, w, bandH + 1);
    }
    return g;
  }

  private steppedRidge(
    g: Gfx,
    baseY: number,
    pts: Array<[number, number]>,
    fillColor: number,
    rimHighlightColor: number,
    alpha = 1
  ) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      for (let x = x0; x < x1; x += PX) {
        const t = (x - x0) / Math.max(1, x1 - x0);
        const topY = snap(Phaser.Math.Linear(y0, y1, t), PX);
        g.fillStyle(fillColor, alpha).fillRect(x, topY, PX + 1, baseY - topY);
        g.fillStyle(rimHighlightColor, alpha).fillRect(x, topY, PX + 1, PX);
      }
    }
  }

  /** Aeolis Mons: same stepped silhouette as steppedRidge, but with horizontal sedimentary strata. */
  private strataRidge(
    g: Gfx,
    baseY: number,
    pts: Array<[number, number]>,
    rimHighlightColor: number,
    hazeMix: number,
    alpha = 1
  ) {
    const BAND = 18;
    const palette = PAL.strata.map(c => mix(c, PAL.haze, hazeMix));
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      for (let x = x0; x < x1; x += PX) {
        const t = (x - x0) / Math.max(1, x1 - x0);
        const topY = snap(Phaser.Math.Linear(y0, y1, t), PX);
        let yy = topY;
        while (yy < baseY) {
          const next = Math.min(baseY, (Math.floor(yy / BAND) + 1) * BAND);
          const idx = ((Math.floor(yy / BAND) % palette.length) + palette.length) % palette.length;
          // Slight lighting falloff to the east (sun side is brighter)
          const lit = mix(palette[idx], 0xfff1d6, Math.max(0, (x - 600) / 3200));
          g.fillStyle(lit, alpha).fillRect(x, yy, PX + 1, next - yy + 1);
          yy = next;
        }
        g.fillStyle(rimHighlightColor, alpha).fillRect(x, topY, PX + 1, PX);
      }
    }
  }

  private makeLandmarkLabel(x: number, y: number, text: string, toX: number, toY: number, depth: number) {
    const c = this.add.container(x, y).setDepth(depth);
    const gl = this.add.graphics();
    gl.lineStyle(1.5, 0xfde68a, 0.55).lineBetween(0, 0, toX - x, toY - y);
    gl.fillStyle(0xfde68a, 0.95).fillRect(toX - x - 3, toY - y - 3, 6, 6);
    const t = this.add
      .text(6, 0, text, { fontFamily: FONT_MONO, fontSize: '11px', color: '#fde68a' })
      .setOrigin(0, 0.5)
      .setShadow(1, 1, '#2a0f04', 2, false, true);
    c.add([gl, t]);
    return c;
  }

  private createProceduralOutpostWorld() {
    const dl = this.dust.level;

    // 1. Butterscotch Martian sky (Mastcam-style), dustier = warmer & flatter
    this.paintBands(
      -120, -20, W + 240, 190,
      mix(PAL.skyTop, PAL.dustVeil, dl * 0.3), PAL.skyMid, 10, DEPTH.sky
    );
    this.paintBands(
      -120, 170, W + 240, HORIZON_Y + 30 - 150,
      PAL.skyMid, mix(PAL.skyHorizon, PAL.haze, dl * 0.35), 12, DEPTH.sky
    );

    // 2. Faint pixel stars (high altitude only, Parallax 0.08)
    const stars = this.add.graphics().setDepth(DEPTH.stars);
    const starRnd = new Phaser.Math.RandomDataGenerator(['gale-stars-v5']);
    for (let i = 0; i < 26; i++) {
      const sx = snap(starRnd.between(-60, W + 60));
      const sy = snap(starRnd.between(10, 120));
      stars.fillStyle(0xfef3c7, starRnd.realInRange(0.12, 0.38) * (1 - dl * 0.5)).fillRect(sx, sy, PX, PX);
    }
    this.addParallaxLayer(stars, 0.08, 0.04);

    // 3. Pixel-Stepped Martian Sun with the signature blue halo (Parallax 0.16)
    const sun = this.add.graphics().setDepth(DEPTH.sun);
    for (const [r, col, a] of [
      [170, PAL.sunHalo, 0.07],
      [120, PAL.sunHalo, 0.12],
      [86, 0xfde68a, 0.14],
      [54, 0xfde68a, 0.24],
      [22, PAL.sunCore, 0.94],
    ] as Array<[number, number, number]>) {
      for (let dy = -r; dy <= r; dy += PX) {
        const halfW = snap(Math.sqrt(Math.max(0, r * r - dy * dy)));
        sun.fillStyle(col, a).fillRect(1440 - halfW, 165 + dy, halfW * 2, PX);
      }
    }
    this.addParallaxLayer(sun, 0.16, 0.08);

    // 4. Far Gale Crater Rim (Parallax 0.28)
    const craterRim = this.add.graphics().setDepth(DEPTH.craterRimFar);
    this.steppedRidge(
      craterRim,
      HORIZON_Y + 20,
      [
        [-120, 290], [120, 250], [340, 275], [560, 240], [820, 265],
        [1200, 255], [1480, 230], [1740, 255], [2040, 280],
      ],
      0xc9875a,
      0xe3a878,
      0.6
    );
    this.addParallaxLayer(craterRim, 0.28, 0.12);

    // 5. Aeolis Mons / Mount Sharp, layered strata (Parallax 0.48)
    const mtSharp = this.add.graphics().setDepth(DEPTH.mountSharp);
    this.strataRidge(
      mtSharp,
      HORIZON_Y + 20,
      [
        [-120, 315], [160, 285], [330, 262], [470, 246], [560, 214], [700, 190],
        [830, 150], [960, 128], [1080, 140], [1210, 196], [1340, 222],
        [1500, 258], [1700, 262], [2040, 300],
      ],
      0xe3b080,
      0.22 + (1 - dl) * 0.0,
      0.97
    );
    this.addParallaxLayer(mtSharp, 0.48, 0.2);

    // Landmark callouts ride their own parallax layers
    const sharpLabel = this.makeLandmarkLabel(
      1010, 112, 'AEOLIS MONS // MT SHARP  ~5.5 KM', 960, 128, DEPTH.mountSharp + 0.5
    );
    this.addParallaxLayer(sharpLabel, 0.48, 0.2);
    const ridgeLabel = this.makeLandmarkLabel(
      520, 280, 'VERA RUBIN RIDGE', 470, 308, DEPTH.mesaMid + 0.5
    );
    this.addParallaxLayer(ridgeLabel, 0.72, 0.3);

    // 6. Mid-Ground Hematite Mesas / Murray Buttes (Parallax 0.72)
    const mesaMid = this.add.graphics().setDepth(DEPTH.mesaMid);
    this.steppedRidge(
      mesaMid,
      HORIZON_Y + 20,
      [
        [-120, 326], [200, 298], [460, 316], [740, 288],
        [1040, 310], [1360, 292], [1640, 314], [2040, 302],
      ],
      0x7a3a1e,
      0xa05a30,
      0.98
    );
    this.addParallaxLayer(mesaMid, 0.72, 0.3);

    // 7. Near Bagnold basalt ridge (Parallax 0.92)
    const nearRidge = this.add.graphics().setDepth(DEPTH.ridgeNear);
    this.steppedRidge(
      nearRidge,
      HORIZON_Y + 24,
      [
        [-120, 338], [280, 318], [600, 334], [920, 320],
        [1300, 336], [1610, 318], [2040, 332],
      ],
      0x4a2a20,
      0x6a4234,
      1
    );
    this.addParallaxLayer(nearRidge, 0.92, 0.4);

    // Foreground Martian Terrain Plane
    this.paintBands(0, HORIZON_Y, W, H - HORIZON_Y, PAL.groundFar, PAL.groundNear, 20, DEPTH.ground);

    // Shallow Impact Craters
    const craters = this.add.graphics().setDepth(DEPTH.craters);
    for (const c of [
      { x: 640, y: 580, rx: 56, ry: 22 },
      { x: 1580, y: 620, rx: 78, ry: 30 },
      { x: 980, y: 860, rx: 62, ry: 24 },
    ]) {
      craters.fillStyle(0x5c200b, 0.85).fillEllipse(c.x, c.y, c.rx * 2.1, c.ry * 2.1);
      craters.fillStyle(0x361105, 0.92).fillEllipse(c.x, c.y + 2, c.rx * 1.6, c.ry * 1.4);
      craters.fillStyle(0xc2864f, 0.35).fillEllipse(c.x + c.rx * 0.5, c.y - c.ry * 0.6, c.rx * 0.9, c.ry * 0.3);
    }

    this.createGroundFeatures();

    // Umbilical Conduits Connecting Outpost Modules
    const conduits = this.add.graphics().setDepth(DEPTH.conduits);
    const hub = this.modules[0];
    for (const m of this.modules.slice(1)) {
      conduits.lineStyle(4, 0x1e293b, 0.85).lineBetween(hub.x, hub.y, m.x, m.y);
      conduits.lineStyle(1.5, COLOR.cyan, 0.35).lineBetween(hub.x, hub.y, m.x, m.y);
      conduits.fillStyle(0x334155, 0.95).fillRect(m.x - 6, m.y - 6, 12, 12);
      conduits.lineStyle(1.5, COLOR.cyan, 0.6).strokeRect(m.x - 6, m.y - 6, 12, 12);
    }
    conduits.fillStyle(0x334155, 0.95).fillRect(hub.x - 7, hub.y - 7, 14, 14);
    conduits.lineStyle(1.5, COLOR.cyan, 0.6).strokeRect(hub.x - 7, hub.y - 7, 14, 14);
    this.pulseGfx = this.add.graphics().setDepth(DEPTH.conduits + 1);

    // Render all 5 Outpost Structures depth-sorted by Y
    for (const m of this.modules) {
      const g = this.add.graphics({ x: m.x, y: m.y }).setDepth(m.y);
      m.draw(g);
    }

    // Static Curiosity rover landmark (decorative)
    const prop = this.add.graphics({ x: 700, y: 668 }).setDepth(668);
    drawCuriosityProp(prop);
  }

  /** Site-specific terrain referenced from Curiosity's Gale Crater traverse. */
  private createGroundFeatures() {
    const rnd = new Phaser.Math.RandomDataGenerator(['gale-ground-v1']);
    const g = this.add.graphics().setDepth(DEPTH.groundDetail);

    // Peace Vallis alluvial fan: radiating distributary channels near the habitat
    const apex = { x: 300, y: 392 };
    g.fillStyle(0xc88650, 0.12);
    fillPoly(g, [apex, { x: 620, y: 590 }, { x: 40, y: 600 }], true);
    for (let i = 0; i < 9; i++) {
      const ex = 60 + i * 70 + rnd.between(-16, 16);
      const ey = 560 + rnd.between(-20, 30);
      g.lineStyle(1.5, 0xe0a46c, 0.22).lineBetween(apex.x, apex.y, ex, ey);
    }

    // Yellowknife Bay: fractured pale-grey mudstone with white mineral veins
    g.fillStyle(PAL.bedrock, 0.78).fillEllipse(410, 862, 620, 150);
    g.fillStyle(PAL.bedrockHi, 0.55).fillEllipse(396, 852, 470, 100);
    for (let i = 0; i < 26; i++) {
      const a = rnd.realInRange(0, Math.PI * 2);
      const r = Math.sqrt(rnd.realInRange(0.05, 1));
      const px = 410 + Math.cos(a) * 270 * r;
      const py = 862 + Math.sin(a) * 60 * r;
      const ang = rnd.realInRange(0, Math.PI);
      const len = rnd.between(14, 40);
      g.lineStyle(1.5, PAL.vein, 0.4).lineBetween(
        px, py, px + Math.cos(ang) * len, py + Math.sin(ang) * len * 0.4
      );
    }
    // Drill-hole scars ("John Klein", "Cumberland")
    for (const [dx, dy] of [[520, 880], [566, 868]]) {
      g.fillStyle(0x2a1f20, 0.9).fillEllipse(dx, dy, 14, 6);
      g.lineStyle(1.5, PAL.vein, 0.6).strokeEllipse(dx, dy, 20, 9);
    }

    // Bagnold Dunes: dark basaltic crescents on the lower right
    this.drawDune(g, 1720, 690, 330, 54);
    this.drawDune(g, 1450, 905, 400, 62);
    this.drawDune(g, 1810, 880, 250, 46);
    this.drawDune(g, 1260, 760, 220, 34);

    // Scattered pebbles & boulders
    for (let i = 0; i < 90; i++) {
      const rx = rnd.between(30, W - 30);
      const ry = rnd.between(HORIZON_Y + 40, H - 120);
      const s = rnd.between(1, 3) * 2;
      g.fillStyle(0x2c0f05, 0.7).fillRect(rx, ry, s + 2, s);
      g.fillStyle(0xb9784a, 0.45).fillRect(rx, ry, s + 2, 2);
    }
    for (let i = 0; i < 12; i++) {
      const rx = rnd.between(80, W - 80);
      const ry = rnd.between(HORIZON_Y + 70, H - 140);
      g.fillStyle(0x000000, 0.28).fillEllipse(rx - 6, ry + 6, 34, 9);
      g.fillStyle(0x4a2a20).fillRoundedRect(rx - 14, ry - 12, 28, 16, 4);
      g.fillStyle(0x8b5a3c).fillRect(rx - 10, ry - 12, 20, 4);
    }

    // Curiosity wheel tracks: JPL in morse (.--- .--. .-..), lander ➜ rover
    this.drawMorseTracks(g, { x: 1230, y: 612 }, { x: 980, y: 770 }, { x: 740, y: 672 });
  }

  private drawDune(g: Gfx, cx: number, cy: number, w: number, h: number) {
    const wind: Pt[] = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      wind.push({
        x: snap(cx - w * 0.5 + t * w * 0.62, 2),
        y: snap(cy - h * 0.98 * Math.pow(Math.sin((t * Math.PI) / 2), 1.4), 2),
      });
    }
    const crest = wind[wind.length - 1];
    g.fillStyle(PAL.duneMid, 0.95);
    fillPoly(g, [...wind, { x: cx + w * 0.36, y: cy + 4 }, { x: cx - w * 0.5, y: cy + 6 }], true);
    // Leeward slip face in shadow
    g.fillStyle(PAL.duneDark, 0.95);
    fillPoly(g, [crest, { x: cx + w * 0.36, y: cy + 4 }, { x: cx + w * 0.1, y: cy + 5 }], true);
    // Crest highlight + wind ripples
    g.lineStyle(2, PAL.duneHi, 0.85);
    strokePoly(g, wind, false);
    for (let k = 1; k <= 4; k++) {
      g.lineStyle(1.2, PAL.duneHi, 0.3).lineBetween(
        cx - w * 0.42 + k * 12, cy - k * h * 0.17,
        cx + w * 0.08, cy - k * h * 0.17 + 2
      );
    }
  }

  private drawMorseTracks(g: Gfx, p0: Pt, p1: Pt, p2: Pt) {
    // Sample a quadratic Bézier, then march a morse pattern along it by arc length
    const samples: Pt[] = [];
    for (let i = 0; i <= 240; i++) {
      const t = i / 240;
      const u = 1 - t;
      samples.push({
        x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
      });
    }
    const dot: Array<[number, boolean]> = [[4, true], [5, false]];
    const dash: Array<[number, boolean]> = [[13, true], [5, false]];
    const letterGap: Array<[number, boolean]> = [[12, false]];
    const J = [...dot, ...dash, ...dash, ...dash];
    const Pp = [...dot, ...dash, ...dash, ...dot];
    const L = [...dot, ...dash, ...dot, ...dot];
    const pattern = [...J, ...letterGap, ...Pp, ...letterGap, ...L, ...letterGap, ...letterGap];

    let pi = 0;
    let remain = pattern[0][0];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      let used = 0;
      const nx = -(b.y - a.y) / (seg || 1);
      const ny = (b.x - a.x) / (seg || 1);
      while (used < seg) {
        const step = Math.min(remain, seg - used);
        if (pattern[pi][1] && step > 0) {
          const mx = a.x + ((b.x - a.x) * (used + step / 2)) / (seg || 1);
          const my = a.y + ((b.y - a.y) * (used + step / 2)) / (seg || 1);
          for (const side of [-1, 1]) {
            g.fillStyle(0x2c0f05, 0.55).fillRect(
              snap(mx + nx * 15 * side, 1) - 1, snap(my + ny * 15 * side, 1) - 1,
              Math.max(2, step), 3
            );
          }
        }
        used += step;
        remain -= step;
        if (remain <= 0.001) {
          pi = (pi + 1) % pattern.length;
          remain = pattern[pi][0];
        }
      }
    }
  }

  // ───────────────────────────── Atmosphere: Wind-Driven Dust, Haze & Alerts ─────────────────────────────

  private createAtmosphere() {
    const dl = this.dust.level;

    // Horizon haze: brightest at the horizon, fading up into the sky
    const haze = this.add.graphics().setDepth(DEPTH.groundHaze);
    for (let i = 0; i < 24; i++) {
      const dy = HORIZON_Y - 90 + i * 5;
      const peak = 1 - Math.abs(i - 17) / 17;
      haze.fillStyle(PAL.haze, Math.max(0, peak) * (0.18 + dl * 0.4)).fillRect(0, dy, W, 5);
    }
    // Soft wash that thins out on the ground just below the horizon
    for (let i = 0; i < 8; i++) {
      haze.fillStyle(PAL.haze, (0.2 + dl * 0.2) * (1 - i / 8)).fillRect(0, HORIZON_Y + 30 + i * 6, W, 6);
    }

    // Global dust veil (non-interactive)
    this.dustVeil = this.add
      .rectangle(W / 2, H / 2, W, H, PAL.dustVeil, 0.03 + dl * 0.1)
      .setDepth(DEPTH.dustVeil);

    // Wind-streaked dust particles
    this.dustGfx = this.add.graphics().setDepth(DEPTH.dust);
    const count = Math.round(70 + dl * 150);
    const rnd = new Phaser.Math.RandomDataGenerator(['gale-dust-v1']);
    for (let i = 0; i < count; i++) {
      const z = rnd.realInRange(0, 1);
      this.dustParticles.push({
        x: rnd.between(0, W),
        y: HORIZON_Y - 10 + z * (H - HORIZON_Y + 10),
        z,
        s: 2 + Math.round(z * 3) * 2 / 2,
        a: rnd.realInRange(0.12, 0.45) * (0.5 + z * 0.7),
        ph: rnd.realInRange(0, Math.PI * 2),
      });
    }

    this.devilGfx = this.add.graphics().setDepth(DEPTH.devil);

    // DONKI flare-class alert frame (M = soft pulse, X = strong pulse)
    if (this.dust.flareLetter === 'M' || this.dust.flareLetter === 'X') {
      const strong = this.dust.flareLetter === 'X';
      this.alertFrame = this.add
        .rectangle(W / 2, H / 2, W - 10, H - 10)
        .setStrokeStyle(strong ? 10 : 6, this.dust.flareColor, 1)
        .setDepth(DEPTH.alert)
        .setAlpha(0.06);
      this.tweens.add({
        targets: this.alertFrame,
        alpha: strong ? 0.28 : 0.14,
        duration: strong ? 900 : 1700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private updateAtmosphere(time: number, delta: number) {
    if (!this.dustGfx || !this.dust) return;
    const dt = delta / 1000;
    const lvl = this.dust.level;

    // Gusting wind: slow swell + faster flutter
    const gust = 0.75 + 0.25 * Math.sin(time * 0.0004) + 0.2 * Math.sin(time * 0.0013 + 1.7);
    const wind = (40 + lvl * 260) * gust;

    this.dustVeil?.setAlpha((0.03 + lvl * 0.1) * (0.85 + 0.3 * Math.sin(time * 0.0006)));

    const g = this.dustGfx;
    g.clear();
    for (const p of this.dustParticles) {
      p.x += wind * (0.35 + p.z * 0.95) * dt;
      p.y += Math.sin(time * 0.002 + p.ph) * 10 * dt;
      if (p.x > W + 40) {
        p.x = -40;
        p.y = HORIZON_Y - 10 + p.z * (H - HORIZON_Y + 10);
      }
      const streak = p.s * (1.5 + gust * lvl * 5 * (0.4 + p.z));
      g.fillStyle(PAL.dust, p.a * (0.55 + 0.45 * gust)).fillRect(
        snap(p.x, 2),
        snap(p.y, 2),
        Math.max(2, snap(streak, 2)),
        p.s > 4 ? 4 : 2
      );
    }

    this.updateDustDevil(time, dt);
  }

  private updateDustDevil(time: number, dt: number) {
    const g = this.devilGfx;
    if (!g) return;
    const d = this.devil;
    const lvl = this.dust.level;

    if (!d.active) {
      g.clear();
      if (time > d.nextAt) {
        d.active = true;
        d.dir = Math.random() < 0.5 ? 1 : -1;
        d.x = d.dir === 1 ? -120 : W + 120;
        d.y = HORIZON_Y + 34 + Math.random() * 70;
        d.h = 90 + Math.random() * 80;
      }
      return;
    }

    d.x += d.dir * (36 + lvl * 44) * dt;
    if (d.x < -160 || d.x > W + 160) {
      d.active = false;
      d.nextAt = time + (14000 + Math.random() * 16000) / (0.5 + lvl);
      g.clear();
      return;
    }

    g.clear();
    const segs = 16;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const yy = d.y - t * d.h;
      const wd = 6 + t * t * 34;
      const off = Math.sin(time * 0.006 + t * 7) * 9 * t;
      g.fillStyle(PAL.devil, 0.24 * (1 - t * 0.55)).fillRect(
        snap(d.x + off - wd / 2, 2), snap(yy, 2), snap(wd, 2), 7
      );
      g.fillStyle(0x7a4528, 0.3 * (1 - t * 0.6)).fillRect(
        snap(d.x + off - 3, 2), snap(yy, 2), 6, 7
      );
    }
    // Ground-level dust skirt
    g.fillStyle(PAL.devil, 0.2).fillEllipse(d.x, d.y + 4, 56, 12);
  }

  // ───────────────────────────── Module Beacons & Interaction Rings ─────────────────────────────

  private createModuleMarker(m: OutpostModule) {
    // Ground interaction radius ring + operational glow
    const promptRing = this.add
      .circle(m.x, m.y + 18, 46, COLOR.cyan, 0.08)
      .setStrokeStyle(1.5, COLOR.cyan, 0.45)
      .setDepth(DEPTH.conduits + 2);

    const glow = this.add
      .ellipse(m.x, m.y + 14, 280, 84, COLOR.green, 0)
      .setDepth(DEPTH.conduits + 1);

    const mx = m.x;
    const my = m.y - m.markerDy;

    const pulseRing = this.add.circle(0, 0, 20, COLOR.cyan, 0).setStrokeStyle(2, COLOR.cyan, 0.85);
    const ring = this.add.circle(0, 0, 18, COLOR.cyanDeep, 0.65).setStrokeStyle(2, COLOR.cyan);
    const pointer = this.add.triangle(0, 31, -7, -6, 7, -6, 0, 6, COLOR.cyan, 0.9);
    const iconTxt = this.add
      .text(0, 0, '!', {
        fontFamily: FONT_HEAD,
        fontSize: '15px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const labelTxt = this.add
      .text(m.x, m.y + 58, `${m.name.toUpperCase()}\n◆ ${m.locale.split(' · ')[0]}`, {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: hex(COLOR.cyan),
        backgroundColor: hex(COLOR.ink),
        padding: { x: 8, y: 3 },
        align: 'center',
        lineSpacing: 3,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.markers);

    const marker = this.add.container(mx, my, [pulseRing, ring, pointer, iconTxt]).setDepth(DEPTH.markers);

    // Gentle float so beacons read as live
    this.tweens.add({
      targets: marker,
      y: my - 6,
      duration: 1300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Generous click zone covering structure + beacon + label
    const hitZone = this.add
      .zone(m.x, m.y - m.markerDy / 2, 220, m.markerDy + 90)
      .setDepth(DEPTH.markers + 1)
      .setInteractive({ useHandCursor: true });

    hitZone.on('pointerover', () => {
      this.tweens.add({ targets: marker, scale: 1.15, duration: 120 });
      soundFx.playClick(900);
    });
    hitZone.on('pointerout', () => {
      this.tweens.add({ targets: marker, scale: 1.0, duration: 120 });
    });
    hitZone.on('pointerdown', () => {
      if (this.isModalOpen || this.time.now < this.modalCooldownUntil) return;
      soundFx.playClick(1100);
      this.walkAstronautTo(m.x, Math.min(WALK.maxY, m.y + 48), () => {
        this.openModuleModal(m);
      });
    });

    this.tweens.add({
      targets: pulseRing,
      scale: 2.1,
      alpha: { from: 0.8, to: 0 },
      duration: 1500,
      repeat: -1,
      ease: 'Sine.easeOut',
    });

    this.moduleViews.set(m.id, { marker, ring, pulseRing, iconTxt, labelTxt, promptRing, glow, pointer });
    this.refreshModuleView(m.id);
  }

  private refreshModuleView(id: string) {
    const v = this.moduleViews.get(id);
    if (!v) return;
    const done = this.isDone(id);
    const col = done ? COLOR.green : COLOR.cyan;

    v.ring.setFillStyle(done ? COLOR.greenDeep : COLOR.cyanDeep, 0.7).setStrokeStyle(2, col);
    v.iconTxt.setText(done ? '✓' : '!').setColor(done ? hex(COLOR.green) : '#ffffff');
    v.labelTxt.setColor(hex(col));
    v.promptRing.setStrokeStyle(1.5, col, 0.5);
    v.pointer.setFillStyle(col, 0.9);
    v.glow.setFillStyle(COLOR.green, done ? 0.1 : 0);

    if (done) {
      this.tweens.killTweensOf(v.pulseRing);
      v.pulseRing.setVisible(false);
    } else {
      v.pulseRing.setVisible(true);
    }
  }

  private updateNearestModuleHighlight() {
    if (!this.astronaut) return;
    let closest: OutpostModule | undefined;
    let minDist = INTERACT_RADIUS;

    for (const m of this.modules) {
      const d = Phaser.Math.Distance.Between(this.astronaut.x, this.astronaut.y, m.x, m.y + 24);
      if (d < minDist) {
        minDist = d;
        closest = m;
      }
    }

    this.nearestModule = closest;
    for (const m of this.modules) {
      const v = this.moduleViews.get(m.id);
      if (!v) continue;
      const isNear = closest?.id === m.id;
      v.promptRing.setScale(isNear ? 1.25 : 1.0);
      v.promptRing.setAlpha(isNear ? 0.95 : 0.35);
    }
  }

  // ───────────────────────────── Astronaut ─────────────────────────────

  private createAstronautCharacter() {
    const shadow = this.add.ellipse(0, 0, 44, 14, 0x000000, 0.42);
    let body: Phaser.GameObjects.GameObject;

    if (this.textures.exists('astronaut_walk')) {
      this.astroSprite = this.add.sprite(0, 0, 'astronaut_walk', 0).setOrigin(0.5, 1).setScale(1.2);
      body = this.astroSprite;
      this.setAstronautAnim('idle');
    } else {
      const g = this.add.graphics();
      g.fillStyle(0x64748b).fillRect(-18, -52, 12, 32);
      g.fillStyle(0xe2e8f0).fillRect(-10, -20, 9, 20).fillRect(3, -20, 9, 20);
      g.fillStyle(0xf8fafc).fillRect(-12, -52, 26, 32);
      g.fillStyle(0xf8fafc).fillCircle(1, -64, 13);
      g.fillStyle(0xf59e0b, 0.95).fillEllipse(5, -64, 15, 11);
      body = g;
    }

    this.astronaut = this.add.container(980, 640, [shadow, body]).setDepth(640);
  }

  private setAstronautAnim(kind: 'idle' | 'walk') {
    const key = kind === 'idle' ? 'astro_idle_anim' : 'astro_walk_anim';
    if (this.astroSprite && this.anims.exists(key)) {
      this.astroSprite.play(key, true);
    }
  }

  private walkAstronautTo(targetX: number, targetY: number, onArrival?: () => void) {
    const a = this.astronaut;
    const x = Phaser.Math.Clamp(targetX, WALK.minX, WALK.maxX);
    const y = Phaser.Math.Clamp(targetY, WALK.minY, WALK.maxY);
    const dist = Phaser.Math.Distance.Between(a.x, a.y, x, y);

    this.tweens.killTweensOf(a);

    if (dist < 8) {
      onArrival?.();
      return;
    }

    if (Math.abs(x - a.x) > 2) a.scaleX = x < a.x ? -1 : 1;
    this.setAstronautAnim('walk');

    this.tweens.add({
      targets: a,
      x,
      y,
      duration: (dist / WALK_SPEED) * 1000,
      ease: 'Linear',
      onUpdate: () => a.setDepth(a.y),
      onComplete: () => {
        a.setDepth(a.y);
        this.setAstronautAnim('idle');
        onArrival?.();
      },
    });
  }

  private pingAt(x: number, y: number) {
    const ping = this.add
      .ellipse(x, y, 18, 8, COLOR.cyan, 0)
      .setStrokeStyle(2, COLOR.cyan)
      .setDepth(DEPTH.markers - 1);
    this.tweens.add({
      targets: ping,
      scale: 3,
      alpha: 0,
      duration: 450,
      ease: 'Cubic.easeOut',
      onComplete: () => ping.destroy(),
    });
  }

  private burstAt(x: number, y: number, color = COLOR.green) {
    for (let i = 0; i < 2; i++) {
      const r = this.add.circle(x, y, 22, color, 0).setStrokeStyle(3, color).setDepth(DEPTH.markers + 2);
      this.tweens.add({
        targets: r,
        scale: 3.2 + i,
        alpha: 0,
        duration: 650 + i * 180,
        delay: i * 110,
        ease: 'Cubic.easeOut',
        onComplete: () => r.destroy(),
      });
    }
  }

  // ───────────────────────────── Top Header, [M] Map Button & NASA HUD ─────────────────────────────

  private createTopMissionHeader() {
    const isAct3 = gameState.currentChapter === 'act_3_gale_return';
    const headerTitle = isAct3
      ? 'ACT III: GALE CRATER — INGESTING ARCADIA DATA & RE-OUTFITTING LREV'
      : 'ACT I: GALE CRATER OUTPOST // COLONIZATION BASE COMMISSIONING';

    const HW = 1100;
    const header = this.add.container(W / 2, 68).setDepth(DEPTH.hud);
    const bg = this.add.rectangle(0, 0, HW, 52, COLOR.panel, 0.92).setStrokeStyle(1.5, COLOR.cyan, 0.6);
    const brackets = this.add.graphics();
    drawBrackets(brackets, 0, 0, HW + 8, 60, 14, COLOR.cyan, 0.9);

    const hText = this.add
      .text(0, -10, headerTitle, {
        fontFamily: FONT_HEAD,
        fontSize: '14px',
        color: hex(COLOR.cyan),
        letterSpacing: 2,
      })
      .setOrigin(0.5);

    this.statusBanner = this.add
      .text(0, 10, '', {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    const track = this.add.rectangle(-HW / 2 + 10, 22, HW - 20, 3, 0x1e293b).setOrigin(0, 0.5);
    this.progressFill = this.add.rectangle(-HW / 2 + 10, 22, HW - 20, 3, COLOR.cyan).setOrigin(0, 0.5);
    this.progressFill.scaleX = 0.001;

    header.add([bg, brackets, hText, this.statusBanner, track, this.progressFill]);

    // Top-Right [M] ORBITAL MAP Button
    const mapBtn = this.add
      .rectangle(W - 135, 68, 210, 40, COLOR.panel, 0.92)
      .setStrokeStyle(1.5, COLOR.cyan, 0.8)
      .setDepth(DEPTH.hud)
      .setInteractive({ useHandCursor: true });

    const mapTxt = this.add
      .text(W - 135, 68, '🛰️ [M] ORBITAL MAP', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        color: hex(COLOR.cyan),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud + 1);

    mapBtn.on('pointerover', () => mapBtn.setFillStyle(COLOR.cyanDeep, 0.6));
    mapBtn.on('pointerout', () => mapBtn.setFillStyle(COLOR.panel, 0.92));
    mapBtn.on('pointerdown', () => this.openOrbitalMap());
    void mapTxt;

    // Enhanced map button interaction (additive)
    attachUIInteraction(this, mapBtn, {
      colorTarget:    mapBtn,
      hoverFill:      COLOR.cyanDeep,
      hoverFillAlpha: 0.7,
      hoverStroke:    COLOR.cyan,
      hoverStrokeWidth: 2,
      defaultFill:    COLOR.panel,
      defaultFillAlpha: 0.92,
      defaultStroke:  COLOR.cyan,
      defaultStrokeWidth: 1.5,
      defaultStrokeAlpha: 0.8,
      soundType:      'telemetry',
      hoverScale:     1.04,
      pressScale:     0.96,
      tooltip:        'Open NASA ARES-V Orbital Reconnaissance Map for fast travel [M].',
      tooltipOffsetX: -240,
      tooltipOffsetY: 34,
      tooltipDepth:   DEPTH.hud + 50,
    });

    this.updateStatusBanner();
  }

  private updateStatusBanner() {
    const total = this.modules.length;
    const done = this.modules.filter(m => this.isDone(m.id)).length;
    const allDone = done >= total;
    const notAct3 = gameState.currentChapter !== 'act_3_gale_return';

    if (allDone) {
      this.statusBanner
        .setText('ALL GALE MODULES COMMISSIONED // MARS TREK TRAVERSE UNLOCKED')
        .setColor(hex(COLOR.green));
    } else {
      this.statusBanner
        .setText(`BASE READINESS: ${done}/${total} MODULES COMMISSIONED`)
        .setColor('#94a3b8');
    }

    this.progressFill.setFillStyle(allDone ? COLOR.green : COLOR.cyan);
    this.tweens.add({
      targets: this.progressFill,
      scaleX: Math.max(done / total, 0.001),
      duration: 450,
      ease: 'Cubic.easeOut',
    });

    this.refreshChecklist();

    if (allDone && notAct3) {
      this.showTraverseButton();
    }
  }

  private createNasaTelemetryHud() {
    const w = 340;
    const h = 210;
    const x = W - w / 2 - 30;
    const y = 112 + h / 2;

    const gale = getGaleTelemetry();
    const d = this.dust;
    const cont = this.add.container(x, y).setDepth(DEPTH.hud);
    const bg = this.add.rectangle(0, 0, w, h, COLOR.panel, 0.88).setStrokeStyle(1, COLOR.cyan, 0.5);
    const br = this.add.graphics();
    drawBrackets(br, 0, 0, w + 6, h + 6, 12, COLOR.cyan, 0.85);

    const title = this.add
      .text(-w / 2 + 14, -h / 2 + 16, 'NASA TELEMETRY // GALE', {
        fontFamily: FONT_HEAD,
        fontSize: '11px',
        color: hex(COLOR.cyan),
      })
      .setOrigin(0, 0.5);

    const solTxt = this.add
      .text(w / 2 - 14, -h / 2 + 16, `CURIOSITY SOL ${curiosityRefSol().toLocaleString('en-US')}`, {
        fontFamily: FONT_MONO,
        fontSize: '10px',
        color: hex(COLOR.amber),
      })
      .setOrigin(1, 0.5);

    const latStr = `${Math.abs(gale.lat)}°${gale.lat < 0 ? 'S' : 'N'}`;
    this.donkiHudText = this.add.text(
      -w / 2 + 14,
      -h / 2 + 36,
      `DONKI FLARE : Class ${gale.flareClass} (${gale.radiationMultiplier}x Flux)\n` +
        `MARS TREK   : ${latStr}, ${gale.lon}°E (${gale.elevationMeters}m)\n` +
        `SHARAD ICE  : ${gale.subsurfaceIceDepthM}m  |  SLOPE: ${gale.slopeDeg}°`,
      {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#cbd5e1',
        lineSpacing: 5,
      }
    );

    // Divider
    const divider = this.add.rectangle(0, -h / 2 + 100, w - 28, 1, COLOR.cyan, 0.25);

    // Atmosphere readout (dust loading derived from irradiance + DONKI)
    const atmoCol = d.level < 0.62 ? COLOR.amber : COLOR.red;
    const atmoTxt = this.add
      .text(-w / 2 + 14, -h / 2 + 116, `ATMOS : ${d.label}   τ ${d.tau}`, {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: hex(d.level < 0.4 ? COLOR.green : atmoCol),
      })
      .setOrigin(0, 0.5);

    const barG = this.add.graphics();
    const segs = 24;
    const segW = (w - 28) / segs;
    for (let i = 0; i < segs; i++) {
      const on = i / segs < d.level;
      const c = i < segs * 0.4 ? COLOR.green : i < segs * 0.75 ? COLOR.amber : COLOR.red;
      barG.fillStyle(on ? c : 0x1e293b, on ? 0.95 : 0.9).fillRect(-w / 2 + 14 + i * segW, -h / 2 + 132, segW - 2, 7);
    }

    const windTxt = this.add
      .text(-w / 2 + 14, -h / 2 + 156, `WIND   : ${d.windMs} m/s  ➜  W→E    REMS TYP: 750 Pa`, {
        fontFamily: FONT_MONO,
        fontSize: '11px',
        color: '#cbd5e1',
      })
      .setOrigin(0, 0.5);

    // Flare-class chip
    const chipW = w - 28;
    const chip = this.add
      .rectangle(0, -h / 2 + 184, chipW, 22, d.flareColor, 0.14)
      .setStrokeStyle(1, d.flareColor, 0.8);
    const chipTxt = this.add
      .text(
        0,
        -h / 2 + 184,
        `SPE WATCH: ${d.flareLetter}-CLASS ${d.flareTier}  •  ${gale.isLive ? 'LIVE FEED' : 'REFERENCE DATA'}`,
        { fontFamily: FONT_MONO, fontSize: '11px', color: hex(d.flareColor) }
      )
      .setOrigin(0.5);

    cont.add([bg, br, title, solTxt, this.donkiHudText, divider, atmoTxt, barG, windTxt, chip, chipTxt]);
  }

  /** Left-side commissioning checklist (mirrors galeCommissionedNodes; read-only). */
  private createCommissionChecklist() {
    const w = 300;
    const h = 46 + this.modules.length * 26 + 8;
    const cont = this.add.container(30 + w / 2, 112 + h / 2).setDepth(DEPTH.hud);
    const bg = this.add.rectangle(0, 0, w, h, COLOR.panel, 0.88).setStrokeStyle(1, COLOR.cyan, 0.5);
    const br = this.add.graphics();
    drawBrackets(br, 0, 0, w + 6, h + 6, 12, COLOR.cyan, 0.85);

    const title = this.add
      .text(-w / 2 + 14, -h / 2 + 16, 'OUTPOST COMMISSIONING', {
        fontFamily: FONT_HEAD,
        fontSize: '11px',
        color: hex(COLOR.cyan),
      })
      .setOrigin(0, 0.5);

    cont.add([bg, br, title]);

    this.checklistRows = [];
    this.modules.forEach((m, i) => {
      const y = -h / 2 + 46 + i * 26;
      const dot = this.add.rectangle(-w / 2 + 20, y, 8, 8, COLOR.slate);
      const name = this.add
        .text(-w / 2 + 36, y, m.short, { fontFamily: FONT_MONO, fontSize: '11px', color: '#cbd5e1' })
        .setOrigin(0, 0.5);
      const status = this.add
        .text(w / 2 - 14, y, 'PENDING', { fontFamily: FONT_MONO, fontSize: '10px', color: '#94a3b8' })
        .setOrigin(1, 0.5);
      cont.add([dot, name, status]);
      this.checklistRows.push({ dot, status });
    });

    this.refreshChecklist();
  }

  private refreshChecklist() {
    if (this.checklistRows.length === 0) return;
    this.modules.forEach((m, i) => {
      const row = this.checklistRows[i];
      if (!row) return;
      const done = this.isDone(m.id);
      row.dot.setFillStyle(done ? COLOR.green : COLOR.amber);
      row.status.setText(done ? 'ONLINE' : 'PENDING').setColor(done ? hex(COLOR.green) : hex(COLOR.amber));
    });
  }

  /** Bottom-right site map: module beacons + live astronaut position. */
  private createSiteMiniMap() {
    const w = 220;
    const h = 112;
    const cont = this.add.container(W - 30 - w / 2, 936 + h / 2).setDepth(DEPTH.hud);
    const bg = this.add.rectangle(0, 0, w, h, COLOR.panel, 0.88).setStrokeStyle(1, COLOR.cyan, 0.5);
    const br = this.add.graphics();
    drawBrackets(br, 0, 0, w + 6, h + 6, 10, COLOR.cyan, 0.85);
    const title = this.add
      .text(-w / 2 + 12, -h / 2 + 12, 'SITE MAP // GALE FLOOR', {
        fontFamily: FONT_HEAD,
        fontSize: '9px',
        color: hex(COLOR.cyan),
      })
      .setOrigin(0, 0.5);
    const mapBg = this.add.rectangle(0, 10, w - 24, 76, 0x2a1209, 0.9).setStrokeStyle(1, COLOR.slate, 0.6);
    this.miniGfx = this.add.graphics();
    cont.add([bg, br, title, mapBg, this.miniGfx]);
  }

  private updateMiniMap(time: number) {
    const g = this.miniGfx;
    if (!g || !this.astronaut) return;
    const mw = 196;
    const mh = 68;
    const tx = (x: number) => (x / W) * mw - mw / 2;
    const ty = (y: number) => ((y - 360) / 580) * mh - mh / 2 + 10;

    g.clear();
    // Dune field hint (Bagnold) + mudstone hint (Yellowknife)
    g.fillStyle(PAL.duneMid, 0.7).fillRect(tx(1250), ty(690), tx(1840) - tx(1250), ty(930) - ty(690));
    g.fillStyle(PAL.bedrockHi, 0.55).fillRect(tx(110), ty(800), tx(700) - tx(110), ty(920) - ty(800));

    for (const m of this.modules) {
      const done = this.isDone(m.id);
      const near = this.nearestModule?.id === m.id;
      const c = done ? COLOR.green : COLOR.cyan;
      g.fillStyle(c, 0.95).fillRect(tx(m.x) - 4, ty(m.y) - 4, 8, 8);
      if (near) g.lineStyle(1.5, 0xffffff, 0.9).strokeRect(tx(m.x) - 7, ty(m.y) - 7, 14, 14);
    }

    const blink = 0.55 + 0.45 * Math.sin(time * 0.008);
    g.fillStyle(COLOR.amber, blink).fillCircle(tx(this.astronaut.x), ty(this.astronaut.y), 3.5);
  }

  private createBottomControlBar() {
    const bar = this.add.container(W / 2, 1018).setDepth(DEPTH.hud);

    const items: Array<[string, string]> = [
      ['WASD / ARROWS', 'EXPLORE'],
      ['E / SPACE', 'INTERACT'],
      ['M', 'MARS TRAVEL MAP'],
      ['CLICK', 'WALK TO POINT'],
    ];

    const entries = items.map(([k, l]) => {
      const kt = this.add
        .text(0, 0, k, { fontFamily: FONT_MONO, fontSize: '11px', color: hex(COLOR.ink) })
        .setOrigin(0, 0.5);
      const lt = this.add
        .text(0, 0, l, { fontFamily: FONT_MONO, fontSize: '12px', color: '#cbd5e1' })
        .setOrigin(0, 0.5);
      return { kt, lt };
    });

    const GAP = 30;
    const totalW =
      entries.reduce((s, e) => s + (e.kt.width + 16) + 8 + e.lt.width, 0) + (entries.length - 1) * GAP;

    const bg = this.add
      .rectangle(0, 0, totalW + 48, 34, COLOR.ink, 0.92)
      .setStrokeStyle(1, COLOR.slate, 0.6);

    const nodes: Phaser.GameObjects.GameObject[] = [bg];
    let cx = -totalW / 2;
    for (const e of entries) {
      const capW = e.kt.width + 16;
      const cap = this.add.rectangle(cx + capW / 2, 0, capW, 20, COLOR.cyan, 0.92);
      e.kt.setPosition(cx + 8, 0);
      e.lt.setPosition(cx + capW + 8, 0);
      nodes.push(cap, e.kt, e.lt);
      cx += capW + 8 + e.lt.width + GAP;
    }
    bar.add(nodes);
  }

  // ───────────────────────────── Scene Transitions ─────────────────────────────

  private openOrbitalMap() {
    if (this.leaving) return;
    soundFx.playClick(1200);
    if (gameState.currentChapter === 'act_1_prologue') {
      gameState.currentChapter = 'act_2_arcadia';
      gameState.save();
    }
    this.goTo('ExpeditionMapScene');
  }

  private goTo(sceneKey: string) {
    if (this.leaving) return;
    this.leaving = true;
    this.closeModuleModal();
    this.cameras.main.fadeOut(350, 5, 10, 20);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(sceneKey);
    });
  }

  private showTraverseButton() {
    if (this.traverseBtn) return;

    const c = this.add.container(W / 2, 955).setDepth(DEPTH.hud);
    const bg = this.add
      .rectangle(-65, 0, 410, 44, COLOR.cyanDeep)
      .setStrokeStyle(2, COLOR.cyan)
      .setInteractive({ useHandCursor: true });
    const txt = this.add
      .text(-65, 0, 'LAUNCH MARS TREK TRAVERSE PLANNER ➔', {
        fontFamily: FONT_HEAD,
        fontSize: '13px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const resetBg = this.add
      .rectangle(210, 0, 110, 44, COLOR.panel)
      .setStrokeStyle(1, COLOR.slate)
      .setInteractive({ useHandCursor: true });
    const resetTxt = this.add
      .text(210, 0, '↺ RESET', {
        fontFamily: FONT_MONO,
        fontSize: '12px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    c.add([bg, txt, resetBg, resetTxt]);
    this.traverseBtn = c;

    // Attention pulse on the unlocked traverse button
    this.tweens.add({
      targets: bg,
      alpha: { from: 1, to: 0.78 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    bg.on('pointerdown', () => this.openOrbitalMap());

    // Enhanced traverse planner button interaction (additive)
    attachUIInteraction(this, bg, {
      colorTarget:    bg,
      hoverFill:      COLOR.cyan,
      hoverFillAlpha: 1,
      defaultFill:    COLOR.cyanDeep,
      hoverStroke:    COLOR.cyan,
      hoverStrokeWidth: 2.5,
      defaultStroke:  COLOR.cyan,
      defaultStrokeWidth: 2,
      soundType:      'telemetry',
      hoverScale:     1.03,
      pressScale:     0.97,
      tooltip:        'Open Mars Trek Traverse Planner to plan your next expedition route.',
      tooltipOffsetX: 24,
      tooltipOffsetY: -40,
      tooltipDepth:   DEPTH.hud + 50,
    });

    resetBg.on('pointerdown', () => {
      soundFx.playClick(800);
      gameState.galeCommissionedNodes = [];
      gameState.currentChapter = 'act_1_prologue';
      gameState.save();
      this.traverseBtn?.destroy();
      this.traverseBtn = undefined;
      this.modules.forEach(m => this.refreshModuleView(m.id));
      this.updateStatusBanner();
      this.toast('OUTPOST MODULES RESET TO 0/5', COLOR.cyan);
    });

    // Enhanced reset button interaction (additive)
    attachUIInteraction(this, resetBg, {
      colorTarget:    resetBg,
      hoverFill:      COLOR.slate,
      defaultFill:    COLOR.panel,
      hoverStroke:    COLOR.steel,
      hoverStrokeWidth: 1.5,
      defaultStroke:  COLOR.slate,
      defaultStrokeWidth: 1,
      soundType:      'warning',
      hoverScale:     1.04,
      pressScale:     0.96,
      tooltip:        'Reset all 5 outpost modules. Progress will be lost.',
      tooltipOffsetX: -160,
      tooltipOffsetY: -40,
      tooltipDepth:   DEPTH.hud + 50,
    });
  }

  private createAct3Upgrades() {
    const cont = this.add.container(W / 2, 955).setDepth(DEPTH.hud);
    const bg = this.add.rectangle(0, 0, 860, 56, COLOR.panel, 0.95).setStrokeStyle(2, COLOR.green);
    const txt = this.add
      .text(-400, 0, 'ACT III: UPLOAD ARCADIA WATER DATA & PREP JEZERO EXPEDITION', {
        fontFamily: FONT_HEAD,
        fontSize: '12px',
        color: hex(COLOR.green),
      })
      .setOrigin(0, 0.5);

    const btn = this.add
      .rectangle(300, 0, 210, 36, COLOR.greenDeep)
      .setStrokeStyle(1, 0xffffff)
      .setInteractive({ useHandCursor: true });
    const btnTxt = this.add
      .text(300, 0, 'SYNTHESIZE & PROCEED', {
        fontFamily: FONT_HEAD,
        fontSize: '11px',
        color: hex(COLOR.ink),
      })
      .setOrigin(0.5);

    btn.on('pointerdown', () => {
      soundFx.playTelemetryChirp();
      gameState.arcadiaWaterFiltered = true;
      gameState.resources.airReserve = 100;
      gameState.resources.power = 100;
      gameState.resources.waterReserve = 100;
      gameState.currentChapter = 'act_4_jezero';
      gameState.save();
      this.goTo('ExpeditionMapScene');
    });

    cont.add([bg, txt, btn, btnTxt]);
  }

  private toast(message: string, color = COLOR.green) {
    this.toastText?.destroy();
    const t = this.add
      .text(W / 2, 130, message, {
        fontFamily: FONT_MONO,
        fontSize: '13px',
        color: hex(color),
        backgroundColor: hex(COLOR.ink),
        padding: { x: 14, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.toast);
    this.toastText = t;

    this.tweens.add({
      targets: t,
      alpha: { from: 1, to: 0 },
      y: 118,
      delay: 1800,
      duration: 300,
      onComplete: () => {
        t.destroy();
        if (this.toastText === t) this.toastText = undefined;
      },
    });
  }
}