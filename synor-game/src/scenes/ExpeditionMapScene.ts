/**
 * Interactive NASA Mars Trek Traverse Planner Scene
 * Simulates multi-week autonomous LREV rover expeditions across real Martian coordinates.
 * Features Great-Circle pathing, cargo depots, hill-shaded MOLA-style terrain with craters,
 * volcanoes, basins and landing sites, switchable map layers, distance telemetry,
 * and continuous in-game background music.
 *
 * NOTE: Only UI / presentation was changed. Mission routing, distance maths,
 * traverse timing, scene transitions and gameState handling are untouched.
 */

import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import {
  MARS_SITES,
  CARGO_DEPOTS,
  projectMarsToCanvas,
  projectCanvasToMars,
  calculateTraverseDistanceKm,
  getTraverseWaypoints,
  MarsCoord
} from '../utils/MarsGeo';
import { ProceduralGraphics } from '../utils/ProceduralGraphics';
import { attachBlenderSceneSlot } from '../utils/BlenderSceneBridge';
import { soundFx } from '../utils/ProceduralAudio';
import { audioManager } from '../state/AudioManager';
import { attachUIInteraction } from '../utils/UIInteraction';
import { getTerrainAtCoordinate, TerrainTelemetry } from '../utils/PlanetaryTelemetry';
import { transitionToScene, fadeSceneIn } from '../utils/SceneTransition';

/* ========================================================================= */
/*  TERRAIN RENDERER (procedural MOLA-style relief + real feature catalogue)  */
/* ========================================================================= */
/**
 * MarsTerrainRenderer
 * Generates a hill-shaded Martian relief map as Phaser canvas textures, plus the
 * catalogue of real named features (volcanoes, basins, craters, canyons, landers).
 *
 * Real feature coordinates (IAU / USGS Gazetteer of Planetary Nomenclature, east
 * longitude 0-360) drive the relief model, so Olympus Mons, Hellas, Valles
 * Marineris, Gale, Jezero etc. sit where they sit on the real planet.
 *
 * Two flat, 2D navigation-style layers are produced from ONE elevation model:
 *   - `<prefix>_real` : terrain classes (brown -> orange -> yellow -> beige), topo outlines, crater rings
 *   - `<prefix>_mola` : smooth elevation gradient in the same palette with 2 km contour lines
 *
 * If you drop a real NASA Mars Trek / MOLA equirectangular image in the game
 * assets, the scene will use it automatically as a third layer.
 */


export type FeatureKind = 'volcano' | 'crater' | 'basin' | 'canyon' | 'region' | 'lander' | 'cap';

export interface MarsFeature {
  name: string;
  lat: number;
  lonE: number; // east longitude, 0-360
  kind: FeatureKind;
  info: string;
  major?: boolean;
  diameterKm?: number;
}

export const MARS_FEATURES: MarsFeature[] = [
  // Volcanoes
  { name: 'Olympus Mons', lat: 18.65, lonE: 226.2, kind: 'volcano', major: true, info: 'SHIELD VOLCANO // ~600 KM WIDE, ~22 KM HIGH' },
  { name: 'Ascraeus Mons', lat: 11.8, lonE: 255.5, kind: 'volcano', info: 'THARSIS MONTES' },
  { name: 'Pavonis Mons', lat: 0.8, lonE: 247.2, kind: 'volcano', info: 'THARSIS MONTES' },
  { name: 'Arsia Mons', lat: -8.3, lonE: 239.9, kind: 'volcano', info: 'THARSIS MONTES' },
  { name: 'Alba Mons', lat: 40.5, lonE: 250.4, kind: 'volcano', info: 'BROAD, LOW-RELIEF SHIELD VOLCANO' },
  { name: 'Elysium Mons', lat: 25.0, lonE: 147.2, kind: 'volcano', info: 'ELYSIUM VOLCANIC PROVINCE' },

  // Impact basins
  { name: 'Hellas Planitia', lat: -42.7, lonE: 70.0, kind: 'basin', major: true, info: 'IMPACT BASIN // ~2,300 KM WIDE, LOWEST ELEVATIONS ON MARS' },
  { name: 'Argyre Planitia', lat: -49.7, lonE: 316.0, kind: 'basin', major: true, info: 'IMPACT BASIN // ~1,800 KM WIDE' },
  { name: 'Isidis Planitia', lat: 12.9, lonE: 87.0, kind: 'basin', major: true, info: 'IMPACT BASIN // ~1,500 KM WIDE' },

  // Craters (diameterKm is used to stamp real relief)
  { name: 'Schiaparelli', lat: -3.0, lonE: 343.3, kind: 'crater', info: 'IMPACT CRATER // ~460 KM', diameterKm: 460 },
  { name: 'Huygens', lat: -13.9, lonE: 55.5, kind: 'crater', info: 'IMPACT CRATER // ~470 KM', diameterKm: 470 },
  { name: 'Herschel', lat: -14.5, lonE: 130.2, kind: 'crater', info: 'IMPACT CRATER // ~300 KM', diameterKm: 300 },
  { name: 'Gusev', lat: -14.5, lonE: 175.4, kind: 'crater', info: 'IMPACT CRATER // ~165 KM // SPIRIT ROVER SITE', diameterKm: 165 },
  { name: 'Lyot', lat: 50.5, lonE: 29.3, kind: 'crater', info: 'IMPACT CRATER // ~220 KM', diameterKm: 220 },
  { name: 'Cassini', lat: 23.5, lonE: 32.0, kind: 'crater', info: 'IMPACT CRATER // ~415 KM', diameterKm: 415 },
  { name: 'Korolev', lat: 73.0, lonE: 165.0, kind: 'crater', info: 'ICE-FILLED CRATER // ~82 KM', diameterKm: 82 },
  { name: 'Galle', lat: -51.9, lonE: 329.2, kind: 'crater', info: "IMPACT CRATER // ~230 KM // 'HAPPY FACE'", diameterKm: 230 },
  { name: 'Holden', lat: -26.4, lonE: 325.1, kind: 'crater', info: 'IMPACT CRATER // ~140 KM', diameterKm: 140 },
  { name: 'Eberswalde', lat: -24.0, lonE: 326.5, kind: 'crater', info: 'ANCIENT RIVER DELTA // ~65 KM', diameterKm: 65 },
  { name: 'Hale', lat: -35.7, lonE: 323.6, kind: 'crater', info: 'IMPACT CRATER // ~125 KM', diameterKm: 125 },

  // Canyons
  { name: 'Valles Marineris', lat: -13.0, lonE: 301.0, kind: 'canyon', major: true, info: 'CANYON SYSTEM // ~4,000 KM LONG, UP TO ~7 KM DEEP' },
  { name: 'Noctis Labyrinthus', lat: -7.0, lonE: 264.0, kind: 'canyon', info: 'LABYRINTH OF INTERSECTING VALLEYS' },

  // Regions
  { name: 'Syrtis Major', lat: 8.4, lonE: 69.5, kind: 'region', info: 'DARK VOLCANIC PLATEAU' },
  { name: 'Utopia Planitia', lat: 46.7, lonE: 117.5, kind: 'region', info: 'VAST NORTHERN LOWLAND PLAIN' },
  { name: 'Chryse Planitia', lat: 28.0, lonE: 320.0, kind: 'region', info: 'OUTFLOW-CHANNEL BASIN' },
  { name: 'Acidalia Planitia', lat: 46.0, lonE: 339.0, kind: 'region', info: 'NORTHERN LOWLAND PLAIN' },
  { name: 'Arabia Terra', lat: 21.0, lonE: 6.0, kind: 'region', info: 'ANCIENT CRATERED HIGHLANDS' },
  { name: 'Amazonis Planitia', lat: 25.0, lonE: 197.0, kind: 'region', info: 'SMOOTH YOUNG LOWLAND PLAIN' },
  { name: 'Solis Planum', lat: -26.0, lonE: 270.0, kind: 'region', info: 'VOLCANIC PLATEAU' },
  { name: 'Terra Cimmeria', lat: -35.0, lonE: 145.0, kind: 'region', info: 'SOUTHERN CRATERED HIGHLANDS' },
  { name: 'Tempe Terra', lat: 40.0, lonE: 290.0, kind: 'region', info: 'NORTHERN HIGHLAND PLATEAU' },

  // Landers / rovers (Curiosity + Perseverance come from MARS_SITES)
  { name: 'Viking 1', lat: 22.27, lonE: 312.05, kind: 'lander', info: 'NASA LANDER // 1976' },
  { name: 'Viking 2', lat: 47.64, lonE: 134.26, kind: 'lander', info: 'NASA LANDER // 1976' },
  { name: 'Pathfinder', lat: 19.13, lonE: 326.75, kind: 'lander', info: 'NASA LANDER + SOJOURNER ROVER // 1997' },
  { name: 'Opportunity', lat: -1.95, lonE: 354.47, kind: 'lander', info: 'NASA ROVER // MERIDIANI PLANUM' },
  { name: 'Phoenix', lat: 68.22, lonE: 234.25, kind: 'lander', info: 'NASA LANDER // NORTHERN ARCTIC PLAINS' },
  { name: 'InSight', lat: 4.5, lonE: 135.62, kind: 'lander', info: 'NASA LANDER // ELYSIUM PLANITIA' },
  { name: 'Zhurong', lat: 25.1, lonE: 109.9, kind: 'lander', info: 'CNSA ROVER // UTOPIA PLANITIA' },

  // Polar caps
  { name: 'Planum Boreum', lat: 84.5, lonE: 90.0, kind: 'cap', info: 'NORTH POLAR LAYERED DEPOSITS' },
  { name: 'Planum Australe', lat: -85.0, lonE: 90.0, kind: 'cap', info: 'SOUTH POLAR LAYERED DEPOSITS' }
];

/** Craters stamped into the relief but not labelled (they already exist as MARS_SITES). */
const STAMP_ONLY_CRATERS = [
  { lat: -5.4, lonE: 137.8, d: 154, peak: 0.95 }, // Gale (Aeolis Mons mound)
  { lat: 18.4, lonE: 77.7, d: 45, peak: 0 }       // Jezero
];

/* ------------------------------------------------------------------------- */
/*  Longitude convention helper (works with 0..360 or -180..180 projections)  */
/* ------------------------------------------------------------------------- */

let lonMode: '360' | '180' | null = null;

export function eastLonToProjection(lonE: number, w: number, h: number): number {
  if (!lonMode) {
    const probe = projectMarsToCanvas(0, 190, w, h);
    lonMode = probe.x >= 0 && probe.x <= w ? '360' : '180';
  }
  const l = ((lonE % 360) + 360) % 360;
  return lonMode === '360' ? l : (l > 180 ? l - 360 : l);
}

/* ------------------------------------------------------------------------- */
/*  Colour ramps                                                              */
/* ------------------------------------------------------------------------- */

const MOLA_STOPS: Array<[number, number, number, number]> = [
  [-8, 61, 32, 18],
  [-4, 107, 58, 30],
  [-1, 150, 84, 38],
  [1, 201, 124, 52],
  [3, 224, 160, 72],
  [6, 238, 196, 96],
  [11, 244, 218, 140],
  [16, 246, 232, 180],
  [21, 252, 246, 225]
];

export function molaColorRGB(km: number): [number, number, number] {
  if (km <= MOLA_STOPS[0][0]) return [MOLA_STOPS[0][1], MOLA_STOPS[0][2], MOLA_STOPS[0][3]];
  for (let i = 1; i < MOLA_STOPS.length; i++) {
    const a = MOLA_STOPS[i - 1];
    const b = MOLA_STOPS[i];
    if (km <= b[0]) {
      const t = (km - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  const last = MOLA_STOPS[MOLA_STOPS.length - 1];
  return [last[1], last[2], last[3]];
}

export function molaColorHex(km: number): number {
  const [r, g, b] = molaColorRGB(km);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** Flat terrain classes for the 2D navigation layer (warm palette: brown -> orange -> yellow -> beige). */
export const BANDS: Array<{ max: number; rgb: [number, number, number]; name: string }> = [
  { max: -6, rgb: [61, 32, 18], name: 'DEEP BASIN' },
  { max: -4, rgb: [92, 51, 26], name: 'BASIN FLOOR' },
  { max: -2, rgb: [128, 70, 34], name: 'NORTHERN PLAINS' },
  { max: 0, rgb: [166, 94, 44], name: 'LOWLANDS' },
  { max: 1.5, rgb: [201, 124, 52], name: 'TRANSITION ZONE' },
  { max: 3, rgb: [224, 160, 72], name: 'CRATERED HIGHLANDS' },
  { max: 5, rgb: [238, 196, 96], name: 'ELEVATED HIGHLANDS' },
  { max: 9, rgb: [244, 218, 140], name: 'VOLCANIC RISE' },
  { max: 14, rgb: [236, 214, 172], name: 'VOLCANIC FLANKS' },
  { max: 99, rgb: [250, 240, 215], name: 'SUMMITS' }
];
export const ICE_RGB: [number, number, number] = [255, 255, 250];

/* ------------------------------------------------------------------------- */
/*  Noise                                                                     */
/* ------------------------------------------------------------------------- */

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(u: number, v: number, period: number, seed: number): number {
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = u - iu;
  const fv = v - iv;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const x0 = ((iu % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const a = hash2(x0, iv, seed);
  const b = hash2(x1, iv, seed);
  const c = hash2(x0, iv + 1, seed);
  const d = hash2(x1, iv + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Longitude-periodic fractal noise, 0..1 */
function fbm(lonE: number, lat: number, octaves: number, baseCells: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise((lonE / 360) * cells, ((lat + 90) / 180) * (cells / 2), cells, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    cells *= 2;
  }
  return sum / norm;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

const DEG = Math.PI / 180;
const KM_PER_DEG = 59.17;

/* ------------------------------------------------------------------------- */
/*  Generator                                                                 */
/* ------------------------------------------------------------------------- */

interface Bump {
  lat: number;
  lonE: number;
  amp: number;
  sigma: number;
  p?: number;      // >1 = flat-bottomed
  ringR?: number;  // ring uplift radius (deg)
  ringW?: number;
  ringAmp?: number;
}

const BUMPS: Bump[] = [
  // Tharsis rise + volcanoes
  { lat: 1, lonE: 250, amp: 5.0, sigma: 22 },
  { lat: 18.65, lonE: 226.2, amp: 17, sigma: 3.0 },
  { lat: 18.65, lonE: 226.2, amp: -1.4, sigma: 0.7 },
  { lat: 11.8, lonE: 255.5, amp: 9.0, sigma: 1.7 },
  { lat: 11.8, lonE: 255.5, amp: -0.9, sigma: 0.5 },
  { lat: 0.8, lonE: 247.2, amp: 7.5, sigma: 1.6 },
  { lat: 0.8, lonE: 247.2, amp: -0.8, sigma: 0.5 },
  { lat: -8.3, lonE: 239.9, amp: 8.0, sigma: 2.0 },
  { lat: -8.3, lonE: 239.9, amp: -0.9, sigma: 0.6 },
  { lat: 40.5, lonE: 250.4, amp: 4.5, sigma: 6 },
  // Elysium
  { lat: 22, lonE: 150, amp: 3.0, sigma: 9 },
  { lat: 25.0, lonE: 147.2, amp: 9.0, sigma: 2.2 },
  { lat: 25.0, lonE: 147.2, amp: -0.8, sigma: 0.5 },
  { lat: 32.2, lonE: 150.2, amp: 3.0, sigma: 1.3 },
  { lat: 18.8, lonE: 150.4, amp: 2.5, sigma: 1.2 },
  // Basins (flat floors + raised rims)
  { lat: -42.7, lonE: 70, amp: -8.5, sigma: 11, p: 2, ringR: 19, ringW: 3, ringAmp: 2.5 },
  { lat: -49.7, lonE: 316, amp: -5.0, sigma: 7.5, p: 2, ringR: 13, ringW: 2.2, ringAmp: 1.8 },
  { lat: 12.9, lonE: 87, amp: -3.8, sigma: 7, p: 2, ringR: 11, ringW: 2, ringAmp: 1.5 },
  { lat: 46, lonE: 117, amp: -3.2, sigma: 14, p: 2 },
  { lat: 28, lonE: 320, amp: -1.5, sigma: 9 },
  { lat: 46, lonE: 340, amp: -1.5, sigma: 12 },
  { lat: 8.4, lonE: 69.5, amp: 1.0, sigma: 5 }
];

const DARK_SPOTS: Array<{ lat: number; lonE: number; sigma: number; strength: number }> = [
  { lat: 8.4, lonE: 69.5, sigma: 5, strength: 1.0 },   // Syrtis Major
  { lat: 46, lonE: 340, sigma: 12, strength: 0.7 },    // Acidalia
  { lat: -2, lonE: 0, sigma: 9, strength: 0.6 },       // Sinus Meridiani
  { lat: -35, lonE: 200, sigma: 9, strength: 0.6 },    // Mare Sirenum
  { lat: -35, lonE: 150, sigma: 8, strength: 0.6 },    // Mare Cimmerium
  { lat: -20, lonE: 100, sigma: 7, strength: 0.5 },    // Mare Tyrrhenum
  { lat: 20, lonE: 40, sigma: 6, strength: 0.4 },
  { lat: 25, lonE: 197, sigma: 10, strength: 0.35 }
];

const VALLES: Array<[number, number]> = [[-7, 262], [-9, 274], [-10, 284], [-12, 295], [-13, 306], [-10, 315], [-6, 322]];

export function generateMarsTerrainTextures(
  scene: Phaser.Scene,
  prefix: string,
  width: number,
  height: number,
  supersample = 1.5
): { real: string; mola: string } {
  const realKey = `${prefix}_real`;
  const molaKey = `${prefix}_mola`;
  if (scene.textures.exists(realKey) && scene.textures.exists(molaKey)) {
    return { real: realKey, mola: molaKey };
  }

  const W = Math.round(width * supersample);
  const H = Math.round(height * supersample);
  const N = W * H;

  // Per-row latitude / per-column east-longitude straight from the game's own projection.
  const lat = new Float32Array(H);
  const cosLat = new Float32Array(H);
  const lon = new Float32Array(W);
  for (let y = 0; y < H; y++) {
    const p = projectCanvasToMars(0, (y + 0.5) / supersample, width, height);
    lat[y] = p.lat;
    cosLat[y] = Math.cos(p.lat * DEG);
  }
  for (let x = 0; x < W; x++) {
    const p = projectCanvasToMars((x + 0.5) / supersample, 0, width, height);
    lon[x] = ((p.lon % 360) + 360) % 360;
  }
  const lat0 = lat[0];
  const latStep = lat[1] - lat[0] || -180 / H;
  const lon0 = lon[0];
  let lonStep = ((lon[1] - lon[0] + 540) % 360) - 180;
  if (!lonStep) lonStep = 360 / W;

  const elev = new Float32Array(N);
  const dark = new Float32Array(N);
  const craterMask = new Uint8Array(N); // 1 = floor, 2 = rim outline

  /** Visit every pixel within rDeg of (latC, lonC). */
  const win = (latC: number, lonC: number, rDeg: number, fn: (i: number, dx: number, dy: number) => void) => {
    const yc = (latC - lat0) / latStep;
    const ry = Math.ceil(rDeg / Math.abs(latStep)) + 1;
    const y1 = Math.max(0, Math.floor(yc - ry));
    const y2 = Math.min(H - 1, Math.ceil(yc + ry));
    const xc = Math.round((((lonC - lon0) / lonStep) % W + W) % W);
    for (let y = y1; y <= y2; y++) {
      const cl = Math.max(0.05, cosLat[y]);
      const rx = Math.min(W >> 1, Math.ceil(rDeg / (cl * Math.abs(lonStep))) + 1);
      for (let k = -rx; k <= rx; k++) {
        const x = (((xc + k) % W) + W) % W;
        let dl = lon[x] - lonC;
        dl = ((dl + 540) % 360) - 180;
        fn(y * W + x, dl * cl, lat[y] - latC);
      }
    }
  };

  /* 1. Base crust: hemispheric dichotomy + multi-scale noise ---------------- */
  const colBoundary = new Float32Array(W);
  for (let x = 0; x < W; x++) colBoundary[x] = 5 + 25 * Math.cos((lon[x] - 5) * DEG);

  for (let y = 0; y < H; y++) {
    const la = lat[y];
    for (let x = 0; x < W; x++) {
      const lo = lon[x];
      const t = smoothstep(-1, 1, (la - colBoundary[x]) / 9);
      const base = 1.3 - 3.9 * t;
      const large = (fbm(lo, la, 5, 6, 11) - 0.5) * 3.0 * (1 - 0.45 * t);
      const detail = (fbm(lo, la, 3, 140, 23) - 0.5) * 0.35 * (1 - 0.3 * t);
      elev[y * W + x] = base + large + detail;
    }
  }

  /* 2. Large-scale landforms ------------------------------------------------ */
  for (const b of BUMPS) {
    const p = b.p ?? 1;
    const s2 = 2 * b.sigma * b.sigma;
    const reach = Math.max(b.sigma * 3.5, (b.ringR ?? 0) + (b.ringW ?? 0) * 3);
    win(b.lat, b.lonE, reach, (i, dx, dy) => {
      const r2 = dx * dx + dy * dy;
      let h = b.amp * Math.exp(-Math.pow(r2 / s2, p));
      if (b.ringR) {
        const r = Math.sqrt(r2);
        const q = (r - b.ringR) / (b.ringW ?? 2);
        h += (b.ringAmp ?? 1) * Math.exp(-q * q);
      }
      elev[i] += h;
    });
  }

  // Valles Marineris trench
  VALLES.forEach((pt, si) => {
    if (si === VALLES.length - 1) return;
    const nxt = VALLES[si + 1];
    const steps = Math.ceil(Math.hypot(nxt[0] - pt[0], nxt[1] - pt[1]) / 0.7);
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      const la = pt[0] + (nxt[0] - pt[0]) * f;
      const lo = pt[1] + (nxt[1] - pt[1]) * f;
      const overall = (si + f) / (VALLES.length - 1);
      const sigma = 0.9 + 0.9 * Math.sin(Math.PI * overall);
      const s2 = 2 * sigma * sigma;
      win(la, lo, sigma * 3.2, (i, dx, dy) => {
        elev[i] += -1.15 * Math.exp(-(dx * dx + dy * dy) / s2);
      });
    }
  });

  /* 3. Impact craters ------------------------------------------------------- */
  const stamp = (latC: number, lonC: number, dKm: number, depthScale: number, peakScale: number) => {
    const R = dKm / 2 / KM_PER_DEG;
    const depth = clamp(0.028 * dKm, 0.25, 6) * depthScale;
    const rim = Math.max(0.05, 0.22 * depth);
    const maskable = dKm >= 45;
    const rimW = Math.max(0.07, 0.9 / (R / Math.abs(latStep)));
    win(latC, lonC, R * 2.3, (i, dx, dy) => {
      const d = Math.sqrt(dx * dx + dy * dy) / R;
      if (d >= 2.3) return;
      if (maskable) {
        if (Math.abs(d - 1) <= rimW) craterMask[i] = 2;
        else if (d < 1 && craterMask[i] === 0) craterMask[i] = 1;
      }
      let h: number;
      if (d < 1) {
        h = -depth * (1 - d * d);
        h += rim * Math.exp(-Math.pow((d - 1) / 0.13, 2));
        if (peakScale > 0) h += peakScale * depth * Math.exp(-Math.pow(d / 0.16, 2));
      } else {
        h = rim * Math.exp(-Math.pow((d - 1) / 0.13, 2)) + 0.06 * depth * Math.exp(-(d - 1) / 0.7);
      }
      elev[i] += h;
    });
  };

  const rand = mulberry32(1337);
  const CRATER_COUNT = 1900;
  for (let n = 0; n < CRATER_COUNT; n++) {
    const la = Math.asin(rand() * 2 - 1) / DEG;
    const lo = rand() * 360;
    const boundary = 5 + 25 * Math.cos((lo - 5) * DEG);
    const north = la > boundary + 4;
    let accept = north ? 0.28 : 1;
    if (la > -35 && la < 45 && lo > 215 && lo < 275) accept *= 0.2; // young Tharsis lavas
    if (rand() > accept) continue;
    const u = Math.max(rand(), 0.002);
    const d = Math.min(380, 24 / Math.pow(u, 1 / 1.8));
    stamp(la, lo, d, 0.4 + rand() * 0.6, d > 40 ? 0.3 : 0);
  }
  for (const f of MARS_FEATURES) {
    if (f.kind === 'crater' && f.diameterKm) stamp(f.lat, f.lonE, f.diameterKm, 1, 0.3);
  }
  for (const c of STAMP_ONLY_CRATERS) stamp(c.lat, c.lonE, c.d, 1, c.peak || 0.3);

  /* 4. Albedo regions ------------------------------------------------------- */
  for (const d of DARK_SPOTS) {
    const s2 = 2 * d.sigma * d.sigma;
    win(d.lat, d.lonE, d.sigma * 3.2, (i, dx, dy) => {
      dark[i] = Math.min(1, dark[i] + d.strength * Math.exp(-(dx * dx + dy * dy) / s2));
    });
  }

  /* 5. Classify, contour + colourise (flat 2D navigation style) ------------- */
  const realImg = new ImageData(W, H);
  const molaImg = new ImageData(W, H);
  const rp = realImg.data;
  const mp = molaImg.data;

  const bandArr = new Uint8Array(N);
  const contourArr = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    const e = elev[i];
    let b = BANDS.length - 1;
    for (let k = 0; k < BANDS.length; k++) {
      if (e < BANDS[k].max) { b = k; break; }
    }
    bandArr[i] = b;
    contourArr[i] = Math.floor(e / 2);
  }

  const pxKm = (2 * Math.PI * 3396.2) / W;
  const VE = 9;
  const L = [-0.5, -0.5, 0.7];
  const Ll = Math.hypot(L[0], L[1], L[2]);
  const Lx = L[0] / Ll, Ly = L[1] / Ll, Lz = L[2] / Ll;

  for (let y = 0; y < H; y++) {
    const ym = y > 0 ? y - 1 : y;
    const yp = y < H - 1 ? y + 1 : y;
    const sx = 2 * pxKm * Math.max(cosLat[y], 0.3);
    const sy = Math.max(1, yp - ym) * pxKm;
    const la = lat[y];
    const absLa = Math.abs(la);

    for (let x = 0; x < W; x++) {
      const xm = x > 0 ? x - 1 : W - 1;
      const xp = x < W - 1 ? x + 1 : 0;
      const i = y * W + x;
      const iL = y * W + xm, iR = y * W + xp, iU = ym * W + x, iD = yp * W + x;
      const lo = lon[x];
      const e = elev[i];

      const dzdx = (elev[iR] - elev[iL]) / sx;
      const dzdy = (elev[iD] - elev[iU]) / sy;
      const nx = -dzdx * VE;
      const ny = -dzdy * VE;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const lit = ((nx * Lx + ny * Ly + Lz) * inv) / Lz;

      let ice = 0;
      if (absLa > 74) {
        const n = fbm(lo, la, 3, 24, 57) - 0.5;
        const edge = la > 0 ? 82 + n * 7 : 83.5 + n * 6;
        ice = smoothstep(edge - 1.0, edge + 0.6, absLa);
      }
      const cm = craterMask[i];
      const o = i * 4;

      // --- Terrain classes: flat fills, topo outlines, 3-step cel shading
      {
        const bi = bandArr[i];
        const band = BANDS[bi];
        const cel = lit < 0.8 ? 0.85 : lit > 1.2 ? 1.12 : 1;
        const tint = 1 - 0.2 * dark[i];
        let r = band.rgb[0] * cel * tint;
        let g = band.rgb[1] * cel * tint;
        let b = band.rgb[2] * cel * tint;
        if (bi !== bandArr[iL] || bi !== bandArr[iR] || bi !== bandArr[iU] || bi !== bandArr[iD]) {
          r *= 0.74; g *= 0.74; b *= 0.74;
        }
        if (cm === 2) { r *= 0.6; g *= 0.6; b *= 0.6; }
        else if (cm === 1) { r *= 0.94; g *= 0.94; b *= 0.94; }
        if (ice > 0) {
          r += (ICE_RGB[0] - r) * ice * 0.95;
          g += (ICE_RGB[1] - g) * ice * 0.95;
          b += (ICE_RGB[2] - b) * ice * 0.95;
        }
        rp[o] = r; rp[o + 1] = g; rp[o + 2] = b; rp[o + 3] = 255;
      }

      // --- Elevation gradient: smooth palette ramp + 2 km contour lines
      {
        const [cr, cg, cb] = molaColorRGB(e);
        const mm = 0.92 + 0.08 * clamp(lit, 0.6, 1.4);
        let r = cr * mm, g = cg * mm, b = cb * mm;
        const c = contourArr[i];
        if (c !== contourArr[iL] || c !== contourArr[iR] || c !== contourArr[iU] || c !== contourArr[iD]) {
          r *= 0.8; g *= 0.8; b *= 0.8;
        }
        if (cm === 2) { r *= 0.65; g *= 0.65; b *= 0.65; }
        else if (cm === 1) { r *= 0.95; g *= 0.95; b *= 0.95; }
        if (ice > 0) {
          r += (ICE_RGB[0] - r) * ice * 0.8;
          g += (ICE_RGB[1] - g) * ice * 0.8;
          b += (ICE_RGB[2] - b) * ice * 0.8;
        }
        mp[o] = r; mp[o + 1] = g; mp[o + 2] = b; mp[o + 3] = 255;
      }
    }
  }

  const make = (key: string, img: ImageData) => {
    const tex = scene.textures.createCanvas(key, W, H);
    if (!tex) return;
    tex.getContext().putImageData(img, 0, 0);
    tex.refresh();
  };
  make(realKey, realImg);
  make(molaKey, molaImg);

  return { real: realKey, mola: molaKey };
}

/* ========================================================================= */
/*  SCENE                                                                    */
/* ========================================================================= */

/** Optional real NASA texture (MOLA colorized shaded relief, equirectangular, full globe). */
const NASA_TEXTURE_KEY = 'mars_mola_nasa';
const NASA_TEXTURE_PATH = 'assets/maps/mars_mola_color_relief.jpg';

const KIND_COLOR: Record<FeatureKind, string> = {
  volcano: '#fca5a5',
  crater: '#f8fafc',
  basin: '#7dd3fc',
  canyon: '#fdba74',
  region: '#e2e8f0',
  lander: '#fde047',
  cap: '#e0f2fe'
};

interface PanelButton {
  setActive: (active: boolean) => void;
}

interface PlacedFeature {
  feature: MarsFeature;
  x: number; // local map coords
  y: number;
}

/** Kid-friendly fun facts shown when a landmark is hovered / clicked. */
const FEATURE_FACTS: Record<string, string> = {
  'Olympus Mons': 'The tallest volcano in the whole solar system, about 2.5 times taller than Mount Everest!',
  'Ascraeus Mons': 'One of three giant volcanoes in a row called the Tharsis Montes.',
  'Pavonis Mons': 'This giant volcano sits almost exactly on the Martian equator.',
  'Arsia Mons': 'It has a crater at the top, called a caldera, that is about 110 km wide!',
  'Alba Mons': 'One of the widest volcanoes in the solar system, but so gently sloped you would hardly notice climbing it.',
  'Elysium Mons': "A big volcano in the Elysium region. NASA's InSight lander parked on a plain in the same region.",
  'Hellas Planitia': 'A giant crater made by a space rock, about 2,300 km wide. It is the deepest place on Mars, so the air is thicker down there!',
  'Argyre Planitia': 'Another giant crash crater, about 1,800 km wide. Frost can cover it in winter.',
  'Isidis Planitia': "A huge crater about 1,500 km wide. The Perseverance rover's home, Jezero Crater, sits on its edge!",
  'Utopia Planitia': "A huge flat plain. NASA's Viking 2 lander and China's Zhurong rover both landed here.",
  'Valles Marineris': 'A canyon system that would stretch almost all the way across the United States, and up to 4 times deeper than the Grand Canyon!',
  'Noctis Labyrinthus': "Its name means 'Labyrinth of the Night', a maze of deep valleys.",
  'Syrtis Major': 'A dark patch that astronomers spotted through telescopes from Earth way back in the 1600s!',
  'Chryse Planitia': 'Viking 1 landed here, and Pathfinder landed nearby, in a region carved by ancient floods.',
  'Acidalia Planitia': 'A big dark northern plain. Scientists think an ocean may once have covered Mars\u2019s northern lowlands.',
  'Arabia Terra': 'A huge highland covered in craters. It is one of the oldest parts of Mars.',
  'Amazonis Planitia': 'One of the smoothest plains on all of Mars!',
  'Solis Planum': 'A high plateau of old lava next to Valles Marineris.',
  'Terra Cimmeria': 'Old, crater-covered highlands in the southern half of Mars.',
  'Tempe Terra': 'A rugged highland cut by cracks and valleys.',
  'Schiaparelli': 'Named after Giovanni Schiaparelli, an Italian astronomer who drew early maps of Mars.',
  'Huygens': 'Named after Christiaan Huygens, who made one of the first drawings of Mars in 1659.',
  'Herschel': 'Named after William Herschel, who also discovered the planet Uranus!',
  'Gusev': 'The Spirit rover explored this crater, which scientists think may once have held a lake.',
  'Lyot': 'Scientists have found signs that water once flowed around this crater.',
  'Cassini': 'Named after Giovanni Cassini, who also studied the rings of Saturn!',
  'Korolev': 'This crater holds a giant mound of ice all year round.',
  'Galle': "From space this crater looks like a smiley face. It's nicknamed the 'Happy Face' crater!",
  'Holden': 'Scientists once considered this crater as a landing site for a rover.',
  'Eberswalde': 'It has an ancient river delta, a place where a river once flowed into a lake!',
  'Hale': 'Named after the American astronomer George Ellery Hale.',
  'Viking 1': 'In 1976 it became the first successful US lander on Mars and kept working for over six years!',
  'Viking 2': 'It landed in 1976 and sent back pictures of frost on the ground.',
  'Pathfinder': 'It carried a tiny rover called Sojourner, about the size of a microwave oven!',
  'Opportunity': 'It was planned to work for 90 days, but it explored Mars for nearly 15 years!',
  'Phoenix': 'It dug into the ground near the north pole and found water ice!',
  'InSight': "It listened for 'marsquakes' to learn what the inside of Mars is like.",
  'Zhurong': "China's first Mars rover, named after a god of fire.",
  'Planum Boreum': "Mars's north pole has an ice cap made of water ice, with dry ice (frozen carbon dioxide) in winter.",
  'Planum Australe': "Mars's south pole has an ice cap with dry ice (frozen carbon dioxide) that lasts all year."
};

export class ExpeditionMapScene extends Phaser.Scene {
  private mapWidth = 1340;
  private mapHeight = 670;
  private mapOriginX = 260;
  private mapOriginY = 160;

  private roverSprite!: Phaser.GameObjects.Arc;
  private roverRing!: Phaser.GameObjects.Arc;
  private trail!: Phaser.GameObjects.Graphics;
  private progressBar!: Phaser.GameObjects.Graphics;
  private isTraversing = false;

  private currentTargetSite!: MarsCoord;
  private currentOriginSite!: MarsCoord;
  private totalDistanceKm = 0;
  private distanceText!: Phaser.GameObjects.Text;
  private actionButtonContainer!: Phaser.GameObjects.Container;
  private mapSurface!: Phaser.GameObjects.Rectangle;
  private terrainPanelText!: Phaser.GameObjects.Text;
  private coordinateText!: Phaser.GameObjects.Text;
  private terrainBars!: Phaser.GameObjects.Graphics;
  private crosshair!: Phaser.GameObjects.Graphics;
  private selectedTerrain!: TerrainTelemetry;

  // --- map presentation state
  private layerImages: Record<string, Phaser.GameObjects.Image> = {};
  private layerButtons: Record<string, PanelButton> = {};
  private activeLayer = 'real';
  private gridLayer!: Phaser.GameObjects.Container;
  private featureLayer!: Phaser.GameObjects.Container;
  private landerLayer!: Phaser.GameObjects.Container;
  private classLegend!: Phaser.GameObjects.Container;
  private gradLegend!: Phaser.GameObjects.Container;
  private sourceText!: Phaser.GameObjects.Text;
  private placedFeatures: PlacedFeature[] = [];
  private hoverRing!: Phaser.GameObjects.Arc;

  // --- kid-friendly extras
  private factText!: Phaser.GameObjects.Text;
  private factCounter!: Phaser.GameObjects.Text;
  private discovered = new Set<string>();
  private discoverGfx!: Phaser.GameObjects.Graphics;
  private roverFace!: Phaser.GameObjects.Text;
  private roverSay!: Phaser.GameObjects.Text;
  private sayTimer?: Phaser.Time.TimerEvent;
  private starsEarned = 0;
  private starsText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'ExpeditionMapScene' });
  }

  preload() {
    // Optional: place a NASA Mars Trek / MOLA equirectangular image at NASA_TEXTURE_PATH.
    // If the file is missing the scene silently falls back to the built-in terrain model.
    if (!this.textures.exists(NASA_TEXTURE_KEY)) {
      this.load.image(NASA_TEXTURE_KEY, NASA_TEXTURE_PATH);
    }
  }

  create() {
    gameState.currentLocation = 'gale';
    audioManager.playMusic(this, 'music_game', { loop: true });
    fadeSceneIn(this);

    // Deep-space backdrop
    this.add.rectangle(960, 540, 1920, 1080, 0x02050d).setDepth(-20);
    this.createTwinklingStars();

    // Generate Procedural fallback map canvas (kept for any other consumer of this texture key)
    ProceduralGraphics.generateMarsGlobalMap(this, 'mars_global_mola', this.mapWidth, this.mapHeight);

    // Attach Blender Slot or Terrain Map
    attachBlenderSceneSlot(this, 'EXPEDITION_MAP', () => {
      this.buildTerrainLayers();
    });

    this.setupMissionRoute();
    this.createMapOverlay();
    this.createGraticule();
    this.createFeatureMarkers();
    this.createSiteMarkers();
    this.createTraversePath();
    this.createTelemetrySidePanel();
    this.createTerrainIndicator();
    this.createLayerPanel();
    this.createMapDecorations();
    this.createFunFactCard();
  }

  /* ------------------------------------------------------------------ */
  /*  Mission logic (unchanged)                                          */
  /* ------------------------------------------------------------------ */

  private setupMissionRoute() {
    if (gameState.currentChapter === 'act_2_arcadia') {
      this.currentOriginSite = MARS_SITES.GALE_CRATER;
      this.currentTargetSite = MARS_SITES.ARCADIA_PLANITIA;
    } else if (gameState.currentChapter === 'act_3_gale_return') {
      this.currentOriginSite = MARS_SITES.ARCADIA_PLANITIA;
      this.currentTargetSite = MARS_SITES.GALE_CRATER;
    } else {
      // Act IV Jezero sortie
      this.currentOriginSite = MARS_SITES.GALE_CRATER;
      this.currentTargetSite = MARS_SITES.JEZERO_CRATER;
    }

    this.totalDistanceKm = calculateTraverseDistanceKm(
      this.currentOriginSite.lat,
      this.currentOriginSite.lon,
      this.currentTargetSite.lat,
      this.currentTargetSite.lon
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Terrain layers                                                     */
  /* ------------------------------------------------------------------ */

  private buildTerrainLayers() {
    const cx = this.mapOriginX + this.mapWidth / 2;
    const cy = this.mapOriginY + this.mapHeight / 2;

    const keys = generateMarsTerrainTextures(this, 'mars_terrain', this.mapWidth, this.mapHeight);

    const addLayer = (id: string, key: string) => {
      const img = this.add.image(cx, cy, key)
        .setDisplaySize(this.mapWidth, this.mapHeight)
        .setDepth(0)
        .setVisible(false);
      this.layerImages[id] = img;
    };

    addLayer('real', keys.real);
    addLayer('mola', keys.mola);
    if (this.textures.exists(NASA_TEXTURE_KEY) && this.textures.get(NASA_TEXTURE_KEY).key !== '__MISSING') {
      addLayer('nasa', NASA_TEXTURE_KEY);
    }

    this.activeLayer = this.layerImages['nasa'] ? 'nasa' : 'real';
    this.layerImages[this.activeLayer].setVisible(true);
  }

  private setLayer(id: string) {
    if (!this.layerImages[id]) return;
    this.activeLayer = id;
    Object.entries(this.layerImages).forEach(([key, img]) => img.setVisible(key === id));
    Object.entries(this.layerButtons).forEach(([key, btn]) => btn.setActive(key === id));
    this.classLegend?.setVisible(id === 'real');
    this.gradLegend?.setVisible(id !== 'real');
    this.sourceText?.setText(this.getSourceLabel());
  }

  private getSourceLabel(): string {
    if (this.activeLayer === 'nasa') return 'SOURCE: NASA MGS MOLA / MARS TREK IMAGERY';
    return 'SOURCE: MOLA-REFERENCED RELIEF MODEL\nFEATURES: USGS / IAU NOMENCLATURE';
  }

  /* ------------------------------------------------------------------ */
  /*  Map frame, hover, scanline                                         */
  /* ------------------------------------------------------------------ */

  private createMapOverlay() {
    const cx = this.mapOriginX + this.mapWidth / 2;
    const cy = this.mapOriginY + this.mapHeight / 2;

    // Soft outer glow + border frame
    this.add.rectangle(cx, cy, this.mapWidth + 10, this.mapHeight + 10, 0x000000, 0)
      .setStrokeStyle(6, 0x0ea5e9, 0.12).setDepth(3);
    this.add.rectangle(cx, cy, this.mapWidth, this.mapHeight)
      .setStrokeStyle(2, 0x38bdf8, 0.8).setDepth(3);

    // Corner brackets
    const br = this.add.graphics().setDepth(4);
    br.lineStyle(3, 0x67e8f9, 1);
    const L = 22;
    const x0 = this.mapOriginX - 4, y0 = this.mapOriginY - 4;
    const x1 = this.mapOriginX + this.mapWidth + 4, y1 = this.mapOriginY + this.mapHeight + 4;
    [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([x, y, sx, sy]) => {
      br.lineBetween(x, y, x + L * sx, y);
      br.lineBetween(x, y, x, y + L * sy);
    });

    // Title banner
    this.add.text(this.mapOriginX, this.mapOriginY - 40, 'NASA MARS TREK // GLOBAL TRAVERSE NAVIGATION', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '14px',
      color: '#38bdf8'
    });
    this.add.text(this.mapOriginX, this.mapOriginY - 20, 'EQUIDISTANT CYLINDRICAL // MOLA ELEVATION // HOVER MAP FOR TERRAIN + LANDMARKS', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '10px',
      color: '#64748b'
    });

    this.mapSurface = this.add.rectangle(cx, cy, this.mapWidth, this.mapHeight, 0x000000, 0)
      .setInteractive().setDepth(1);
    this.crosshair = this.add.graphics().setDepth(20);
    this.hoverRing = this.add.circle(0, 0, 17, 0x000000, 0)
      .setStrokeStyle(2.5, 0xffffff, 1).setDepth(22).setVisible(false);

    const scanline = this.add.rectangle(cx, this.mapOriginY, this.mapWidth - 4, 3, 0x67e8f9, 0.3).setDepth(19);
    this.tweens.add({
      targets: scanline,
      y: this.mapOriginY + this.mapHeight,
      duration: 3600,
      repeat: -1,
      ease: 'Sine.InOut'
    });

    this.coordinateText = this.add.text(this.mapOriginX + 12, this.mapOriginY + this.mapHeight - 24, '', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '11px',
      color: '#f8fafc',
      backgroundColor: '#050a14e6',
      padding: { x: 6, y: 3 }
    }).setDepth(25);

    this.mapSurface.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const localX = Phaser.Math.Clamp(pointer.x - this.mapOriginX, 0, this.mapWidth);
      const localY = Phaser.Math.Clamp(pointer.y - this.mapOriginY, 0, this.mapHeight);
      const coordinate = projectCanvasToMars(localX, localY, this.mapWidth, this.mapHeight);
      const terrain = getTerrainAtCoordinate(coordinate.lat, coordinate.lon);
      this.updateTerrainIndicator(terrain);

      this.crosshair.clear();
      this.crosshair.lineStyle(1, 0x67e8f9, 0.85);
      this.crosshair.lineBetween(this.mapOriginX + localX - 12, this.mapOriginY + localY, this.mapOriginX + localX - 4, this.mapOriginY + localY);
      this.crosshair.lineBetween(this.mapOriginX + localX + 4, this.mapOriginY + localY, this.mapOriginX + localX + 12, this.mapOriginY + localY);
      this.crosshair.lineBetween(this.mapOriginX + localX, this.mapOriginY + localY - 12, this.mapOriginX + localX, this.mapOriginY + localY - 4);
      this.crosshair.lineBetween(this.mapOriginX + localX, this.mapOriginY + localY + 4, this.mapOriginX + localX, this.mapOriginY + localY + 12);

      const hit = this.findFeatureNear(localX, localY);
      let line = `CURSOR LAT ${coordinate.lat.toFixed(2)}° // LON ${coordinate.lon.toFixed(2)}°`;
      if (hit) {
        line += `   ▸ ${hit.feature.name.toUpperCase()} // ${hit.feature.info}`;
        this.hoverRing.setPosition(this.mapOriginX + hit.x, this.mapOriginY + hit.y).setVisible(true);
      } else {
        this.hoverRing.setVisible(false);
      }
      this.coordinateText.setText(line);
      this.showFact(hit);
    });
    this.mapSurface.on('pointerout', () => {
      this.hoverRing.setVisible(false);
      this.showFact(undefined);
    });
    this.mapSurface.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.selectedTerrain) this.updateTerrainIndicator(this.selectedTerrain);
      const hit = this.findFeatureNear(pointer.x - this.mapOriginX, pointer.y - this.mapOriginY);
      if (hit) this.collectFeature(hit);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Kid-friendly extras: stars, fun facts, rover buddy, confetti       */
  /* ------------------------------------------------------------------ */

  private createTwinklingStars() {
    const colors = [0xfef3c7, 0xfde68a, 0xffffff, 0x7dd3fc];
    for (let i = 0; i < 110; i++) {
      const star = this.add.circle(
        Phaser.Math.Between(0, 1920),
        Phaser.Math.Between(0, 1080),
        Phaser.Math.FloatBetween(0.8, 2.2),
        Phaser.Utils.Array.GetRandom(colors),
        1
      ).setDepth(-19);
      this.tweens.add({
        targets: star,
        alpha: { from: 0.15, to: 1 },
        duration: Phaser.Math.Between(700, 2200),
        yoyo: true,
        repeat: -1,
        delay: Phaser.Math.Between(0, 2000)
      });
    }
  }

  private createFunFactCard() {
    const cx = 1240;
    const cy = 130;
    this.add.rectangle(cx, cy, 720, 50, 0xfef3c7, 0.97).setStrokeStyle(3, 0xf59e0b, 1).setDepth(30);
    this.factText = this.add.text(cx - 345, cy, '', {
      fontFamily: 'Rajdhani, sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      color: '#451a03',
      wordWrap: { width: 570 },
      lineSpacing: 1
    }).setOrigin(0, 0.5).setDepth(31);
    this.factCounter = this.add.text(cx + 350, cy, '', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#b45309'
    }).setOrigin(1, 0.5).setDepth(31);
    this.discoverGfx = this.add.graphics().setDepth(6);
    this.showFact(undefined);
  }

  private factFor(f: MarsFeature): string {
    const direct = FEATURE_FACTS[f.name];
    if (direct) return direct;
    const n = f.name.toLowerCase();
    if (n.includes('gale')) return 'The Curiosity rover has explored here since 2012. This crater has a mountain about 5 km tall in the middle!';
    if (n.includes('jezero')) return 'The Perseverance rover landed here in 2021. Scientists think it was once a lake with a river delta!';
    if (n.includes('arcadia')) return 'A smooth northern plain. Scientists think water ice is buried just under the ground in places like this.';
    return f.info;
  }

  private showFact(hit?: PlacedFeature) {
    const total = this.placedFeatures.length;
    this.factCounter?.setText(`★ ${this.discovered.size}/${total}`);
    if (!this.factText) return;
    if (hit) {
      this.factText.setText(`💡 ${hit.feature.name}: ${this.factFor(hit.feature)}`);
      return;
    }
    this.factText.setText(
      total > 0 && this.discovered.size >= total
        ? '🏆 You found every landmark. You are a real Mars explorer!'
        : '💡 Hover over a landmark to learn a fun fact. Click it to collect a ⭐!'
    );
  }

  private drawStar(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number) {
    g.fillStyle(0xfde047, 1).lineStyle(1.5, 0x451a03, 1);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fillPath();
    g.strokePath();
  }

  private popText(glyph: string, x: number, y: number) {
    const t = this.add.text(x, y, glyph, { fontSize: '26px' }).setOrigin(0.5).setDepth(40);
    this.tweens.add({
      targets: t,
      y: y - 44,
      scale: 1.6,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.Out',
      onComplete: () => t.destroy()
    });
  }

  private collectFeature(hit: PlacedFeature) {
    if (!this.discovered.has(hit.feature.name)) {
      this.discovered.add(hit.feature.name);
      audioManager.playSfx(this, 'sfx_ui_confirm', { volume: 0.6 });
      const x = this.mapOriginX + hit.x;
      const y = this.mapOriginY + hit.y;
      this.drawStar(this.discoverGfx, x + 13, y - 13, 7);
      this.popText('⭐', x, y - 10);
    }
    this.showFact(hit);
  }

  private say(text: string, ms = 1600) {
    if (!this.roverSay) return;
    this.roverSay.setText(text).setPosition(this.roverSprite.x, this.roverSprite.y - 22).setVisible(true);
    this.sayTimer?.remove(false);
    this.sayTimer = this.time.delayedCall(ms, () => this.roverSay.setVisible(false));
  }

  private earnStar() {
    this.starsEarned++;
    const n = this.starsEarned;
    this.starsText.setText(`MISSION STARS: ${'★'.repeat(n)}${'☆'.repeat(3 - n)}`).setColor('#fde047');
    this.popText('⭐', this.roverSprite.x, this.roverSprite.y - 24);
    audioManager.playSfx(this, 'sfx_ui_confirm', { volume: 0.5 });
    this.say(['Wheee!', 'Halfway there!', 'Almost there!'][n - 1]);
  }

  private confetti(x: number, y: number) {
    const colors = [0xf59e0b, 0xfde047, 0xdc2626, 0x38bdf8, 0xffffff, 0x10b981];
    for (let i = 0; i < 40; i++) {
      const piece = this.add.rectangle(x, y, Phaser.Math.Between(4, 8), Phaser.Math.Between(6, 12), Phaser.Utils.Array.GetRandom(colors))
        .setDepth(40);
      this.tweens.add({
        targets: piece,
        x: x + Phaser.Math.Between(-180, 180),
        y: y + Phaser.Math.Between(-150, 70),
        angle: Phaser.Math.Between(-360, 360),
        alpha: 0,
        duration: Phaser.Math.Between(1000, 1700),
        ease: 'Cubic.Out',
        onComplete: () => piece.destroy()
      });
    }
  }

  private findFeatureNear(localX: number, localY: number): PlacedFeature | undefined {
    let best: PlacedFeature | undefined;
    let bestD = 16;
    for (const p of this.placedFeatures) {
      const d = Math.hypot(p.x - localX, p.y - localY);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /*  Graticule (lat/lon grid)                                           */
  /* ------------------------------------------------------------------ */

  private createGraticule() {
    this.gridLayer = this.add.container(0, 0).setDepth(2);
    const g = this.add.graphics();
    this.gridLayer.add(g);

    const font = { fontFamily: 'Share Tech Mono, monospace', fontSize: '9px', color: '#7dd3fc' };

    for (let la = -60; la <= 60; la += 30) {
      const y = this.mapOriginY + projectMarsToCanvas(la, eastLonToProjection(0, this.mapWidth, this.mapHeight), this.mapWidth, this.mapHeight).y;
      g.lineStyle(1, 0x7dd3fc, la === 0 ? 0.4 : 0.16);
      g.lineBetween(this.mapOriginX, y, this.mapOriginX + this.mapWidth, y);
      this.gridLayer.add(this.add.text(this.mapOriginX - 6, y, `${la}°`, font).setOrigin(1, 0.5));
    }
    for (let lo = 0; lo < 360; lo += 60) {
      const x = this.mapOriginX + projectMarsToCanvas(0, eastLonToProjection(lo, this.mapWidth, this.mapHeight), this.mapWidth, this.mapHeight).x;
      g.lineStyle(1, 0x7dd3fc, lo === 0 ? 0.4 : 0.16);
      g.lineBetween(x, this.mapOriginY, x, this.mapOriginY + this.mapHeight);
      this.gridLayer.add(this.add.text(x, this.mapOriginY + this.mapHeight + 6, `${lo}°E`, font).setOrigin(0.5, 0));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Landmark / crater / volcano / lander markers                       */
  /* ------------------------------------------------------------------ */

  private drawFeatureIcon(g: Phaser.GameObjects.Graphics, kind: FeatureKind, x: number, y: number) {
    const DARK = 0x02050d;
    switch (kind) {
      case 'volcano': {
        const tri = (r: number) => {
          g.beginPath(); g.moveTo(x, y - r); g.lineTo(x - r * 1.05, y + r * 0.8); g.lineTo(x + r * 1.05, y + r * 0.8); g.closePath();
        };
        g.fillStyle(DARK, 1); tri(11); g.fillPath();
        g.fillStyle(0xdc2626, 1); tri(8.5); g.fillPath();
        g.lineStyle(1.5, 0xffffff, 1); tri(8.5); g.strokePath();
        g.fillStyle(0xffffff, 1).fillCircle(x, y - 3, 1.6); // summit caldera
        break;
      }
      case 'crater':
        g.lineStyle(5.5, DARK, 0.95).strokeCircle(x, y, 7);
        g.lineStyle(2.5, 0xffffff, 1).strokeCircle(x, y, 7);
        g.fillStyle(DARK, 1).fillCircle(x, y, 2.6);
        g.fillStyle(0xffffff, 1).fillCircle(x, y, 1.4);
        break;
      case 'basin':
        g.lineStyle(6, DARK, 0.95).strokeCircle(x, y, 11);
        g.lineStyle(3, 0x7dd3fc, 1).strokeCircle(x, y, 11);
        g.lineStyle(1.5, 0xffffff, 0.9).strokeCircle(x, y, 5.5);
        break;
      case 'canyon':
        g.lineStyle(8, DARK, 0.95).lineBetween(x - 12, y + 2, x + 12, y - 2);
        g.lineStyle(4, 0xffffff, 1).lineBetween(x - 12, y + 2, x + 12, y - 2);
        break;
      case 'lander': {
        const star = (ro: number, ri: number) => {
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? ro : ri;
            const ang = -Math.PI / 2 + (i * Math.PI) / 5;
            const px = x + Math.cos(ang) * r;
            const py = y + Math.sin(ang) * r;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.closePath();
        };
        g.fillStyle(DARK, 1); star(11.5, 5); g.fillPath();
        g.fillStyle(0xfde047, 1); star(8.5, 3.6); g.fillPath();
        g.lineStyle(1.5, DARK, 1); star(8.5, 3.6); g.strokePath();
        break;
      }
      default:
        break; // regions + polar caps: label only
    }
  }

  private createFeatureMarkers() {
    this.featureLayer = this.add.container(0, 0).setDepth(5);
    this.landerLayer = this.add.container(0, 0).setDepth(5);
    const iconsMain = this.add.graphics();
    const iconsLander = this.add.graphics();
    this.featureLayer.add(iconsMain);
    this.landerLayer.add(iconsLander);

    // Avoid duplicating anything MARS_SITES / CARGO_DEPOTS already draw
    const occupied: Array<{ x: number; y: number; name: string }> = [];
    Object.values(MARS_SITES).forEach(s => {
      const p = projectMarsToCanvas(s.lat, s.lon, this.mapWidth, this.mapHeight);
      occupied.push({ x: p.x, y: p.y, name: s.name.toLowerCase() });
    });
    CARGO_DEPOTS.forEach(d => {
      const p = projectMarsToCanvas(d.lat, d.lon, this.mapWidth, this.mapHeight);
      occupied.push({ x: p.x, y: p.y, name: d.name.toLowerCase() });
    });

    [...MARS_FEATURES].sort((a, b) => Number(!!a.major) - Number(!!b.major)).forEach(f => {
      const p = projectMarsToCanvas(f.lat, eastLonToProjection(f.lonE, this.mapWidth, this.mapHeight), this.mapWidth, this.mapHeight);
      if (p.x < 0 || p.x > this.mapWidth || p.y < 0 || p.y > this.mapHeight) return;
      if (occupied.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 10 || o.name.includes(f.name.toLowerCase()))) return;

      const x = this.mapOriginX + p.x;
      const y = this.mapOriginY + p.y;
      const isLander = f.kind === 'lander';
      const layer = isLander ? this.landerLayer : this.featureLayer;
      this.drawFeatureIcon(isLander ? iconsLander : iconsMain, f.kind, x, y);

      const noIcon = f.kind === 'region' || f.kind === 'cap';
      const iconGap = f.kind === 'basin' ? 15 : f.kind === 'volcano' || f.kind === 'lander' ? 13 : 11;
      const label = this.add.text(
        x,
        noIcon ? y : y + iconGap,
        f.name.toUpperCase(),
        {
          fontFamily: 'Share Tech Mono, monospace',
          fontSize: f.major ? '13px' : noIcon ? '11px' : '12px',
          fontStyle: 'bold',
          color: KIND_COLOR[f.kind],
          backgroundColor: noIcon ? '#02050db3' : '#02050ddd',
          padding: { x: 4, y: 2 }
        }
      ).setOrigin(0.5, noIcon ? 0.5 : 0);
      layer.add(label);

      this.placedFeatures.push({ feature: f, x: p.x, y: p.y });
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Terrain indicator panel                                            */
  /* ------------------------------------------------------------------ */

  private createTerrainIndicator() {
    this.selectedTerrain = getTerrainAtCoordinate(
      this.currentTargetSite.lat,
      this.currentTargetSite.lon
    );
    this.add.rectangle(1750, 770, 280, 250, 0x020712, 0.96)
      .setStrokeStyle(1, 0x38bdf8, 0.7).setDepth(30);
    this.add.text(1750, 662, 'TERRAIN INDICATOR // LIVE MOLA', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '11px',
      color: '#38bdf8'
    }).setOrigin(0.5).setDepth(31);
    this.terrainPanelText = this.add.text(1630, 686, '', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '10px',
      color: '#cbd5e1',
      wordWrap: { width: 240 },
      lineSpacing: 3
    }).setDepth(31);
    this.terrainBars = this.add.graphics().setDepth(31);
    ['ICE', 'SUN', 'BIO'].forEach((label, i) => {
      this.add.text(1630 + 198, 847 + i * 14, label, {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: '8px',
        color: i === 0 ? '#67e8f9' : i === 1 ? '#fbbf24' : '#34d399'
      }).setDepth(31);
    });
    this.updateTerrainIndicator(this.selectedTerrain);
  }

  private updateTerrainIndicator(terrain: TerrainTelemetry) {
    this.selectedTerrain = terrain;
    const site = terrain.site;
    const celsius = terrain.surfaceTemperatureK - 273.15;
    this.terrainPanelText?.setText(
      `${terrain.classification}\n` +
      `ROUGHNESS: ${terrain.roughness}\n` +
      `ELEVATION: ${Math.round(site.elevationMeters ?? 0)} MOLA m\n` +
      `SLOPE: ${(site.slopeDeg ?? 0).toFixed(1)}°\n` +
      `DUST TAU: ${terrain.dustTau.toFixed(2)}\n` +
      `SURFACE: ${terrain.surfaceTemperatureK} K (${celsius.toFixed(1)}°C)\n` +
      `ICE PROBABILITY: ${Math.round(terrain.waterIceProbability * 100)}%\n` +
      `SOLAR EFFICIENCY: ${Math.round(terrain.solarEfficiency * 100)}%\n` +
      `BIOSIGNATURE PRIORITY: ${Math.round(terrain.biosignaturePriority * 100)}%`
    );
    if (!this.terrainBars) return;
    this.terrainBars.clear();
    [
      terrain.waterIceProbability,
      terrain.solarEfficiency,
      terrain.biosignaturePriority
    ].forEach((value, index) => {
      const y = 848 + index * 14;
      this.terrainBars.fillStyle(0x1e293b, 1);
      this.terrainBars.fillRect(1630, y, 190, 6);
      this.terrainBars.fillStyle(index === 0 ? 0x67e8f9 : index === 1 ? 0xfbbf24 : 0x34d399, 1);
      this.terrainBars.fillRect(1630, y, 190 * value, 6);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Site + depot markers                                               */
  /* ------------------------------------------------------------------ */

  private createSiteMarkers() {
    // Render Origin, Destination, and other key sites
    Object.values(MARS_SITES).forEach(site => {
      const pos = projectMarsToCanvas(site.lat, site.lon, this.mapWidth, this.mapHeight);
      const canvasX = this.mapOriginX + pos.x;
      const canvasY = this.mapOriginY + pos.y;

      const isTarget = site.name === this.currentTargetSite.name;
      const isOrigin = site.name === this.currentOriginSite.name;
      const color = isTarget ? 0xef4444 : (isOrigin ? 0x10b981 : 0xf59e0b);
      this.placedFeatures.push({
        feature: { name: site.name, lat: site.lat, lonE: site.lon, kind: 'crater', info: 'MISSION SITE' },
        x: pos.x,
        y: pos.y
      });

      if (isTarget || isOrigin) {
        const halo = this.add.circle(canvasX, canvasY, 16, color, 0.18).setDepth(9);
        this.tweens.add({ targets: halo, scale: { from: 0.8, to: 1.6 }, alpha: { from: 0.4, to: 0 }, duration: 1500, repeat: -1 });
      }

      const pin = this.add.circle(canvasX, canvasY, isTarget || isOrigin ? 8 : 5, color, 0.95)
        .setStrokeStyle(2, 0xffffff).setDepth(10);

      this.add.text(canvasX, canvasY - 20, (isTarget ? 'GOAL ▸ ' : isOrigin ? 'START ▸ ' : '') + site.name.toUpperCase(), {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: isTarget || isOrigin ? '14px' : '12px',
        fontStyle: 'bold',
        color: isTarget ? '#fca5a5' : (isOrigin ? '#6ee7b7' : '#fcd34d'),
        backgroundColor: '#02050df2',
        padding: { x: 5, y: 2 }
      }).setOrigin(0.5).setDepth(11);

      if (isTarget) {
        this.tweens.add({
          targets: pin,
          scale: { from: 1, to: 1.8 },
          alpha: { from: 1, to: 0.3 },
          duration: 900,
          repeat: -1,
          yoyo: true
        });
      }
    });

    // Pre-positioned NASA Autonomous Cargo Depots
    CARGO_DEPOTS.forEach(depot => {
      const pos = projectMarsToCanvas(depot.lat, depot.lon, this.mapWidth, this.mapHeight);
      const canvasX = this.mapOriginX + pos.x;
      const canvasY = this.mapOriginY + pos.y;

      this.add.rectangle(canvasX, canvasY, 8, 8, 0x38bdf8)
        .setStrokeStyle(1, 0xffffff).setAngle(45).setDepth(10);

      this.add.text(canvasX, canvasY + 12, depot.name, {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#bae6fd',
        backgroundColor: '#02050dd9',
        padding: { x: 4, y: 2 }
      }).setOrigin(0.5, 0).setDepth(11);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Traverse path + rover                                              */
  /* ------------------------------------------------------------------ */

  private createTraversePath() {
    const waypoints = getTraverseWaypoints(this.currentOriginSite, this.currentTargetSite, 16);
    const glow = this.add.graphics().setDepth(6);
    const graphics = this.add.graphics().setDepth(7);
    glow.lineStyle(7, 0x38bdf8, 0.14);
    graphics.lineStyle(2, 0xbae6fd, 0.95);

    for (let i = 0; i < waypoints.length - 1; i++) {
      const p1 = projectMarsToCanvas(waypoints[i].lat, waypoints[i].lon, this.mapWidth, this.mapHeight);
      const p2 = projectMarsToCanvas(waypoints[i + 1].lat, waypoints[i + 1].lon, this.mapWidth, this.mapHeight);

      // Avoid wrapping lines if crossing longitude boundary
      if (Math.abs(p2.x - p1.x) < this.mapWidth / 2) {
        glow.beginPath();
        glow.moveTo(this.mapOriginX + p1.x, this.mapOriginY + p1.y);
        glow.lineTo(this.mapOriginX + p2.x, this.mapOriginY + p2.y);
        glow.stroke();

        // dashed core line
        if (i % 2 === 0) {
          graphics.beginPath();
          graphics.moveTo(this.mapOriginX + p1.x, this.mapOriginY + p1.y);
          graphics.lineTo(this.mapOriginX + p2.x, this.mapOriginY + p2.y);
          graphics.stroke();
        }
      }
    }

    this.trail = this.add.graphics().setDepth(8);

    // Rover Marker Position
    const startPos = projectMarsToCanvas(this.currentOriginSite.lat, this.currentOriginSite.lon, this.mapWidth, this.mapHeight);
    this.roverRing = this.add.circle(this.mapOriginX + startPos.x, this.mapOriginY + startPos.y, 9, 0x000000, 0)
      .setStrokeStyle(2, 0x38bdf8, 0.9).setDepth(11);
    this.tweens.add({ targets: this.roverRing, scale: { from: 1, to: 2.6 }, alpha: { from: 0.9, to: 0 }, duration: 1400, repeat: -1 });
    this.roverSprite = this.add.circle(this.mapOriginX + startPos.x, this.mapOriginY + startPos.y, 9, 0xffffff, 1)
      .setStrokeStyle(2, 0x0284c7).setDepth(12);
    this.roverFace = this.add.text(this.roverSprite.x, this.roverSprite.y, '🤖', { fontSize: '22px' })
      .setOrigin(0.5).setDepth(13);
    this.tweens.add({ targets: this.roverFace, angle: { from: -10, to: 10 }, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.roverSay = this.add.text(this.roverSprite.x, this.roverSprite.y - 22, '', {
      fontFamily: 'Rajdhani, sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#451a03',
      backgroundColor: '#fef3c7',
      padding: { x: 8, y: 4 }
    }).setOrigin(0.5, 1).setDepth(40).setVisible(false);
  }

  /* ------------------------------------------------------------------ */
  /*  Flight plan panel (right)                                          */
  /* ------------------------------------------------------------------ */

  private createTelemetrySidePanel() {
    const panelX = 1750;
    const panelY = 400;

    this.add.rectangle(panelX, panelY, 280, 480, 0x050a14, 0.95)
      .setStrokeStyle(1, 0x38bdf8, 0.45).setDepth(30);
    this.add.rectangle(panelX, 180, 280, 40, 0x0b2a44, 0.9).setDepth(30);

    this.add.text(panelX, 180, 'TRAVERSE FLIGHT PLAN', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '13px',
      color: '#38bdf8'
    }).setOrigin(0.5).setDepth(31);

    this.add.text(panelX - 120, 240, `ORIGIN: ${this.currentOriginSite.name}`, {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '11px',
      color: '#10b981',
      wordWrap: { width: 240 }
    }).setDepth(31);

    this.add.text(panelX - 120, 300, `DESTINATION:\n${this.currentTargetSite.name}`, {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '11px',
      color: '#ef4444',
      wordWrap: { width: 240 }
    }).setDepth(31);

    this.distanceText = this.add.text(panelX - 120, 370, `SPHERICAL DISTANCE:\n${this.totalDistanceKm} km`, {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '13px',
      color: '#38bdf8'
    }).setDepth(31);

    this.add.text(panelX - 120, 425, `AUTONOMOUS CARGO DEPOTS:\nPasses 2 pre-positioned supply beacons.`, {
      fontFamily: 'Rajdhani, sans-serif',
      fontSize: '12px',
      color: '#cbd5e1',
      wordWrap: { width: 240 }
    }).setDepth(31);

    // Progress bar
    this.add.text(panelX - 120, 492, 'TRAVERSE PROGRESS', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '10px',
      color: '#64748b'
    }).setDepth(31);
    this.progressBar = this.add.graphics().setDepth(31);
    this.drawProgress(0);
    this.starsText = this.add.text(panelX - 120, 530, 'MISSION STARS: ☆☆☆', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '12px',
      color: '#94a3b8'
    }).setDepth(31);

    // Traverse Action Button
    this.actionButtonContainer = this.add.container(panelX, 580).setDepth(32);
    const btnBg = this.add.rectangle(0, 0, 240, 48, 0x0284c7)
      .setStrokeStyle(1, 0x38bdf8)
      .setInteractive({ useHandCursor: true });

    const btnTxt = this.add.text(0, 0, 'START THE ADVENTURE!', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '12px',
      color: '#ffffff'
    }).setOrigin(0.5);

    btnBg.on('pointerover', () => {
      btnBg.setFillStyle(0x0369a1);
      audioManager.playSfx(this, 'sfx_ui_hover', { volume: 0.4 });
    });

    btnBg.on('pointerout', () => {
      btnBg.setFillStyle(0x0284c7);
    });

    btnBg.on('pointerdown', () => {
      audioManager.playSfx(this, 'sfx_ui_click', { volume: 0.7 });
      this.commenceTraverse(btnBg, btnTxt);
    });

    attachUIInteraction(this, btnBg, {
      colorTarget: btnBg,
      hoverFill: 0x0369a1,
      defaultFill: 0x0284c7,
      hoverStroke: 0x38bdf8,
      hoverStrokeWidth: 1.5,
      defaultStroke: 0x38bdf8,
      defaultStrokeWidth: 1,
      soundType: 'confirm',
      hoverScale: 1.03,
      pressScale: 0.97,
      tooltip: () => `Commence traverse from ${this.currentOriginSite.name} to ${this.currentTargetSite.name}. Distance: ${this.totalDistanceKm} km.`,
      tooltipOffsetX: 24,
      tooltipOffsetY: -38,
      tooltipDepth: 9000,
    });

    this.actionButtonContainer.add([btnBg, btnTxt]);
  }

  private drawProgress(fraction: number) {
    const x = 1750 - 120;
    const y = 510;
    this.progressBar.clear();
    this.progressBar.fillStyle(0x1e293b, 1).fillRect(x, y, 240, 8);
    this.progressBar.fillStyle(0x38bdf8, 1).fillRect(x, y, 240 * Phaser.Math.Clamp(fraction, 0, 1), 8);
    this.progressBar.lineStyle(1, 0x38bdf8, 0.5).strokeRect(x, y, 240, 8);
  }

  /* ------------------------------------------------------------------ */
  /*  Layer / overlay control panel (left)                               */
  /* ------------------------------------------------------------------ */

  private makeButton(x: number, y: number, w: number, label: string, onClick: () => void): PanelButton {
    let active = false;
    const bg = this.add.rectangle(x, y, w, 26, 0x0b1626, 0.95)
      .setStrokeStyle(1, 0x1e3a5f)
      .setInteractive({ useHandCursor: true })
      .setDepth(31);
    const txt = this.add.text(x, y, label, {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '10px',
      color: '#94a3b8'
    }).setOrigin(0.5).setDepth(32);

    const paint = (hover = false) => {
      bg.setFillStyle(active ? 0x0c4a6e : hover ? 0x12304f : 0x0b1626, 0.95);
      bg.setStrokeStyle(1, active ? 0x38bdf8 : 0x1e3a5f);
      txt.setColor(active ? '#e0f2fe' : '#94a3b8');
    };

    bg.on('pointerover', () => {
      audioManager.playSfx(this, 'sfx_ui_hover', { volume: 0.3 });
      paint(true);
    });
    bg.on('pointerout', () => paint(false));
    bg.on('pointerdown', () => {
      audioManager.playSfx(this, 'sfx_ui_click', { volume: 0.5 });
      onClick();
    });

    return {
      setActive: (v: boolean) => {
        active = v;
        paint(false);
      }
    };
  }

  private createLayerPanel() {
    const px = 130;
    this.add.rectangle(px, 510, 220, 700, 0x050a14, 0.95)
      .setStrokeStyle(1, 0x38bdf8, 0.45).setDepth(30);
    this.add.rectangle(px, 180, 220, 40, 0x0b2a44, 0.9).setDepth(30);
    this.add.text(px, 180, 'MAP LAYERS', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '13px', color: '#38bdf8'
    }).setOrigin(0.5).setDepth(31);

    // Base layers
    let y = 222;
    const layers: Array<[string, string]> = [['real', 'TERRAIN CLASSES'], ['mola', 'ELEVATION GRADIENT']];
    if (this.layerImages['nasa']) layers.push(['nasa', 'NASA MOLA IMAGE']);
    layers.forEach(([id, label]) => {
      if (!this.layerImages[id]) return;
      this.layerButtons[id] = this.makeButton(px, y, 190, label, () => this.setLayer(id));
      y += 34;
    });

    // Overlay toggles
    y += 14;
    this.add.text(px, y, 'OVERLAYS', {
      fontFamily: 'Share Tech Mono, monospace', fontSize: '10px', color: '#64748b'
    }).setOrigin(0.5).setDepth(31);
    y += 26;

    const toggles: Array<[string, () => Phaser.GameObjects.Container]> = [
      ['LAT / LON GRID', () => this.gridLayer],
      ['LANDMARKS + CRATERS', () => this.featureLayer],
      ['LANDER SITES', () => this.landerLayer]
    ];
    toggles.forEach(([label, getter]) => {
      const btn = this.makeButton(px, y, 190, label, () => {
        const target = getter();
        const next = !target.visible;
        target.setVisible(next);
        btn.setActive(next);
      });
      btn.setActive(true);
      y += 34;
    });

    // Legends: terrain classes (flat layer) / elevation gradient (other layers)
    y += 12;
    this.classLegend = this.add.container(0, 0).setDepth(31);
    this.gradLegend = this.add.container(0, 0).setDepth(31);
    const titleStyle = { fontFamily: 'Share Tech Mono, monospace', fontSize: '10px', color: '#64748b' };
    const tickStyle = { fontFamily: 'Share Tech Mono, monospace', fontSize: '9px', color: '#94a3b8' };

    const cg = this.add.graphics();
    this.classLegend.add([this.add.text(px, y, 'TERRAIN CLASSES', titleStyle).setOrigin(0.5), cg]);
    const rows: Array<{ rgb: [number, number, number]; name: string }> = [
      ...BANDS.slice().reverse().map(bd => ({ rgb: bd.rgb, name: bd.name })),
      { rgb: ICE_RGB, name: 'POLAR ICE' }
    ];
    rows.forEach((row, i) => {
      const ry = y + 20 + i * 12;
      cg.fillStyle((row.rgb[0] << 16) | (row.rgb[1] << 8) | row.rgb[2], 1).fillRect(px - 88, ry - 4, 14, 8);
      cg.lineStyle(1, 0x38bdf8, 0.4).strokeRect(px - 88, ry - 4, 14, 8);
      this.classLegend.add(this.add.text(px - 68, ry, row.name, { ...tickStyle, fontSize: '9px' }).setOrigin(0, 0.5));
    });

    const bar = this.add.graphics();
    const barX = px - 90;
    const barW = 180;
    for (let i = 0; i < barW; i++) {
      const km = -8 + (29 * i) / (barW - 1);
      bar.fillStyle(molaColorHex(km), 1).fillRect(barX + i, y + 18, 1, 10);
    }
    bar.lineStyle(1, 0x38bdf8, 0.5).strokeRect(barX, y + 18, barW, 10);
    const zeroX = barX + (8 / 29) * barW;
    this.gradLegend.add([
      this.add.text(px, y, 'ELEVATION (km, MOLA)', titleStyle).setOrigin(0.5),
      bar,
      this.add.text(barX, y + 31, '-8', tickStyle).setOrigin(0.5, 0),
      this.add.text(zeroX, y + 31, '0', tickStyle).setOrigin(0.5, 0),
      this.add.text(barX + barW, y + 31, '+21', tickStyle).setOrigin(0.5, 0)
    ]);
    y += 158;

    // Symbol key
    this.add.text(px, y, 'KEY', {
      fontFamily: 'Share Tech Mono, monospace', fontSize: '10px', color: '#64748b'
    }).setOrigin(0.5).setDepth(31);
    y += 22;
    const keyG = this.add.graphics().setDepth(31);
    const key: Array<[FeatureKind | 'origin' | 'target' | 'depot', string]> = [
      ['volcano', 'SHIELD VOLCANO'],
      ['crater', 'IMPACT CRATER'],
      ['basin', 'IMPACT BASIN'],
      ['canyon', 'CANYON SYSTEM'],
      ['lander', 'LANDER / ROVER SITE'],
      ['depot', 'CARGO DEPOT'],
      ['origin', 'ORIGIN'],
      ['target', 'DESTINATION']
    ];
    key.forEach(([kind, label]) => {
      const kx = px - 80;
      if (kind === 'depot') {
        keyG.fillStyle(0x38bdf8, 1).fillRect(kx - 3, y - 3, 6, 6);
      } else if (kind === 'origin' || kind === 'target') {
        keyG.fillStyle(kind === 'origin' ? 0x10b981 : 0xef4444, 1).fillCircle(kx, y, 5);
        keyG.lineStyle(1.5, 0xffffff, 1).strokeCircle(kx, y, 5);
      } else {
        this.drawFeatureIcon(keyG, kind, kx, y);
      }
      this.add.text(px - 62, y, label, {
        fontFamily: 'Share Tech Mono, monospace', fontSize: '10px', color: '#cbd5e1'
      }).setOrigin(0, 0.5).setDepth(31);
      y += 22;
    });

    // Data source
    this.sourceText = this.add.text(px - 95, 835, this.getSourceLabel(), {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '8px',
      color: '#475569',
      wordWrap: { width: 190 }
    }).setOrigin(0, 1).setDepth(31);

    // Apply initial layer state
    const initial = this.activeLayer;
    if (this.layerImages[initial]) this.setLayer(initial);
  }

  /* ------------------------------------------------------------------ */
  /*  Compass + scale bar                                                */
  /* ------------------------------------------------------------------ */

  private createMapDecorations() {
    const g = this.add.graphics().setDepth(24);
    // Compass (top-right of map)
    const cx = this.mapOriginX + this.mapWidth - 34;
    const cy = this.mapOriginY + 40;
    g.fillStyle(0x050a14, 0.7).fillCircle(cx, cy, 24);
    g.lineStyle(1, 0x67e8f9, 0.8).strokeCircle(cx, cy, 24);
    g.fillStyle(0x67e8f9, 1);
    g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx - 5, cy + 2); g.lineTo(cx + 5, cy + 2); g.closePath(); g.fillPath();
    g.fillStyle(0x475569, 1);
    g.beginPath(); g.moveTo(cx, cy + 18); g.lineTo(cx - 5, cy - 2); g.lineTo(cx + 5, cy - 2); g.closePath(); g.fillPath();
    this.add.text(cx, cy - 34, 'N', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '10px', color: '#67e8f9',
      stroke: '#02050d', strokeThickness: 3
    }).setOrigin(0.5).setDepth(24);

    // Scale bar: 1000 km along the equator (1 deg ~ 59.17 km)
    const pxPerKm = this.mapWidth / 360 / 59.17;
    const barLen = 1000 * pxPerKm;
    const sx = this.mapOriginX + this.mapWidth - 20 - barLen;
    const sy = this.mapOriginY + this.mapHeight - 20;
    g.lineStyle(2, 0xffffff, 0.95);
    g.lineBetween(sx, sy, sx + barLen, sy);
    g.lineBetween(sx, sy - 4, sx, sy + 4);
    g.lineBetween(sx + barLen, sy - 4, sx + barLen, sy + 4);
    this.add.text(sx + barLen / 2, sy - 8, '1,000 KM (EQUATOR)', {
      fontFamily: 'Share Tech Mono, monospace', fontSize: '9px', color: '#ffffff',
      stroke: '#02050d', strokeThickness: 3
    }).setOrigin(0.5, 1).setDepth(24);
  }

  /* ------------------------------------------------------------------ */
  /*  Traverse (logic unchanged; extra visual feedback only)             */
  /* ------------------------------------------------------------------ */

  private commenceTraverse(btnBg: Phaser.GameObjects.Rectangle, btnTxt: Phaser.GameObjects.Text) {
    if (this.isTraversing) return;
    this.isTraversing = true;
    soundFx.playTelemetryChirp();
    this.say('Zoom zoom!');

    btnBg.setFillStyle(0x1e293b);
    btnTxt.setText('ROVER ON THE MOVE...');

    const waypoints = getTraverseWaypoints(this.currentOriginSite, this.currentTargetSite, 24);

    let idx = 0;
    this.time.addEvent({
      delay: 120,
      repeat: waypoints.length - 1,
      callback: () => {
        const wp = waypoints[idx];
        const canvasCoords = projectMarsToCanvas(wp.lat, wp.lon, this.mapWidth, this.mapHeight);
        const prevX = this.roverSprite.x;
        const prevY = this.roverSprite.y;
        this.roverSprite.x = this.mapOriginX + canvasCoords.x;
        this.roverSprite.y = this.mapOriginY + canvasCoords.y;
        this.roverRing.setPosition(this.roverSprite.x, this.roverSprite.y);
        this.roverFace.setPosition(this.roverSprite.x, this.roverSprite.y);
        this.roverSay.setPosition(this.roverSprite.x, this.roverSprite.y - 22);

        // Visual trail + progress
        if (idx > 0 && Math.abs(this.roverSprite.x - prevX) < this.mapWidth / 2) {
          this.trail.lineStyle(3, 0xfde047, 0.95);
          this.trail.lineBetween(prevX, prevY, this.roverSprite.x, this.roverSprite.y);
        }
        this.drawProgress(wp.fraction);
        const thresholds = [0.25, 0.5, 0.75];
        if (this.starsEarned < 3 && wp.fraction >= thresholds[this.starsEarned]) this.earnStar();

        const remDistance = Math.round(this.totalDistanceKm * (1 - wp.fraction));
        this.distanceText.setText(`SPHERICAL DISTANCE:\n${remDistance} km remaining`);

        // Sound blip
        soundFx.playClick(600 + idx * 40);
        idx++;

        if (idx >= waypoints.length) {
          this.onTraverseComplete(btnBg, btnTxt);
        }
      }
    });
  }

  private onTraverseComplete(btnBg: Phaser.GameObjects.Rectangle, btnTxt: Phaser.GameObjects.Text) {
    audioManager.playSfx(this, 'sfx_ui_confirm', { volume: 0.85 });
    btnBg.setFillStyle(0x10b981);
    btnTxt.setText('WE MADE IT! EXPLORE');
    this.drawProgress(1);
    this.say('We made it!', 4000);
    this.confetti(this.roverSprite.x, this.roverSprite.y);

    btnBg.off('pointerdown');
    btnBg.on('pointerdown', () => {
      audioManager.playSfx(this, 'sfx_ui_click', { volume: 0.8 });
      if (gameState.currentChapter === 'act_2_arcadia') {
        gameState.currentLocation = 'arcadia';
        this.cameras.main.zoomTo(1.15, 350, 'Sine.easeInOut');
        transitionToScene(this, 'ArcadiaFieldScene');
      } else if (gameState.currentChapter === 'act_3_gale_return') {
        gameState.currentLocation = 'gale';
        this.cameras.main.zoomTo(1.15, 350, 'Sine.easeInOut');
        transitionToScene(this, 'GaleBaseScene');
      } else {
        // Act IV Jezero
        gameState.currentLocation = 'jezero';
        this.cameras.main.zoomTo(1.15, 350, 'Sine.easeInOut');
        transitionToScene(this, 'JezeroFieldScene');
      }
    });
  }
}