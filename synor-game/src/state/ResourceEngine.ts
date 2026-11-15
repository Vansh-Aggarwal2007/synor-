/**
 * Resource Simulation Engine
 * Handles hourly/daily resource tick, CO2 accumulation, thermal loss,
 * water-tank radiation shielding physics, and life-support consequences.
 * Integrated with NASA DONKI (Space Weather Database) live telemetry.
 */

import { gameState, GameState } from './GameState';
import { soundFx } from '../utils/ProceduralAudio';
import { fetchTelemetryWithFallback } from '../utils/PlanetaryTelemetry';

export interface DonkiSpaceWeather {
  flareClass: string;         // e.g., "M4.2" or "X1.5"
  peakTime: string;           // Real NASA DONKI timestamp
  sourceLocation: string;     // Solar active region coordinates (e.g., "N15W32")
  radiationMultiplier: number;// Scales baseline & SPE mSv/tick
  isLive: boolean;            // True if fetched from api.nasa.gov
}

export class ResourceEngine {
  private static instance: ResourceEngine;
  private state: GameState;
  private tickTimer: number | null = null;
  private tickIntervalMs: number = 3000; // 3 seconds per simulated hour in game
  private donkiSynced: boolean = false;
  private speAlertLogged: boolean = false;

  // Exposed so UI / DecisionModal can read the active NASA DONKI event
  public donkiWeather: DonkiSpaceWeather = {
    flareClass: 'M3.8',
    peakTime: '2026-11-08T16:40Z',
    sourceLocation: 'S18E42',
    radiationMultiplier: 1.85,
    isLive: false
  };

  private constructor() {
    this.state = gameState;
  }

  public static getInstance(): ResourceEngine {
    if (!ResourceEngine.instance) {
      ResourceEngine.instance = new ResourceEngine();
    }
    return ResourceEngine.instance;
  }

  /**
   * Step 1 Integration: Fetches real solar flare telemetry from NASA DONKI API
   */
  public async syncDonkiTelemetry(): Promise<DonkiSpaceWeather> {
    const apiKey = (import.meta as any).env?.VITE_NASA_API_KEY || 'DEMO_KEY';
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const flares = await fetchTelemetryWithFallback<unknown[]>(
      `https://api.nasa.gov/DONKI/FLR?startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`,
      []
    );

    try {
      if (Array.isArray(flares) && flares.length > 0) {
        const latest = flares[flares.length - 1];
        const classType: string = latest.classType || 'C2.1';
        const isX = classType.startsWith('X');
        const isM = classType.startsWith('M');

        // Parse magnitude (e.g. "M4.2" -> 4.2) for fine-grained dose scaling
        const magnitude = parseFloat(classType.slice(1)) || 1.0;
        const multiplier = isX
          ? 2.5 + Math.min(2.0, magnitude * 0.25)
          : isM
          ? 1.4 + Math.min(1.0, magnitude * 0.1)
          : 1.0 + Math.min(0.3, magnitude * 0.03);

        this.donkiWeather = {
          flareClass: classType,
          peakTime: latest.peakTime || endDate,
          sourceLocation: latest.sourceLocation || 'AR-SOLAR',
          radiationMultiplier: Number(multiplier.toFixed(2)),
          isLive: true
        };

        this.state.addLog(
          `NASA DONKI LIVE TELEMETRY: Solar Flare ${this.donkiWeather.flareClass} (${this.donkiWeather.sourceLocation}) detected at ${this.donkiWeather.peakTime}. Radiation flux multiplier: ${this.donkiWeather.radiationMultiplier}x.`,
          'system'
        );
        this.state.notifyChange('donki_sync');
        return this.donkiWeather;
      }
    } catch (err) {
      console.warn('DONKI live fetch unavailable, using cached NASA telemetry:', err);
    }

    this.state.addLog(
      `NASA DONKI ARCHIVE TELEMETRY: Solar Flare ${this.donkiWeather.flareClass} (${this.donkiWeather.sourceLocation}) loaded. Radiation flux multiplier: ${this.donkiWeather.radiationMultiplier}x.`,
      'system'
    );
    return this.donkiWeather;
  }

  public startSimulation() {
    if (this.tickTimer !== null) return;

    // Fetch live NASA DONKI space weather once when simulation starts
    if (!this.donkiSynced) {
      this.donkiSynced = true;
      this.syncDonkiTelemetry();
    }

    this.tickTimer = window.setInterval(() => {
      this.tick();
    }, this.tickIntervalMs);
  }

  public stopSimulation() {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  public tick() {
    const { resources, hazards, breakers, evaActive } = this.state;

    // 1. Life Support & CO2 Dynamics
    if (breakers.lifeSupport) {
      if (hazards.co2Ppm > 600) {
        hazards.co2Ppm = Math.max(500, hazards.co2Ppm - 45);
      }
      resources.airReserve = Math.max(0, Math.min(100, resources.airReserve + 0.1));
    } else {
      hazards.co2Ppm += 120;
      resources.airReserve = Math.max(0, resources.airReserve - 0.8);
      if (hazards.co2Ppm > 3000 && Math.random() < 0.25) {
        this.state.addLog(
          `CRITICAL: Cabin CO2 concentration elevated (${Math.round(hazards.co2Ppm)} ppm). Cognitive impairment detected.`,
          'warning'
        );
        soundFx.playAlarmTone();
      }
    }

    // 2. Thermal Stability
    if (breakers.thermalHeating) {
      if (resources.thermalStability < 85) {
        resources.thermalStability = Math.min(85, resources.thermalStability + 0.5);
      }
    } else {
      resources.thermalStability = Math.max(0, resources.thermalStability - 0.9);
      if (resources.thermalStability < 40 && Math.random() < 0.2) {
        this.state.addLog(
          `WARNING: Internal habitat temperature dropping. Risk of line freezing.`,
          'warning'
        );
      }
    }

    // 3. Power Generation & Consumption
    const wattage = this.state.getBreakerWattage();
    // Balanced hard-science power generation:
    // Gale Base has 10 kWe Kilopower Stirling fission reactor and solar tracking arrays
    let generation = 105;
    if (this.state.galeCommissionedNodes.includes('rover_garage')) {
      generation += 15; // Kilopower Stirling core online: 120W (steady surplus against 110W breaker draw)
    }
    if (this.state.currentChapter === 'act_2_arcadia' || this.state.currentChapter === 'act_4_jezero') {
      // Mobile exploration: LREV Rover RTG and deployable solar wings provide 92W (steady realistic deficit)
      generation = 92;
    } else if (this.state.currentChapter === 'act_3_gale_return') {
      // Return traverse: rover moving across terrain under battery/RTG load
      generation = 95;
    } else if (this.state.currentChapter === 'act_5_conjunction') {
      // Solar Conjunction dust storm deficit: atmospheric opacity tau=3.8 collapses solar input
      generation = 75;
    }
    const netFlow = generation - wattage.used;
    // Calibrated consumption rate: ~0.15% to 0.22% per 3s tick (~3% to 4.5% power decrease per minute of mobile operations)
    resources.power = Math.max(0, Math.min(100, resources.power + (netFlow * 0.012)));

    // 4. Water & Hydro-Loop
    if (breakers.waterFiltration) {
      // Nominal closed-loop recovery with slight metabolic drain
      resources.waterReserve = Math.max(0, resources.waterReserve - 0.05);
    } else {
      resources.waterReserve = Math.max(0, resources.waterReserve - 0.35);
    }

    // 5. Radiation & Water-Tank Shielding Math (NASA DONKI Driven)
    // Water stored along perimeter walls acts as hydrogen-dense neutron/SPE shielding
    const effectiveShielding = (resources.shelterProtection / 100) * (resources.waterReserve / 100);
    let backgroundDoseRate = 0.002 * this.donkiWeather.radiationMultiplier; // mSv / tick scaled by DONKI

    if (this.state.currentChapter === 'act_5_conjunction' && this.state.conjunctionDay === 6) {
      // Solar Particle Event Day scaled by real DONKI flare telemetry
      backgroundDoseRate = 0.06 * this.donkiWeather.radiationMultiplier;

      if (!this.speAlertLogged) {
        this.speAlertLogged = true;
        this.state.addLog(
          `DONKI SPE ALERT: Coronal proton front from Flare ${this.donkiWeather.flareClass} (${this.donkiWeather.sourceLocation}) impacting Mars surface! Maintain water-wall shielding!`,
          'alert'
        );
        soundFx.playAlarmTone();
      }
    } else {
      this.speAlertLogged = false;
    }

    if (evaActive) {
      // Outside suit radiation rate (no regolith or water shield)
      hazards.radiationDoseMsv += backgroundDoseRate * 6;
      this.state.suitO2 = Math.max(0, this.state.suitO2 - 1.2);
      this.state.suitBattery = Math.max(0, this.state.suitBattery - 0.9);

      if (Math.random() < 0.3) {
        soundFx.playGeigerClick();
      }

      if (this.state.suitO2 <= 15) {
        this.state.addLog(
          'CRITICAL: Spacesuit O2 reserves below 15%! Return to airlock immediately!',
          'alert'
        );
        soundFx.playAlarmTone();
      }
    } else {
      // Inside shelter protected by water-tanks and regolith
      const absorbedDose = backgroundDoseRate * (1 - (effectiveShielding * 0.85));
      hazards.radiationDoseMsv += absorbedDose;
    }

    // 6. Sample Cryo-Preservation Degradation
    if (!breakers.sampleCryo && this.state.biosignatureSampleTube) {
      this.state.sciencePreservedPercent = Math.max(20, this.state.sciencePreservedPercent - 0.3);
      if (Math.random() < 0.15) {
        this.state.addLog(
          `ALERT: Sample cryo-storage unpowered! Organic biomarkers degrading (${Math.round(this.state.sciencePreservedPercent)}% preserved).`,
          'alert'
        );
      }
    }

    // Check catastrophic failure limits (Ending C trigger conditions)
    if (
      resources.airReserve <= 0 ||
      resources.waterReserve <= 0 ||
      resources.thermalStability <= 0 ||
      hazards.co2Ppm >= 5000
    ) {
      this.state.addLog('CRITICAL LIFE SUPPORT COLLAPSE: VITAL HABITAT BUFFER EXHAUSTED.', 'alert');
      soundFx.playAlarmTone();
    }

    this.state.notifyChange('tick');
  }

  /**
   * Cycles EVA airlock: consumes suit reserves and habitat airlock buffer
   */
  public cycleAirlock(): boolean {
    if (!this.state.evaActive) {
      // Exiting to EVA
      if (this.state.resources.airReserve < 5) {
        this.state.addLog(
          'AIRLOCK CYCLE ABORT: Habitat air reserve too low to vent airlock volume.',
          'warning'
        );
        return false;
      }
      this.state.resources.airReserve -= 3;
      this.state.evaActive = true;
      this.state.suitO2 = 100;
      this.state.suitBattery = 100;
      this.state.addLog(
        `AIRLOCK CYCLED: Exterior hatch open. DONKI Solar Flux: ${this.donkiWeather.flareClass} (${this.donkiWeather.radiationMultiplier}x). Commencing EVA.`,
        'system'
      );
      soundFx.playAirlockHiss();
      this.state.save();
      return true;
    } else {
      // Re-entering Habitat
      this.state.evaActive = false;
      this.state.addLog('AIRLOCK CYCLED: Interior seal restored. Explorer returned to habitat.', 'system');
      soundFx.playAirlockHiss();
      this.state.save();
      return true;
    }
  }
}

export const resourceEngine = ResourceEngine.getInstance();