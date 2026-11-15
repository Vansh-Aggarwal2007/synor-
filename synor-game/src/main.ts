/**
 * Main Game Entry Point
 * Configures Phaser.Game with 1920x1080 FIT scaling and initializes all mission scenes.
 */

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { StartMenuScene } from './scenes/StartMenuScene';
import { CutsceneScene } from './scenes/CutsceneScene';
import { HUDScene } from './scenes/HUDScene';
import { GaleBaseScene } from './scenes/GaleBaseScene';
import { ExpeditionMapScene } from './scenes/ExpeditionMapScene';
import { ArcadiaFieldScene } from './scenes/ArcadiaFieldScene';
import { JezeroFieldScene } from './scenes/JezeroFieldScene';
import { JezeroShelterScene } from './scenes/JezeroShelterScene';
import { EndingScene } from './scenes/EndingScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1920,
  height: 1080,
  parent: 'game-container',
  backgroundColor: '#040508',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  scene: [
    BootScene,
    PreloadScene,
    StartMenuScene,
    CutsceneScene,
    GaleBaseScene,
    ExpeditionMapScene,
    ArcadiaFieldScene,
    JezeroFieldScene,
    JezeroShelterScene,
    EndingScene,
    HUDScene
  ]
};

window.addEventListener('DOMContentLoaded', () => {
  new Phaser.Game(config);
});

