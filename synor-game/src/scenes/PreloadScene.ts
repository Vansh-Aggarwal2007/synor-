/**
 * Preload Scene
 * Loads narrative datasets, UI assets, transparent astronaut sprites,
 * and dynamically detects & loads Blender 3D renders from /public/assets/renders/.
 */

import Phaser from 'phaser';
import { BLENDER_SCENE_SLOTS } from '../utils/BlenderSceneBridge';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });
  }

  preload() {
    this.createProgressUI();

    // Load Data Files
    this.load.json('chapters_data', '/assets/data/chapters.json');
    this.load.json('experiments_data', '/assets/data/experiments.json');
    this.load.json('conjunction_data', '/assets/data/conjunction.json');

    // Load Astronaut Sprites & Spritesheet
    this.load.spritesheet('astronaut_walk', '/assets/sprites/astronaut_sheet.png', {
      frameWidth: 70,
      frameHeight: 106
    });
    this.load.image('astronaut_portrait', '/assets/sprites/astronaut_portrait.png');
    this.load.image('astronaut_idle', '/assets/sprites/astronaut_idle.png');

    // Load realistic Mars menu backdrop and clean expansive terrain
    this.load.image('mars_menu_realistic', '/assets/renders/mars_menu_realistic.jpg');
    this.load.image('gale_base_map', '/assets/renders/gale_base.png');
    this.load.image('mars_outpost_base', '/assets/renders/mars_outpost_base.png');
    this.load.image('mars_gale_crater_clean', '/assets/renders/mars_gale_crater_clean.png');
    this.load.image('mars_gale_crater_expanded', '/assets/renders/mars_gale_crater_expanded.png');
    this.load.spritesheet('astronaut_iso', '/assets/sprites/astronaut_isometric_sheet.png', {
      frameWidth: 64,
      frameHeight: 96
    });

    // Load Blender 3D Intro Cutscene Frames (73 cinematic frames rendered from scene_01_realistic_intro.blend)
    for (let i = 1; i <= 73; i++) {
      const pad = String(i).padStart(3, '0');
      this.load.image(`intro_frame_${pad}`, `/assets/renders/intro/frame_${pad}.webp`);
    }

    // Load High-Res Transparent Modular Outpost Structures & Equipment
    this.load.image('outpost_dome', '/assets/outpost/dome_greenhouse.png');
    this.load.image('outpost_hab', '/assets/outpost/hab_central.png');
    this.load.image('outpost_science', '/assets/outpost/science_lab.png');
    this.load.image('outpost_tower', '/assets/outpost/comms_tower.png');
    this.load.image('outpost_hangar', '/assets/outpost/rover_hangar.png');
    this.load.image('outpost_rocket', '/assets/outpost/rocket_lander.png');
    this.load.image('outpost_dish', '/assets/outpost/relay_dish.png');
    this.load.image('outpost_solar', '/assets/outpost/solar_array.png');
    this.load.image('outpost_medbay', '/assets/outpost/med_bay.png');
    this.load.image('outpost_rover', '/assets/outpost/rover_vehicle.png');
    this.load.image('outpost_crates', '/assets/outpost/supply_crates.png');
    this.load.image('outpost_fuel', '/assets/outpost/fuel_canisters.png');
    this.load.image('outpost_truck', '/assets/outpost/heavy_truck.png');
    this.load.image('outpost_powerbox', '/assets/outpost/power_box.png');
    this.load.image('outpost_butte', '/assets/outpost/rock_butte.png');
    this.load.image('outpost_rockmtn', '/assets/outpost/rock_mountain.png');
    this.load.image('outpost_ice', '/assets/outpost/ice_crystals.png');

    // Load Background Music
    this.load.audio('music_menu', '/assets/audio/music/menu_chiptune.mp3');
    this.load.audio('music_game', '/assets/audio/music/game_warm_marimba.mp3');

    // Load Movement Footstep Sounds (Ground & Metal)
    this.load.audio('sfx_step_ground', '/assets/audio/sfx/step_sand.wav');
    this.load.audio('sfx_step_sand', '/assets/audio/sfx/step_sand.wav');
    this.load.audio('sfx_step_gravel', '/assets/audio/sfx/step_gravel.wav');
    this.load.audio('sfx_step_metal', '/assets/audio/sfx/step_metal.wav');
    this.load.audio('sfx_step_heavy_sand', '/assets/audio/sfx/step_heavy_sand.wav');
    this.load.audio('sfx_step_heavy_gravel', '/assets/audio/sfx/step_heavy_gravel.wav');

    // Load UI & Interaction Sound Effects
    this.load.audio('sfx_ui_hover', '/assets/audio/sfx/ui_hover.mp3');
    this.load.audio('sfx_ui_click', '/assets/audio/sfx/ui_click.mp3');
    this.load.audio('sfx_ui_confirm', '/assets/audio/sfx/ui_confirm.mp3');
    this.load.audio('sfx_ui_modal_open', '/assets/audio/sfx/ui_modal_open.mp3');
    this.load.audio('sfx_ui_modal_close', '/assets/audio/sfx/ui_modal_close.mp3');
    this.load.audio('sfx_ui_commission', '/assets/audio/sfx/ui_commission.mp3');
    this.load.audio('sfx_teleport_warp', '/assets/audio/sfx/teleport_warp.wav');
    this.load.audio('sfx_teleport_pop', '/assets/audio/sfx/teleport_pop.wav');
    this.load.audio('sfx_click_detonator', '/assets/audio/sfx/click_detonator.wav');

    // Load individual components from assets2
    for (const r of ['q1', 'q2', 'q3', 'q4']) {
      for (let c = 1; c <= 7; c++) {
        const key = `${r}_${c.toString().padStart(3, '0')}`;
        this.load.image(`tile_${key}`, `/assets/assets2/${key}.png`);
      }
    }

    // Only load Blender 3D scene renders that genuinely exist in /public/assets/renders/
    const existingRenders = import.meta.glob('/public/assets/renders/*.{png,jpg,jpeg,webp}', { eager: true });
    const existingFileNames = Object.keys(existingRenders).map(p => p.split('/').pop());

    Object.values(BLENDER_SCENE_SLOTS).forEach(slot => {
      if (existingFileNames.includes(slot.expectedFilename)) {
        const textureKey = `blender_${slot.id}`;
        const path = `/assets/renders/${slot.expectedFilename}`;
        this.load.image(textureKey, path);
      }
    });

    // Cleanup any failed textures if any error occurs
    this.load.on('loaderror', (fileObj: Phaser.Loader.File) => {
      if (fileObj && fileObj.key && this.textures.exists(fileObj.key)) {
        this.textures.remove(fileObj.key);
      }
    });
  }

  private createProgressUI() {
    const width = 1920;
    const height = 1080;

    const title = this.add.text(width / 2, height / 2 - 80, 'MISSION SYNOR // SUBSYSTEM INITIALIZATION', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '20px',
      color: '#38bdf8',
      letterSpacing: 4
    }).setOrigin(0.5);

    const subtitle = this.add.text(width / 2, height / 2 - 45, 'VERIFYING ECLSS, FLIGHT AVIONICS & NASA MARS TREK GEODATA', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '12px',
      color: '#94a3b8'
    }).setOrigin(0.5);

    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x0a101d, 0.8);
    progressBox.lineStyle(1, 0x38bdf8, 0.7);
    progressBox.strokeRect(width / 2 - 250, height / 2, 500, 24);

    const percentText = this.add.text(width / 2, height / 2 + 12, '0%', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '12px',
      color: '#38bdf8'
    }).setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      percentText.setText(`${Math.round(value * 100)}%`);
      progressBar.clear();
      progressBar.fillStyle(0x0284c7, 1);
      progressBar.fillRect(width / 2 - 248, height / 2 + 2, 496 * value, 20);
    });

    this.load.on('complete', () => {
      // Register 4-way Isometric & Cardinal Astronaut animations
      if (this.textures.exists('astronaut_iso')) {
        if (!this.anims.exists('astro_walk_down')) {
          this.anims.create({
            key: 'astro_walk_down',
            frames: this.anims.generateFrameNumbers('astronaut_iso', { start: 0, end: 3 }),
            frameRate: 8,
            repeat: -1
          });
        }
        if (!this.anims.exists('astro_walk_up')) {
          this.anims.create({
            key: 'astro_walk_up',
            frames: this.anims.generateFrameNumbers('astronaut_iso', { start: 4, end: 7 }),
            frameRate: 8,
            repeat: -1
          });
        }
        if (!this.anims.exists('astro_walk_right')) {
          this.anims.create({
            key: 'astro_walk_right',
            frames: this.anims.generateFrameNumbers('astronaut_iso', { start: 8, end: 11 }),
            frameRate: 8,
            repeat: -1
          });
        }
        if (!this.anims.exists('astro_walk_left')) {
          this.anims.create({
            key: 'astro_walk_left',
            frames: this.anims.generateFrameNumbers('astronaut_iso', { start: 12, end: 15 }),
            frameRate: 8,
            repeat: -1
          });
        }
        if (!this.anims.exists('astro_idle')) {
          this.anims.create({
            key: 'astro_idle',
            frames: this.anims.generateFrameNumbers('astronaut_iso', { start: 16, end: 19 }),
            frameRate: 4,
            repeat: -1
          });
        }
      }

      // Legacy fallback animations
      if (this.textures.exists('astronaut_walk')) {
        if (!this.anims.exists('astro_walk_anim')) {
          this.anims.create({
            key: 'astro_walk_anim',
            frames: this.anims.generateFrameNumbers('astronaut_walk', { start: 0, end: 3 }),
            frameRate: 6,
            repeat: -1
          });
        }
        if (!this.anims.exists('astro_idle_anim')) {
          this.anims.create({
            key: 'astro_idle_anim',
            frames: [{ key: 'astronaut_walk', frame: 0 }],
            frameRate: 1
          });
        }
      }

      progressBar.destroy();
      progressBox.destroy();
      percentText.destroy();
      title.destroy();
      subtitle.destroy();
      this.scene.start('StartMenuScene');
    });
  }
}
