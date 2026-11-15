/**
 * Cutscene Scene
 * Plays the 3D realistic cinematic intro rendered from Blender (scene_01_realistic_intro.blend)
 * with cinematic 2.39:1 widescreen letterboxing, telemetry HUD readouts, synchronized
 * space audio, and instant skip controls.
 * Also supports streaming intro_cutscene.mp4 if present.
 */

import Phaser from 'phaser';
import { soundFx } from '../utils/ProceduralAudio';
import { audioManager } from '../state/AudioManager';
import { attachUIInteraction } from '../utils/UIInteraction';

export class CutsceneScene extends Phaser.Scene {
  private videoElement: HTMLVideoElement | null = null;
  private isSkipping = false;

  // 3D Blender Frame Sequence State
  private currentFrameIndex = 1;
  private readonly totalIntroFrames = 73;
  private frameImage: Phaser.GameObjects.Image | null = null;
  private stageTitleText: Phaser.GameObjects.Text | null = null;
  private stageSubText: Phaser.GameObjects.Text | null = null;
  private frameTimerEvent: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super({ key: 'CutsceneScene' });
  }

  create() {
    this.isSkipping = false;
    this.currentFrameIndex = 1;

    audioManager.stopMusic(500);

    // Setup Skip key handlers
    this.input.keyboard?.addKey('SPACE').on('down', () => this.finishCutscene());
    this.input.keyboard?.addKey('ENTER').on('down', () => this.finishCutscene());
    this.input.keyboard?.addKey('ESC').on('down', () => this.finishCutscene());

    // Check if an MP4 video file exists; if not, immediately play 3D Blender frame sequence
    this.attemptPlayVideoCutscene();
  }

  private attemptPlayVideoCutscene() {
    const videoUrl = '/assets/renders/intro_cutscene.mp4';
    const video = document.createElement('video');
    video.src = videoUrl;
    video.autoplay = true;
    video.playsInline = true;
    video.style.position = 'absolute';
    video.style.top = '0';
    video.style.left = '0';
    video.style.width = '100vw';
    video.style.height = '100vh';
    video.style.objectFit = 'cover';
    video.style.zIndex = '5';
    video.style.backgroundColor = '#000000';

    video.onloadeddata = () => {
      // External MP4 video exists!
      this.videoElement = video;
      document.body.appendChild(video);
      video.play().catch(() => {});

      video.onended = () => {
        this.finishCutscene();
      };

      this.createSkipOverlay();
    };

    video.onerror = () => {
      // Stream the 73 high-resolution 3D Blender rendered frames
      video.remove();
      this.createBlender3DCinematic();
    };
  }

  private createBlender3DCinematic() {
    const width = 1920;
    const height = 1080;

    // Pitch-black space background
    this.add.rectangle(width / 2, height / 2, width, height, 0x010204).setDepth(0);

    // Subtle background space stars
    for (let i = 0; i < 60; i++) {
      const sx = Phaser.Math.Between(0, width);
      const sy = Phaser.Math.Between(0, height);
      this.add.circle(sx, sy, Math.random() * 1.5 + 0.5, 0xffffff, Math.random() * 0.7 + 0.3).setDepth(1);
    }

    // Central 3D Render Display
    const firstFrameKey = 'intro_frame_001';
    if (this.textures.exists(firstFrameKey)) {
      this.frameImage = this.add.image(width / 2, height / 2, firstFrameKey);
      this.frameImage.setDisplaySize(width, height);
      this.frameImage.setDepth(10);
    }

    // Cinematic Widescreen Letterboxing (Anamorphic Cinema Bars)
    const barHeight = 110;
    this.add.rectangle(width / 2, barHeight / 2, width, barHeight, 0x000000).setDepth(100);
    this.add.rectangle(width / 2, height - barHeight / 2, width, barHeight, 0x000000).setDepth(100);

    // Top Cinematic HUD Header
    this.add.text(50, 42, 'NASA ARES INTERPLANETARY EXPEDITION // SYNOR', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '15px',
      color: '#38bdf8',
      letterSpacing: 4
    }).setDepth(110);

    this.add.text(width - 50, 42, 'DSN 34M CARRIER: LOCKED [NOMINAL]', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '14px',
      color: '#34d399',
      letterSpacing: 2
    }).setOrigin(1, 0).setDepth(110);

    // Stage Status Telemetry Banner (Bottom Left / Center)
    this.stageTitleText = this.add.text(width / 2, height - 76, 'STAGE 01: DEEP SPACE FLYBY // VELOCITY: 28,400 KM/H', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '14px',
      color: '#38bdf8',
      letterSpacing: 3
    }).setOrigin(0.5, 0).setDepth(110);

    this.stageSubText = this.add.text(width / 2, height - 48, 'APPROACHING RED PLANET TERMINATOR // TRAJECTORY NOMINAL', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '13px',
      color: '#94a3b8',
      letterSpacing: 2
    }).setOrigin(0.5, 0).setDepth(110);

    // Interactive On-Screen Skip Button (Bottom Right)
    const skipBtnBg = this.add.rectangle(width - 180, height - 55, 260, 40, 0x0a1424, 0.85)
      .setStrokeStyle(1, 0x38bdf8, 0.8)
      .setDepth(120)
      .setInteractive({ useHandCursor: true });

    const skipBtnText = this.add.text(width - 180, height - 55, 'SKIP INTRO [SPACE]', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '12px',
      color: '#38bdf8',
      letterSpacing: 2
    }).setOrigin(0.5).setDepth(121);

    skipBtnBg.on('pointerover', () => {
      skipBtnBg.setFillStyle(0x38bdf8, 0.35);
      skipBtnText.setColor('#ffffff');
      soundFx.playClick(1000);
    });

    skipBtnBg.on('pointerout', () => {
      skipBtnBg.setFillStyle(0x0a1424, 0.85);
      skipBtnText.setColor('#38bdf8');
    });

    skipBtnBg.on('pointerdown', () => this.finishCutscene());

    // Also allow clicking anywhere on background to skip
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Don't duplicate if clicking the skip button directly
      if (pointer.y > height - 110 && pointer.x > width - 350) return;
      this.finishCutscene();
    });

    // Start Audio
    soundFx.startSpaceAtmosphereDrone();
    soundFx.playRocketRoar(3.0);

    // Start 3D Frame Progression (~14 FPS = 72ms per frame)
    this.frameTimerEvent = this.time.addEvent({
      delay: 72,
      repeat: this.totalIntroFrames - 1,
      callback: () => this.advanceBlenderFrame()
    });
  }

  private advanceBlenderFrame() {
    if (this.isSkipping) return;

    this.currentFrameIndex++;
    const pad = String(this.currentFrameIndex).padStart(3, '0');
    const textureKey = `intro_frame_${pad}`;

    if (this.frameImage && this.textures.exists(textureKey)) {
      this.frameImage.setTexture(textureKey);
    }

    // Audio & Telemetry Cues for the 3 Stages
    if (this.currentFrameIndex === 22) {
      // Stage 2: Transit towards Mars
      soundFx.playTelemetryChirp();
      if (this.stageTitleText) {
        this.stageTitleText.setText('STAGE 02: ORBITAL AEROCAPTURE // MARS ATMOSPHERE INTERFACE');
        this.stageTitleText.setColor('#f59e0b');
      }
      if (this.stageSubText) {
        this.stageSubText.setText('TARGETING GALE CRATER OUTPOST // LAT -5.4° LON 137.8° // HEATSHIELD ARMED');
      }
    } else if (this.currentFrameIndex === 43) {
      // Stage 3: Retro-burn descent
      soundFx.playRocketRoar(3.2);
      if (this.stageTitleText) {
        this.stageTitleText.setText('STAGE 03: GALE CRATER PAD 01 // RETRO-THRUSTERS ENGAGED');
        this.stageTitleText.setColor('#38bdf8');
      }
      if (this.stageSubText) {
        this.stageSubText.setText('DESCENT VELOCITY: 8.2 M/S // QUAD LANDING LEGS DEPLOYED');
      }
    } else if (this.currentFrameIndex === 60) {
      // Touchdown moment!
      soundFx.playTouchdownThud();
      soundFx.playAirlockHiss();
      if (this.stageTitleText) {
        this.stageTitleText.setText('TOUCHDOWN CONFIRMED // GALE CRATER LANDING PAD 01');
        this.stageTitleText.setColor('#34d399');
      }
      if (this.stageSubText) {
        this.stageSubText.setText('ALL PRIMARY SYSTEMS NOMINAL // WELCOME TO MARS, COMMANDER.');
      }
    }

    // When all 73 frames finish, hold hero frame for 1.6s then transition
    if (this.currentFrameIndex >= this.totalIntroFrames) {
      this.time.delayedCall(1600, () => {
        if (!this.isSkipping) this.finishCutscene();
      });
    }
  }

  private createSkipOverlay() {
    const skipBtn = document.createElement('div');
    skipBtn.id = 'cutscene-skip-overlay';
    skipBtn.innerHTML = `[PRESS <b>SPACE</b> OR CLICK TO SKIP CUTSCENE]`;
    skipBtn.style.position = 'absolute';
    skipBtn.style.bottom = '28px';
    skipBtn.style.right = '36px';
    skipBtn.style.fontFamily = "'Share Tech Mono', monospace";
    skipBtn.style.fontSize = '14px';
    skipBtn.style.color = '#38bdf8';
    skipBtn.style.background = 'rgba(5, 10, 20, 0.75)';
    skipBtn.style.border = '1px solid rgba(56, 189, 248, 0.4)';
    skipBtn.style.padding = '8px 16px';
    skipBtn.style.borderRadius = '4px';
    skipBtn.style.cursor = 'pointer';
    skipBtn.style.zIndex = '15';
    skipBtn.style.letterSpacing = '2px';

    skipBtn.onclick = () => this.finishCutscene();
    document.body.appendChild(skipBtn);
  }

  private removeSkipOverlay() {
    const el = document.getElementById('cutscene-skip-overlay');
    if (el) el.remove();
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.remove();
      this.videoElement = null;
    }
  }

  private createProceduralCinematicCutscene() {
    const width = 1920;
    const height = 1080;

    // Pitch black background with subtle drifting stars
    this.add.rectangle(width / 2, height / 2, width, height, 0x010204);

    for (let i = 0; i < 90; i++) {
      const sx = Phaser.Math.Between(0, width);
      const sy = Phaser.Math.Between(0, height);
      const star = this.add.circle(sx, sy, Math.random() * 1.5 + 0.5, 0xffffff, Math.random() * 0.7 + 0.3);
      this.tweens.add({
        targets: star,
        y: sy + Phaser.Math.Between(40, 100),
        alpha: { from: 0.2, to: 0.9 },
        duration: Phaser.Math.Between(4000, 8000),
        repeat: -1,
        yoyo: true
      });
    }

    // Cinematic Widescreen Letterboxing (2.39:1 Anamorphic ratio)
    const letterboxHeight = 110;
    const topBar = this.add.rectangle(width / 2, letterboxHeight / 2, width, letterboxHeight, 0x000000).setDepth(100);
    const bottomBar = this.add.rectangle(width / 2, height - letterboxHeight / 2, width, letterboxHeight, 0x000000).setDepth(100);

    // Audio cue
    soundFx.playTelemetryChirp();

    // Central Telemetry HUD
    const hudFrame = this.add.rectangle(width / 2, height / 2, 1100, 420, 0x040812, 0.85)
      .setStrokeStyle(1, 0x38bdf8, 0.4);

    const hudBadge = this.add.text(width / 2, height / 2 - 180, 'MISSION SYNOR // PROLOGUE CINEMATIC', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '18px',
      color: '#38bdf8',
      letterSpacing: 6
    }).setOrigin(0.5);

    const blenderNote = this.add.text(
      width / 2,
      height / 2 - 145,
      '[BLENDER 3D CUTSCENE SLOT READY: DROP VIDEO INTO /public/assets/renders/intro_cutscene.mp4]',
      {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: '12px',
        color: '#f59e0b',
        letterSpacing: 2
      }
    ).setOrigin(0.5);

    // Dynamic typewriter log terminal
    const terminalText = this.add.text(width / 2 - 480, height / 2 - 100, '', {
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: '16px',
      color: '#e2e8f0',
      lineSpacing: 16
    });

    this.typeNextLog(terminalText);

    // Skip Button
    const skipBtnBg = this.add.rectangle(width / 2, height / 2 + 155, 340, 44, 0x0a1424, 0.9)
      .setStrokeStyle(1, 0x38bdf8, 0.8)
      .setInteractive({ useHandCursor: true });

    const skipBtnText = this.add.text(width / 2, height / 2 + 155, 'ENTER GALE CRATER BASE [SPACE]', {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '13px',
      color: '#38bdf8',
      letterSpacing: 2
    }).setOrigin(0.5);

    skipBtnBg.on('pointerover', () => {
      skipBtnBg.setFillStyle(0x38bdf8, 0.3);
      skipBtnText.setColor('#ffffff');
      soundFx.playClick(1000);
    });

    skipBtnBg.on('pointerout', () => {
      skipBtnBg.setFillStyle(0x0a1424, 0.9);
      skipBtnText.setColor('#38bdf8');
    });

    skipBtnBg.on('pointerdown', () => this.finishCutscene());

    attachUIInteraction(this, skipBtnBg, {
      colorTarget: skipBtnBg,
      textTarget: skipBtnText,
      hoverFill: 0x38bdf8,
      hoverFillAlpha: 0.3,
      defaultFill: 0x0a1424,
      defaultFillAlpha: 0.9,
      hoverStroke: 0x38bdf8,
      hoverStrokeWidth: 1.5,
      defaultStroke: 0x38bdf8,
      defaultStrokeWidth: 1,
      soundType: 'confirm',
      hoverScale: 1.03,
      pressScale: 0.97,
      tooltip: 'Skip the cinematic prelude and enter Gale Crater Base.',
      tooltipOffsetX: 24,
      tooltipOffsetY: -38,
      tooltipDepth: 9000,
    });
  }

  private typeNextLog(textObj: Phaser.GameObjects.Text) {
    if (this.logIndex >= this.logLines.length) {
      // Auto-finish after final log if user doesn't press skip
      this.time.delayedCall(3000, () => {
        if (!this.isSkipping) this.finishCutscene();
      });
      return;
    }

    const currentLine = this.logLines[this.logIndex];
    let charIdx = 0;
    const existing = textObj.text ? textObj.text + '\n> ' : '> ';

    this.time.addEvent({
      delay: 24,
      repeat: currentLine.length - 1,
      callback: () => {
        charIdx++;
        textObj.setText(existing + currentLine.substring(0, charIdx));
        if (charIdx % 3 === 0) soundFx.playClick(1600);
        if (charIdx >= currentLine.length) {
          this.logIndex++;
          this.time.delayedCall(700, () => this.typeNextLog(textObj));
        }
      }
    });
  }


  private finishCutscene() {
    if (this.isSkipping) return;
    this.isSkipping = true;

    if (this.frameTimerEvent) {
      this.frameTimerEvent.destroy();
      this.frameTimerEvent = null;
    }

    audioManager.playSfx(this, 'sfx_ui_confirm', { volume: 0.8 });
    this.removeSkipOverlay();

    this.cameras.main.fadeOut(800, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('GaleBaseScene');
      this.scene.launch('HUDScene');
    });
  }
}
