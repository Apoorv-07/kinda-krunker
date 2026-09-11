// ---------------------------------------------------------------------------
// BLOCKSHOT ARENA — game engine.
// Three.js renderer, AABB physics, hitscan weapons, bot orchestration,
// match flow, viewmodels, camera FX and HUD snapshot emission.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import {
  Difficulty, LobbyConfig, MAP_LABEL, MatchState, TUNE, WeaponId, WEAPONS, WEAPON_ORDER,
  clamp, damp, lerp, mulberry32, pick, randRange, shuffle,
} from "./config";
import { BoxDef, generateMap, MapData, raycastWorld } from "./maps";
import { moveBody } from "./physics";
import { FxSystem } from "./fx";
import {
  BotBrain, BotCtx, drawHpBar, makeBotBrain, makeCharacter, CharacterRig, tickBot, updateCharacterAnim,
} from "./bots";
import { sfx } from "./audio";

export interface EntInput { x: number; z: number; jump: boolean; sprint: boolean; crouch: boolean }

export interface Ent {
  id: number;
  name: string;
  isBot: boolean;
  /** networked human controlled by another browser */
  remote?: boolean;
  /** stable net id for remote players */
  netId?: string;
  color: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  onGround: boolean;
  crouch: boolean;
  slideT: number;
  slideDir: THREE.Vector3;
  hp: number;
  alive: boolean;
  weapon: WeaponId;
  ammo: Record<WeaponId, { mag: number; reserve: number }>;
  fireCd: number;
  reloadT: number;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
  lastDamageT: number;
  deadT: number;
  spawnProtectT: number;
  padCd: number;
  input: EntInput;
  rig?: CharacterRig;
  brain?: BotBrain;
  ads: boolean;
  // stats
  shots: number;
  hits: number;
  dmgDealt: number;
  bestStreak: number;
  team?: number;
}

export interface FeedItem { id: number; text: string; head: boolean; mine: boolean }
export interface MultiplayerConfig {
  enabled: boolean;
  playerId: string;
  teamMode: "ffa" | "teams";
  myTeam: number;
  isHost: boolean;
}

export interface RemotePlayersInput {
  players: Array<{
    playerId: string; name: string; color: number; team: number;
    hp: number; alive: boolean; weapon: WeaponId; kills: number; deaths: number; score: number;
  }>;
  sampleOf: (playerId: string) => { x: number; y: number; z: number; yaw: number; pitch: number } | null;
}

export interface NetBotsInput {
  bots: Array<{
    id: number; name: string; color: number; team: number;
    hp: number; alive: boolean; kills?: number; deaths?: number; score?: number;
  }>;
  sampleOf: (id: number) => { x: number; y: number; z: number; yaw: number; pitch: number } | null;
}

const BOT_NAMES = (): string[] => [
  "xX_Reaper_Xx", "NoScopeNina", "BlitzKrieg", "PixelPunisher", "TurboTommy",
  "ShadowSniper", "Blastoise99", "CrateCrawler", "HeadshotHarry", "LagginLarry",
  "NeonNemesis", "BoomBoomBetty", "QuickScopeQuin", "FragFred", "SneakySnek",
  "BulletBill", "DoomDaisy", "VandalVince", "GhostGerry", "MayhemMia",
];

export interface Standing { name: string; color: number; kills: number; deaths: number; score: number; isPlayer: boolean; team?: number }

/** Damage another client claims to have landed on one of my bots. */
export interface NetEventIn { seq: number; kind: string; to?: string; from?: string; fromName?: string; dmg?: number; head?: boolean; text?: string }

/** Damage a guest claims to have dealt to one of the host's bots. */
export interface BotHitIn { botId: number; dmg: number; head: boolean }

export interface HudSnapshot {
  state: MatchState;
  warmup: number;
  timeLeft: number;
  hp: number;
  mag: number;
  reserve: number;
  reloadT: number;
  reloadDur: number;
  weapon: WeaponId;
  weaponName: string;
  score: number;
  kills: number;
  deaths: number;
  streak: number;
  feed: FeedItem[];
  announceKey: number;
  announceText: string;
  announceSub: string;
  hitKey: number;
  hitKind: number;
  dmgKey: number;
  dmgAmp: number;
  dmgAngle: number;
  killerName: string;
  deadT: number;
  protectedT: number;
  standings: Standing[];
  scoped: boolean;
  fps: number;
  playerCount: number;
  scoreLimit: number;
}

export interface GameOverStats {
  won: boolean;
  standings: Standing[];
  player: { kills: number; deaths: number; score: number; dmg: number; acc: number; bestStreak: number };
  mapLabel: string;
  lobbyCode: string;
  winnerName: string;
}

export interface EngineCallbacks {
  onHud: (snap: HudSnapshot) => void;
  onGameOver: (stats: GameOverStats) => void;
}

export interface EngineSettings { sens: number; fov: number; volume: number; autoFire: boolean }

const WEAPON_COLORS: Record<WeaponId, number> = {
  ar: 0xffb800, smg: 0x22d3ee, shotgun: 0xf97316, sniper: 0xa855f7,
};

const BOT_WEAPONS: WeaponId[] = ["ar", "ar", "ar", "smg", "shotgun", "sniper"];
const BOT_DMG: Record<WeaponId, number> = { ar: 12, smg: 9, shotgun: 7, sniper: 60 };

let ENT_SEQ = 1;

export class GameEngine {
  // three
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private fx: FxSystem;
  private map: MapData;
  private colliders: BoxDef[] = [];
  private worldGroup: THREE.Group | null = null;
  private padMeshes: THREE.Mesh[] = [];
  private weaponPadMeshes: { group: THREE.Group; taken: boolean; respawnT: number; weapon: WeaponId; floatBox: THREE.Mesh }[] = [];
  private vms = new Map<WeaponId, { group: THREE.Group; muzzle: THREE.Object3D }>();
  private sun!: THREE.DirectionalLight;

  // state
  private config: LobbyConfig;
  private playerName: string;
  private cb: EngineCallbacks;
  private rng: () => number;
  private now = 0;
  private lastT = 0;
  private raf = 0;
  private destroyed = false;
  private isMobile = false;

  player: Ent;
  private bots: Ent[] = [];
  state: MatchState = "warmup";
  private prevState: MatchState = "playing";
  private warmupT = TUNE.warmupTime;
  private timeLeft: number;
  private firstBlood = false;

  // input (mutated by React layer)
  input = {
    moveX: 0, moveZ: 0,
    lookDX: 0, lookDY: 0,
    fire: false, firePressed: false,
    ads: false,
    jumpPressed: false,
    crouchPressed: false,
    crouchHeld: false,
    sprintHeld: false,
    reloadPressed: false,
    switchWeapon: -1,
  };
  private prevFire = false;
  private settings: EngineSettings = { sens: 1, fov: 92, volume: 0.7, autoFire: false };

  // camera fx
  private baseFov = 92;
  private fov = 92;
  private shakeAmp = 0;
  private recoilPitch = 0;
  private recoilRoll = 0;
  private bobT = 0;
  private swayX = 0;
  private swayY = 0;
  private switchT = 0;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();

  // hud
  private feed: FeedItem[] = [];
  private feedSeq = 1;
  private announceKey = 0;
  private announceText = "";
  private announceSub = "";
  private hitKey = 0;
  private hitKind = 0;
  private dmgKey = 0;
  private dmgAmp = 0;
  private dmgAngle = 0;
  private killerName = "";
  private hudDirty = true;
  private hudTick = 0;
  private fpsEma = 60;

  constructor(canvas: HTMLCanvasElement, config: LobbyConfig, playerName: string, cb: EngineCallbacks) {
    this.canvas = canvas;
    this.config = config;
    this.playerName = playerName;
    this.cb = cb;
    this.rng = mulberry32(config.seed + 7);
    this.timeLeft = config.timeLimit;
    this.isMobile = typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768);

    // renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.isMobile, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.6 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // scene + camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(92, 1, 0.05, 400);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    const theme = config.map;
    this.map = generateMap(theme, config.seed);
    this.buildWorld();
    this.buildLights();
    this.fx = new FxSystem(this.scene);
    this.buildViewmodels();

    // player
    this.player = this.makePlayer();
    this.spawnEntity(this.player, true);
    // bots
    const names = shuffle(this.rng, (BOT_NAMES()));
    for (let i = 0; i < config.botCount; i++) {
      const bot = this.makeBot(names[i % names.length], i);
      this.bots.push(bot);
      this.spawnEntity(bot, true);
    }

    this.resize();
    window.addEventListener("resize", this.resize);
  }

  // ---------------------------------------------------------------- world
  private buildWorld() {
    const t = this.map.themeData;
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.fog, t.fogNear, t.fogFar);
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);

    const geoCache = new Map<string, THREE.BoxGeometry>();
    const matCache = new Map<number, THREE.MeshStandardMaterial>();
    const getGeo = (w: number, h: number, d: number) => {
      const k = `${w}|${h}|${d}`;
      let g = geoCache.get(k);
      if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
      return g;
    };
    const getMat = (c: number, glow?: number, glowI?: number) => {
      const key = glow ? c * 1000 + glow : c;
      let m = matCache.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          color: c, roughness: 0.75, metalness: 0.08,
          emissive: glow ? glow : 0x000000, emissiveIntensity: glow ? glowI ?? 1.2 : 0,
        });
        matCache.set(key, m);
      }
      return m;
    };

    for (const b of this.map.boxes) {
      const mesh = new THREE.Mesh(getGeo(b.w, b.h, b.d), getMat(b.color, b.glow, b.glowI));
      mesh.position.set(b.x, b.y, b.z);
      mesh.castShadow = b.collide && b.h > 0.3 && b.w < 40;
      mesh.receiveShadow = b.collide;
      this.worldGroup.add(mesh);
      if (b.collide) this.colliders.push(b);
    }

    // ground grid
    const grid = new THREE.GridHelper(this.map.size * 2, this.map.size * 2, 0x000000, 0x000000);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = this.map.theme === "neon" ? 0.25 : 0.12;
    grid.position.y = 0.02;
    (grid.material as THREE.Material).colorWrite = true;
    this.worldGroup.add(grid);

    // jump pads
    for (const p of this.map.pads) {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.85, 1.0, 0.14, 24),
        new THREE.MeshStandardMaterial({ color: 0x10131f, roughness: 0.4, metalness: 0.3 }),
      );
      base.position.set(p.x, 0.07, p.z);
      this.worldGroup.add(base);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.07, 8, 24),
        new THREE.MeshStandardMaterial({ color: t.accent, emissive: t.accent, emissiveIntensity: 1.8, roughness: 0.4 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, 0.16, p.z);
      this.worldGroup.add(ring);
      this.padMeshes.push(ring);
    }

    // weapon pads
    const wpTypes: WeaponId[] = ["smg", "shotgun", "sniper", "ar", "smg", "shotgun"];
    this.map.weaponPads.forEach((p, i) => {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.9, 0.1, 20),
        new THREE.MeshStandardMaterial({ color: 0x10131f, roughness: 0.4, metalness: 0.3 }),
      );
      disc.position.y = 0.05;
      g.add(disc);
      const weapon = wpTypes[i % wpTypes.length];
      const floatBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.2, 0.9),
        new THREE.MeshStandardMaterial({ color: WEAPON_COLORS[weapon], emissive: WEAPON_COLORS[weapon], emissiveIntensity: 0.35, roughness: 0.4 }),
      );
      floatBox.position.y = 0.85;
      g.add(floatBox);
      g.position.set(p.x, 0, p.z);
      this.worldGroup!.add(g);
      this.weaponPadMeshes.push({ group: g, taken: false, respawnT: 0, weapon, floatBox });
    });
  }

  private buildLights() {
    const t = this.map.themeData;
    const hemi = new THREE.HemisphereLight(t.hemiSky, t.hemiGround, t.hemiIntensity);
    this.scene.add(hemi);
    const amb = new THREE.AmbientLight(0xffffff, t.ambient);
    this.scene.add(amb);
    const sun = new THREE.DirectionalLight(t.sunColor, t.sunIntensity);
    sun.position.set(28, 42, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.isMobile ? 1024 : 2048, this.isMobile ? 1024 : 2048);
    sun.shadow.camera.left = -38;
    sun.shadow.camera.right = 38;
    sun.shadow.camera.top = 38;
    sun.shadow.camera.bottom = -38;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  // ---------------------------------------------------------------- entities
  private freshAmmo() {
    const a = {} as Ent["ammo"];
    for (const id of WEAPON_ORDER) {
      a[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    }
    return a;
  }

  private makePlayer(): Ent {
    return {
      id: 0, name: this.playerName, isBot: false, color: 0x3ddc84,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      yaw: 0, pitch: 0, onGround: false, crouch: false,
      slideT: 0, slideDir: new THREE.Vector3(),
      hp: TUNE.maxHp, alive: true, weapon: "ar", ammo: this.freshAmmo(),
      fireCd: 0, reloadT: 0, kills: 0, deaths: 0, score: 0, streak: 0,
      lastDamageT: -10, deadT: 0, spawnProtectT: 0, padCd: 0,
      input: { x: 0, z: 0, jump: false, sprint: false, crouch: false },
      ads: false, shots: 0, hits: 0, dmgDealt: 0, bestStreak: 0,
    };
  }

  private makeBot(name: string, idx: number): Ent {
    const colors = [0xef4444, 0x3b82f6, 0xeab308, 0xa855f7, 0xec4899, 0x06b6d4, 0xf97316, 0x84cc16, 0x14b8a6];
    const color = colors[idx % colors.length];
    const e: Ent = {
      id: ENT_SEQ++, name, isBot: true, color,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      yaw: 0, pitch: 0, onGround: false, crouch: false,
      slideT: 0, slideDir: new THREE.Vector3(),
      hp: TUNE.maxHp, alive: true, weapon: pick(this.rng, BOT_WEAPONS), ammo: this.freshAmmo(),
      fireCd: 0, reloadT: 0, kills: 0, deaths: 0, score: 0, streak: 0,
      lastDamageT: -10, deadT: 0, spawnProtectT: 0, padCd: 0,
      input: { x: 0, z: 0, jump: false, sprint: false, crouch: false },
      ads: false, shots: 0, hits: 0, dmgDealt: 0, bestStreak: 0,
      brain: makeBotBrain(this.rng),
    };
    e.rig = makeCharacter(name, color);
    this.scene.add(e.rig.group);
    return e;
  }

  private spawnEntity(e: Ent, initial = false) {
    const s = this.map.spawns[Math.floor(this.rng() * this.map.spawns.length)];
    e.pos.set(s.x, s.y, s.z);
    e.vel.set(0, 0, 0);
    e.yaw = s.yaw;
    e.pitch = 0;
    e.alive = true;
    e.hp = TUNE.maxHp;
    e.fireCd = 0;
    e.reloadT = 0;
    e.streak = 0;
    e.slideT = 0;
    e.spawnProtectT = initial ? 0 : TUNE.spawnProtect;
    e.ammo = this.freshAmmo();
    e.deadT = 0;
    if (e.isBot) {
      e.weapon = pick(this.rng, BOT_WEAPONS);
      if (e.rig) {
        e.rig.fallT = 0;
        e.rig.group.rotation.set(0, 0, 0);
        e.rig.group.visible = true;
        e.rig.hpSprite.visible = true;
        e.rig.lastHpDrawn = -1;
        drawHpBar(e.rig, e.hp, TUNE.maxHp);
      }
    }
  }

  // ---------------------------------------------------------------- viewmodel
  private buildViewmodels() {
    for (const id of WEAPON_ORDER) {
      const group = new THREE.Group();
      const accent = WEAPON_COLORS[id];
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c1f2a, roughness: 0.45, metalness: 0.5 });
      const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.3, emissive: accent, emissiveIntensity: 0.25 });
      const handMat = new THREE.MeshStandardMaterial({ color: 0xffc999, roughness: 0.8 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.42), bodyMat);
      group.add(body);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1), handMat);
      hand.position.set(0, -0.02, 0.1);
      group.add(hand);
      const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.1), handMat);
      foregrip.position.set(0, -0.06, -0.14);
      group.add(foregrip);

      if (id === "ar" || id === "smg") {
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, id === "ar" ? 0.34 : 0.22), bodyMat);
        barrel.position.set(0, 0.02, id === "ar" ? -0.36 : -0.3);
        group.add(barrel);
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.18, 0.09), accentMat);
        mag.position.set(0, -0.13, 0.02);
        mag.rotation.x = 0.35;
        group.add(mag);
        const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), accentMat);
        sight.position.set(0, 0.07, -0.02);
        group.add(sight);
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.14), bodyMat);
        stock.position.set(0, -0.01, 0.26);
        group.add(stock);
      } else if (id === "shotgun") {
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.44), accentMat);
        barrel.position.set(0, 0.02, -0.4);
        group.add(barrel);
        const pump = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), bodyMat);
        pump.position.set(0, -0.07, -0.2);
        group.add(pump);
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.16), bodyMat);
        stock.position.set(0, -0.02, 0.26);
        group.add(stock);
      } else {
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.6), accentMat);
        barrel.position.set(0, 0.02, -0.5);
        group.add(barrel);
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 12), bodyMat);
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 0.09, -0.05);
        group.add(scope);
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.18), bodyMat);
        stock.position.set(0, -0.02, 0.28);
        group.add(stock);
        const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), accentMat);
        bolt.position.set(0.05, -0.02, 0.02);
        group.add(bolt);
      }
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.02, id === "sniper" ? -0.82 : id === "shotgun" ? -0.62 : id === "ar" ? -0.55 : -0.42);
      group.add(muzzle);
      group.position.set(0.3, -0.27, -0.5);
      group.visible = false;
      this.camera.add(group);
      this.vms.set(id, { group, muzzle });
    }
  }

  // ---------------------------------------------------------------- public
  start() {
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = clamp((t - this.lastT) / 1000, 0, 0.05);
      this.lastT = t;
      if (dt > 0) this.fpsEma = lerp(this.fpsEma, 1 / Math.max(dt, 1e-4), 0.05);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
    sfx.ensure();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    sfx.stopMusic();
    this.fx.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
  }

  applySettings(s: EngineSettings) {
    this.settings = { ...s };
    this.baseFov = s.fov;
    sfx.setVolume(s.volume);
    sfx.ensure();
  }

  private clearInputEdges() {
    this.input.jumpPressed = false;
    this.input.crouchPressed = false;
    this.input.reloadPressed = false;
    this.input.switchWeapon = -1;
    this.input.fire = false;
    this.input.ads = false;
    this.input.moveX = 0;
    this.input.moveZ = 0;
  }

  setPaused(p: boolean) {
    if (p) {
      if (this.state === "playing" || this.state === "warmup") {
        this.prevState = this.state;
        this.state = "paused";
        this.clearInputEdges();
        this.markHud();
      }
    } else {
      if (this.state === "paused") {
        this.state = this.prevState;
        this.markHud();
      }
    }
  }

  restart() {
    this.player.kills = 0; this.player.deaths = 0; this.player.score = 0;
    this.player.shots = 0; this.player.hits = 0; this.player.dmgDealt = 0;
    this.player.bestStreak = 0;
    this.player.streak = 0;
    for (const b of this.bots) {
      b.kills = 0; b.deaths = 0; b.score = 0; b.streak = 0;
    }
    this.feed = [];
    this.announceText = "";
    this.announceSub = "";
    this.firstBlood = false;
    this.killerName = "";
    this.timeLeft = this.config.timeLimit;
    this.warmupT = 0.9;
    this.state = "warmup";
    this.spawnEntity(this.player, true);
    this.player.spawnProtectT = 1.2;
    for (const b of this.bots) this.spawnEntity(b, true);
    for (const wp of this.weaponPadMeshes) { wp.taken = false; wp.group.visible = true; }
    this.markHud();
  }

  // ---------------------------------------------------------------- flow
  private endMatch() {
    if (this.state === "ended") return;
    this.state = "ended";
    this.clearInputEdges();
    const standings = this.standings();
    const winner = standings[0];
    const won = winner.isPlayer;
    if (won) sfx.play("win"); else sfx.play("lose");
    this.markHud();
    this.cb.onGameOver({
      won,
      standings,
      player: {
        kills: this.player.kills, deaths: this.player.deaths, score: this.player.score,
        dmg: this.player.dmgDealt,
        acc: this.player.shots > 0 ? Math.round((this.player.hits / this.player.shots) * 100) : 0,
        bestStreak: this.player.bestStreak,
      },
      mapLabel: MAP_LABEL[this.config.map],
      lobbyCode: this.config.code,
      winnerName: winner.name,
    });
  }

  private standings(): Standing[] {
    if (this.mpEnabled) return this.netStandings();
    const all: Ent[] = [this.player, ...this.bots];
    return all
      .map((e) => ({ name: e.name, color: e.color, kills: e.kills, deaths: e.deaths, score: e.score, isPlayer: !e.isBot }))
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
  }

  // ---------------------------------------------------------------- combat
  private addFeed(text: string, head: boolean, mine: boolean) {
    this.feed.push({ id: this.feedSeq++, text, head, mine });
    if (this.feed.length > 5) this.feed.shift();
    this.markHud();
  }

  private announce(text: string, sub = "") {
    this.announceKey++;
    this.announceText = text;
    this.announceSub = sub;
    this.markHud();
  }

  private addShake(amp: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  private damage(target: Ent, amount: number, attacker: Ent, head: boolean) {
    if (!target.alive || target.spawnProtectT > 0) return;
    target.hp -= amount;
    target.lastDamageT = this.now;
    attacker.dmgDealt += amount;
    if (target.rig) target.rig.flashT = 0.12;
    if (target === this.player) {
      this.dmgKey++;
      this.dmgAmp = clamp(amount / 24, 0.25, 1);
      const dx = attacker.pos.x - target.pos.x, dz = attacker.pos.z - target.pos.z;
      let rel = Math.atan2(dx, dz) - target.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      this.dmgAngle = rel;
      this.addShake(0.35);
      sfx.play("dmg");
    }
    if (target.hp <= 0) {
      this.kill(target, attacker, head);
    }
    this.markHud();
  }

  private kill(target: Ent, attacker: Ent, head: boolean) {
    target.alive = false;
    target.hp = 0;
    target.deaths++;
    target.deadT = TUNE.respawnTime;
    target.vel.set(0, 0, 0);
    attacker.kills++;
    attacker.streak++;
    attacker.bestStreak = Math.max(attacker.bestStreak, attacker.streak);
    attacker.score += 100 + (attacker.streak - 1) * 25;
    if (target.rig) {
      target.rig.fallT = 0.0001;
      target.rig.hpSprite.visible = false;
    }
    this.addFeed(`${attacker.name} ${head ? "✖" : "›"} ${target.name}`, head, attacker === this.player || target === this.player);
    this.fx.explosion(target.pos.x, target.pos.y + 1.0, target.pos.z);
    this.addShake(attacker === this.player ? 0.15 : 0.25);

    if (!this.firstBlood) {
      this.firstBlood = true;
      this.announce("FIRST BLOOD", `${attacker.name} draws first`);
      sfx.play("go");
    }
    if (attacker === this.player) {
      this.hitKind = 3;
      this.hitKey++;
      if (this.player.streak >= 2) {
        const labels = ["", "", "DOUBLE KILL", "TRIPLE KILL", "RAMPAGE", "UNSTOPPABLE", "GODLIKE"];
        this.announce(labels[Math.min(this.player.streak, 6)] ?? "GODLIKE", `Streak ${this.player.streak}`);
      } else if (head) {
        this.announce("HEADSHOT", "+" + (100 + (this.player.streak - 1) * 25));
      }
      sfx.play("kill");
    }
    if (target === this.player) {
      this.killerName = attacker.name;
      this.player.streak = 0;
      sfx.play("die");
    } else {
      target.streak = 0;
    }

    if (this.config.scoreLimit > 0 && attacker.kills >= this.config.scoreLimit) {
      this.endMatch();
    }
    this.markHud();
  }

  private raycastEnt(e: Ent, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): { t: number; head: boolean } | null {
    const r = TUNE.radius + 0.05;
    const h = TUNE.standHeight;
    const minX = e.pos.x - r, maxX = e.pos.x + r;
    const minY = e.pos.y, maxY = e.pos.y + h;
    const minZ = e.pos.z - r, maxZ = e.pos.z + r;
    let tmin = 0, tmax = Infinity;
    if (Math.abs(dx) < 1e-9) { if (ox < minX || ox > maxX) return null; }
    else {
      let t1 = (minX - ox) / dx, t2 = (maxX - ox) / dx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (Math.abs(dy) < 1e-9) { if (oy < minY || oy > maxY) return null; }
    else {
      let t1 = (minY - oy) / dy, t2 = (maxY - oy) / dy;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (Math.abs(dz) < 1e-9) { if (oz < minZ || oz > maxZ) return null; }
    else {
      let t1 = (minZ - oz) / dz, t2 = (maxZ - oz) / dz;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    const hitY = oy + dy * tmin;
    return { t: tmin, head: hitY > e.pos.y + h - 0.36 };
  }

  private firePlayer() {
    const p = this.player;
    if (!p.alive || this.state !== "playing") return;
    const w = WEAPONS[p.weapon];
    if (p.fireCd > 0 || p.reloadT > 0) return;
    const a = p.ammo[p.weapon];
    if (a.mag <= 0) {
      this.startReload();
      return;
    }
    a.mag--;
    p.fireCd = 60 / w.rpm;
    p.shots += w.pellets;
    this.recoilPitch += w.id === "sniper" ? 0.06 : w.id === "shotgun" ? 0.05 : 0.022;
    this.recoilRoll += (Math.random() - 0.5) * 0.02;
    this.addShake(w.id === "sniper" ? 0.4 : w.id === "shotgun" ? 0.35 : 0.1);
    sfx.play(w.id === "ar" ? "shoot_ar" : w.id === "smg" ? "shoot_smg" : w.id === "shotgun" ? "shoot_shotgun" : "shoot_sniper");

    // muzzle flash
    const vm = this.vms.get(p.weapon)!;
    this.camera.updateMatrixWorld(true);
    vm.muzzle.getWorldPosition(this.tmpV);
    this.fx.muzzle(this.tmpV, 0xffbb55);

    const spreadBase = (w.spread + (this.horizSpeed(p) > 2 ? w.moveSpread : 0)) * (this.input.ads ? 0.45 : 1) * (p.slideT > 0 ? 2.2 : 1);
    const eye = this.tmpV2.set(p.pos.x, p.pos.y + TUNE.eyeHeight, p.pos.z);

    for (let i = 0; i < w.pellets; i++) {
      // direction from camera
      const dir = this.tmpV3.set(0, 0, -1).applyEuler(this.camera.rotation);
      dir.x += (Math.random() - 0.5) * spreadBase * 2;
      dir.y += (Math.random() - 0.5) * spreadBase * 2;
      dir.z += (Math.random() - 0.5) * spreadBase * 2;
      dir.normalize();

      // nearest entity (bots + networked humans)
      let bestEnt: Ent | null = null;
      let bestEntT = Infinity;
      let bestHead = false;
      for (const b of this.netTargets()) {
        if (!b.alive || b.spawnProtectT > 0) continue;
        if (!this.canHurt(p, b)) continue;
        const hit = this.raycastEnt(b, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z);
        if (hit && hit.t < bestEntT) { bestEntT = hit.t; bestEnt = b; bestHead = hit.head; }
      }
      const worldT = raycastWorld(this.colliders, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, w.range);

      const muzzle = this.tmpV;
      let endDist: number;
      if (bestEnt && bestEntT < worldT) {
        endDist = bestEntT;
        const dmg = Math.round(w.dmg * (bestHead ? w.headMul : 1));
        p.hits++;
        const hx = eye.x + dir.x * bestEntT, hy = eye.y + dir.y * bestEntT, hz = eye.z + dir.z * bestEntT;
        this.fx.blood(hx, hy, hz);
        // Networked humans are authoritative over their own health, so report
        // the hit instead of applying it. Host-simulated bots stay local.
        const netControlled = bestEnt.remote || (!this.mpIsHost && bestEnt.isBot);
        if (netControlled) {
          if (bestEnt.remote && bestEnt.netId && this.onReportHit) {
            this.onReportHit(bestEnt.netId, dmg, bestHead);
          } else if (bestEnt.isBot && this.onReportBotHit) {
            this.onReportBotHit(bestEnt.id, dmg, bestHead);
          }
          p.dmgDealt += dmg;
          if (bestEnt.alive) {
            this.hitKind = bestHead ? 2 : 1;
            this.hitKey++;
            sfx.play(bestHead ? "headshot" : "hit");
          }
        } else {
          this.damage(bestEnt, dmg, p, bestHead);
          if (bestEnt.alive) {
            this.hitKind = bestHead ? 2 : 1;
            this.hitKey++;
            sfx.play(bestHead ? "headshot" : "hit");
          }
        }
      } else {
        endDist = worldT;
        const hx = eye.x + dir.x * worldT, hy = eye.y + dir.y * worldT, hz = eye.z + dir.z * worldT;
        this.fx.impact(hx, hy, hz, dir.x, dir.y, dir.z, 0xffb347, 7);
      }
      const end = this.tmpV3.set(eye.x + dir.x * endDist, eye.y + dir.y * endDist, eye.z + dir.z * endDist);
      this.fx.tracer(muzzle, end, 0xffd27a);
    }
    if (a.mag <= 0) this.startReload();
    this.markHud();
  }

  private botFire(bot: Ent, target: Ent, spread: number, dmgMul: number) {
    if (!bot.alive || !target.alive) return;
    const eyeY = bot.pos.y + TUNE.eyeHeight;
    const dx = target.pos.x - bot.pos.x;
    const dy = target.pos.y + 1.15 - eyeY;
    const dz = target.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const dir = this.tmpV2.set(dx / d, dy / d, dz / d);
    dir.x += (Math.random() - 0.5) * spread * 2.4;
    dir.y += (Math.random() - 0.5) * spread * 1.6;
    dir.z += (Math.random() - 0.5) * spread * 2.4;
    dir.normalize();

    const entHit = this.raycastEnt(target, bot.pos.x, eyeY, bot.pos.z, dir.x, dir.y, dir.z);
    const worldT = raycastWorld(this.colliders, bot.pos.x, eyeY, bot.pos.z, dir.x, dir.y, dir.z, 60);

    const muzzle = this.tmpV.set(bot.pos.x + dir.x * 0.7, eyeY + dir.y * 0.7 - 0.08, bot.pos.z + dir.z * 0.7);
    let endDist = worldT;
    if (entHit && entHit.t < worldT) {
      endDist = entHit.t;
      const dmg = Math.round(BOT_DMG[bot.weapon] * dmgMul * (entHit.head ? 1.8 : 1));
      this.damage(target, dmg, bot, entHit.head);
      const hx = bot.pos.x + dir.x * entHit.t, hy = eyeY + dir.y * entHit.t, hz = bot.pos.z + dir.z * entHit.t;
      this.fx.blood(hx, hy, hz);
    } else {
      this.fx.impact(
        bot.pos.x + dir.x * worldT, eyeY + dir.y * worldT, bot.pos.z + dir.z * worldT,
        dir.x, dir.y, dir.z, 0xffa040, 5,
      );
    }
    const end = this.tmpV3.set(bot.pos.x + dir.x * endDist, eyeY + dir.y * endDist, bot.pos.z + dir.z * endDist);
    this.fx.tracer(muzzle, end, 0xff5566);
    this.fx.muzzle(muzzle, 0xff7766);
    sfx.play("shoot_ar", true);
  }

  private startReload() {
    const p = this.player;
    const w = WEAPONS[p.weapon];
    const a = p.ammo[p.weapon];
    if (p.reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return;
    p.reloadT = w.reload;
    sfx.play("reload");
    this.markHud();
  }

  private switchWeapon(id: WeaponId) {
    if (this.player.weapon === id) return;
    this.player.weapon = id;
    this.player.reloadT = 0;
    this.switchT = 0.28;
    sfx.play("ui");
    this.markHud();
  }

  private horizSpeed(e: Ent): number {
    return Math.hypot(e.vel.x, e.vel.z);
  }

  // ---------------------------------------------------------------- physics
  private moveEntity(e: Ent, dt: number) {
    moveBody(e, this.colliders, dt);
    // absolute failsafe: nothing should ever leave the arena
    if (Math.abs(e.pos.x) > 33 || Math.abs(e.pos.z) > 33 || e.pos.y < -20) {
      this.kill(e, e, false);
    }
  }

  private updatePlayerPhysics(dt: number) {
    const p = this.player;
    if (!p.alive) return;
    p.crouch = this.input.crouchHeld || p.slideT > 0;
    // slide trigger
    if (this.input.crouchHeld && this.input.sprintHeld && p.onGround && p.slideT <= 0 && this.horizSpeed(p) > 5) {
      p.slideT = TUNE.slideTime;
      p.slideDir.set(p.vel.x, 0, p.vel.z).normalize();
      sfx.play("slide");
    }
    const w = WEAPONS[p.weapon];
    const speed = p.crouch ? TUNE.crouchSpeed : this.input.sprintHeld ? TUNE.sprintSpeed : TUNE.walkSpeed;
    const f = this.tmpV.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const r = this.tmpV2.set(-f.z, 0, f.x);
    const ix = this.input.moveX, iz = this.input.moveZ;

    if (p.slideT > 0) {
      p.slideT -= dt;
      const s = TUNE.slideSpeed * (0.35 + 0.65 * (p.slideT / TUNE.slideTime));
      p.vel.x = p.slideDir.x * s + ix * 1.5;
      p.vel.z = p.slideDir.z * s + iz * 1.5;
    } else {
      const tx = f.x * iz + r.x * ix;
      const tz = f.z * iz + r.z * ix;
      const accel = p.onGround ? TUNE.groundAccel : TUNE.airAccel;
      p.vel.x = damp(p.vel.x, tx * speed, accel, dt);
      p.vel.z = damp(p.vel.z, tz * speed, accel, dt);
    }
    // gravity + jump
    p.vel.y -= TUNE.gravity * dt;
    if (this.input.jumpPressed && p.onGround) {
      p.vel.y = TUNE.jumpVel;
      p.slideT = 0;
      sfx.play("jump");
    }
    if (p.vel.y < -40) p.vel.y = -40;
    this.moveEntity(p, dt);

    // jump pads
    if (p.padCd > 0) p.padCd -= dt;
    for (const pad of this.map.pads) {
      const dx = p.pos.x - pad.x, dz = p.pos.z - pad.z;
      if (dx * dx + dz * dz < 0.81 && Math.abs(p.pos.y - pad.y) < 0.9 && p.padCd <= 0) {
        p.vel.y = TUNE.padLaunch;
        p.padCd = 0.35;
        p.onGround = false;
        this.fx.ring(pad.x, pad.y, pad.z, this.map.themeData.accent);
        sfx.play("pad");
      }
    }

    // weapon pads
    for (const wp of this.weaponPadMeshes) {
      if (wp.taken) {
        if (this.now > wp.respawnT) {
          wp.taken = false;
          wp.group.visible = true;
        }
        continue;
      }
      const dx = p.pos.x - wp.group.position.x, dz = p.pos.z - wp.group.position.z;
      if (dx * dx + dz * dz < 1.1 && p.pos.y < 1.6) {
        wp.taken = true;
        wp.respawnT = this.now + 20;
        wp.group.visible = false;
        this.switchWeapon(wp.weapon);
        p.ammo[wp.weapon] = { mag: WEAPONS[wp.weapon].mag, reserve: WEAPONS[wp.weapon].reserve };
        this.announce("PICKUP", WEAPONS[wp.weapon].name);
        sfx.play("pickup");
      }
    }

    // regen
    if (p.hp < TUNE.maxHp && p.alive && this.now - p.lastDamageT > TUNE.regenDelay) {
      p.hp = Math.min(TUNE.maxHp, p.hp + TUNE.regenRate * dt);
    }
    if (p.spawnProtectT > 0) p.spawnProtectT -= dt;

    // timers
    if (p.fireCd > 0) p.fireCd -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        p.reloadT = 0;
        const a = p.ammo[p.weapon];
        const need = w.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take;
        a.reserve -= take;
        sfx.play("ui");
      }
    }
    // fire
    const wantFire = this.input.fire || (this.settings.autoFire && this.isMobile);
    const fireEdge = w.auto ? wantFire : wantFire && !this.prevFire;
    this.prevFire = wantFire;
    if (fireEdge) this.firePlayer();
    if (this.input.reloadPressed) this.startReload();
    if (this.input.switchWeapon >= 0) {
      const id = WEAPON_ORDER[Math.min(this.input.switchWeapon, 3)];
      this.switchWeapon(id);
    }
  }

  private updateBots(dt: number) {
    const ctx: BotCtx = {
      now: this.now,
      rng: this.rng,
      difficulty: this.config.difficulty,
      arenaHalf: this.map.size,
      entities: [this.player, ...this.bots],
      colliders: this.colliders,
      fireAt: (bot, target, spread, dmgMul) => this.botFire(bot, target, spread, dmgMul),
      worldHit: (ox, oy, oz, dx, dy, dz, max) => raycastWorld(this.colliders, ox, oy, oz, dx, dy, dz, max),
    };
    for (const b of this.bots) {
      if (!b.alive) {
        b.deadT -= dt;
        if (b.deadT <= 0) this.spawnEntity(b);
        else if (b.rig && b.rig.fallT > 0 && b.rig.fallT < 1) {
          b.rig.fallT = Math.min(1, b.rig.fallT + dt * 3.2);
          b.rig.group.rotation.x = -b.rig.fallT * Math.PI / 2;
        }
        continue;
      }
      if (b.spawnProtectT > 0) b.spawnProtectT -= dt;
      if (b.padCd > 0) b.padCd -= dt;
      // regen
      if (b.hp < TUNE.maxHp && this.now - b.lastDamageT > TUNE.regenDelay) {
        b.hp = Math.min(TUNE.maxHp, b.hp + TUNE.regenRate * dt);
        if (b.rig) drawHpBar(b.rig, b.hp, TUNE.maxHp);
      }
      tickBot(b, ctx, dt);
      // physics
      const speed = b.input.sprint ? TUNE.sprintSpeed : TUNE.walkSpeed;
      b.vel.x = damp(b.vel.x, b.input.x * speed, 14, dt);
      b.vel.z = damp(b.vel.z, b.input.z * speed, 14, dt);
      b.vel.y -= TUNE.gravity * dt;
      if (b.input.jump && b.onGround) {
        b.vel.y = TUNE.jumpVel;
      }
      if (b.vel.y < -40) b.vel.y = -40;
      this.moveEntity(b, dt);
      // pads for bots too
      for (const pad of this.map.pads) {
        const dx = b.pos.x - pad.x, dz = b.pos.z - pad.z;
        if (dx * dx + dz * dz < 0.81 && Math.abs(b.pos.y - pad.y) < 0.9 && b.padCd <= 0) {
          b.vel.y = TUNE.padLaunch;
          b.padCd = 0.35;
          b.onGround = false;
        }
      }
      // rig update
      if (b.rig) {
        const rig = b.rig;
        if (rig.fallT > 0 && rig.fallT < 1) {
          rig.fallT = Math.min(1, rig.fallT + dt * 3.2);
          rig.group.rotation.x = -rig.fallT * Math.PI / 2;
          if (rig.fallT >= 1) rig.group.rotation.x = -Math.PI / 2;
        }
        rig.group.position.copy(b.pos);
        rig.group.rotation.y = b.yaw;
        if (rig.fallT <= 0) {
          rig.group.rotation.x = 0;
          updateCharacterAnim(rig, this.horizSpeed(b), b.pitch, dt);
        }
        drawHpBar(rig, b.hp, TUNE.maxHp);
      }
    }
  }

  // ---------------------------------------------------------------- camera
  private updateCamera(dt: number) {
    const p = this.player;
    const eyeH = p.crouch ? TUNE.crouchEyeHeight : TUNE.eyeHeight;
    const speedF = clamp(this.horizSpeed(p) / TUNE.walkSpeed, 0, 1.4);
    if (p.onGround && p.alive) {
      this.bobT += dt * (4 + speedF * 6);
    }
    const bobY = Math.abs(Math.sin(this.bobT)) * 0.035 * speedF * (p.alive ? 1 : 0);
    const bobX = Math.sin(this.bobT) * 0.02 * speedF * (p.alive ? 1 : 0);

    this.camera.position.set(p.pos.x + bobX, p.pos.y + eyeH + bobY, p.pos.z);

    // recoil
    this.recoilPitch = damp(this.recoilPitch, 0, 9, dt);
    this.recoilRoll = damp(this.recoilRoll, 0, 9, dt);
    // shake
    this.shakeAmp *= Math.exp(-7 * dt);
    if (this.shakeAmp < 0.001) this.shakeAmp = 0;
    const shX = (Math.random() - 0.5) * this.shakeAmp * 0.5;
    const shY = (Math.random() - 0.5) * this.shakeAmp * 0.5;
    const shZ = (Math.random() - 0.5) * this.shakeAmp * 0.3;

    if (p.alive) {
      this.camera.rotation.y = p.yaw + shY * 0.15;
      this.camera.rotation.x = clamp(p.pitch + this.recoilPitch + shX * 0.15, -1.5, 1.5);
      this.camera.rotation.z = shZ;
    } else {
      this.camera.rotation.x = -0.5;
      this.camera.rotation.z = 0.2;
    }

    // fov
    const w = WEAPONS[p.weapon];
    const targetFov = this.input.ads ? w.zoomMul * this.baseFov : this.baseFov + (this.input.sprintHeld && this.horizSpeed(p) > 4 ? 8 : 0) + (p.slideT > 0 ? 6 : 0);
    this.fov = damp(this.fov, targetFov, 12, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // viewmodel
    const vm = this.vms.get(p.weapon);
    if (vm) {
      for (const [id, v] of this.vms) v.group.visible = id === p.weapon && p.alive;
      if (p.alive) {
        const ads = this.input.ads;
        const tx = ads ? 0 : 0.3;
        const ty = ads ? -0.19 : -0.27;
        const tz = ads ? -0.38 : -0.5;
        vm.group.position.x = damp(vm.group.position.x, tx, 14, dt);
        vm.group.position.y = damp(vm.group.position.y, ty + bobY * 0.6, 14, dt);
        vm.group.position.z = damp(vm.group.position.z, tz, 14, dt);
        // sway from look
        this.swayX = damp(this.swayX, 0, 8, dt);
        this.swayY = damp(this.swayY, 0, 8, dt);
        vm.group.rotation.x = this.recoilPitch * 1.6 + this.swayY * 0.35;
        vm.group.rotation.y = this.swayX * 0.35;
        // reload dip
        if (p.reloadT > 0) {
          const k = 1 - p.reloadT / w.reload;
          const dip = Math.sin(k * Math.PI);
          vm.group.position.y -= dip * 0.14;
          vm.group.rotation.x -= dip * 0.7;
        }
        if (this.switchT > 0) {
          this.switchT -= dt;
          vm.group.position.y -= (this.switchT / 0.28) * 0.35;
        }
      }
    }
    // sun follows player for even shadows
    this.sun.position.set(p.pos.x + 28, 42, p.pos.z + 18);
    this.sun.target.position.set(p.pos.x, 0, p.pos.z);
  }

  // ---------------------------------------------------------------- update
  private update(dt: number) {
    // consume look input (always, even when paused? no — paused freezes)
    if (this.state !== "paused") {
      const sens = this.settings.sens * 0.0021 * (this.fov / this.baseFov);
      this.player.yaw -= this.input.lookDX * sens;
      this.player.pitch = clamp(this.player.pitch - this.input.lookDY * sens, -1.5, 1.5);
      this.swayX = clamp(this.swayX + this.input.lookDX * 0.0009, -0.06, 0.06);
      this.swayY = clamp(this.swayY + this.input.lookDY * 0.0009, -0.06, 0.06);
    }
    this.input.lookDX = 0;
    this.input.lookDY = 0;

    if (this.state === "paused") {
      return;
    }

    this.now += dt;

    if (this.state === "warmup") {
      this.warmupT -= dt;
      this.updateAmbient(dt);
      this.fx.update(dt);
      if (this.warmupT <= 0) {
        this.state = "playing";
        this.announce("FIGHT!", `${this.config.botCount + 1} players · ${MAP_LABEL[this.config.map]}`);
        sfx.play("go");
        sfx.startMusic();
      }
      this.updateCamera(dt);
      this.emitHudTick(dt);
      return;
    }

    if (this.state === "playing") {
      this.timeLeft -= dt;
      this.updatePlayerPhysics(dt);
      // player death / respawn
      if (!this.player.alive) {
        this.player.deadT -= dt;
        if (this.player.deadT <= 0) this.spawnEntity(this.player);
      }
      this.updateBots(dt);
      // edges
      this.input.jumpPressed = false;
      this.input.crouchPressed = false;
      this.input.reloadPressed = false;
      this.input.switchWeapon = -1;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.endMatch();
      }
    } else {
      // ended — gentle idle
      this.updateAmbient(dt);
    }

    // pad pulse + weapon float
    const t = this.now;
    for (let i = 0; i < this.padMeshes.length; i++) {
      const m = this.padMeshes[i];
      const s = 1 + Math.sin(t * 4 + i) * 0.12;
      m.scale.set(s, 1, s);
    }
    for (const wp of this.weaponPadMeshes) {
      if (wp.taken) continue;
      wp.floatBox.rotation.y = t * 1.6;
      wp.floatBox.position.y = 0.85 + Math.sin(t * 2.4) * 0.08;
    }

    this.fx.update(dt);
    this.updateCamera(dt);
    this.emitHudTick(dt);
  }

  private updateAmbient(dt: number) {
    for (const b of this.bots) {
      if (!b.alive) continue;
      if (b.rig) {
        b.rig.group.position.copy(b.pos);
        b.rig.group.rotation.y = b.yaw;
        updateCharacterAnim(b.rig, 0, 0, dt);
      }
    }
  }

  private emitHudTick(dt: number) {
    this.hudTick -= dt;
    if (this.hudTick <= 0) {
      this.hudTick = 0.1;
      this.hudDirty = true;
    }
    if (this.hudDirty) {
      this.hudDirty = false;
      const p = this.player;
      const a = p.ammo[p.weapon];
      const w = WEAPONS[p.weapon];
      this.cb.onHud({
        state: this.state,
        warmup: Math.max(0, this.warmupT),
        timeLeft: Math.max(0, this.timeLeft),
        hp: Math.ceil(p.hp),
        mag: a.mag, reserve: a.reserve,
        reloadT: p.reloadT, reloadDur: w.reload,
        weapon: p.weapon, weaponName: w.name,
        score: p.score, kills: p.kills, deaths: p.deaths, streak: p.streak,
        feed: [...this.feed],
        announceKey: this.announceKey,
        announceText: this.announceText,
        announceSub: this.announceSub,
        hitKey: this.hitKey,
        hitKind: this.hitKind,
        dmgKey: this.dmgKey,
        dmgAmp: this.dmgAmp,
        dmgAngle: this.dmgAngle,
        killerName: this.killerName,
        deadT: Math.max(0, p.deadT),
        protectedT: Math.max(0, p.spawnProtectT),
        standings: this.standings(),
        scoped: this.input.ads && p.weapon === "sniper",
        fps: Math.round(this.fpsEma),
        playerCount: this.bots.length + 1,
        scoreLimit: this.config.scoreLimit,
      });
    }
    // decay dmg amp
    this.dmgAmp = damp(this.dmgAmp, 0, 3, dt);
  }

  private markHud() {
    this.hudDirty = true;
  }

  /** Wired by the host's net client: a hit on a networked human. */
  onReportHit: ((targetPlayerId: string, dmg: number, head: boolean) => void) | null = null;
  /** Wired by a guest's net client: a hit on a host-simulated bot. */
  onReportBotHit: ((botId: number, dmg: number, head: boolean) => void) | null = null;

  resize = () => {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // =====================================================================
  // MULTIPLAYER
  // =====================================================================

  private mpEnabled = false;
  private mpIsHost = true;
  private mpTeamMode: "ffa" | "teams" = "ffa";
  private mpMyTeam = 0;
  private remotes = new Map<string, Ent>();
  /** bots created on a guest from the host's snapshot, keyed by host bot id */
  private netBots = new Map<number, Ent>();
  private netBotSeq = 10000;

  get multiplayerActive(): boolean {
    return this.mpEnabled;
  }

  /**
   * Switch the engine into networked mode. On a guest the local bots are
   * discarded — the host's snapshot is the source of truth for them.
   */
  initMultiplayer(cfg: MultiplayerConfig): void {
    this.mpEnabled = true;
    this.player.netId = cfg.playerId;
    this.mpIsHost = cfg.isHost;
    this.mpTeamMode = cfg.teamMode;
    this.mpMyTeam = cfg.myTeam;
    this.player.team = cfg.myTeam;
    if (!cfg.isHost) {
      // Guests don't simulate bots; they are created on demand from snapshots.
      for (const b of this.bots) {
        if (b.rig) this.scene.remove(b.rig.group);
      }
      this.bots = [];
    }
    this.markHud();
  }

  setHostRole(isHost: boolean): void {
    this.mpIsHost = isHost;
  }

  /** Can attacker hurt target? Applies the team rules. */
  private canHurt(attacker: Ent, target: Ent): boolean {
    if (this.mpTeamMode === "ffa") return attacker !== target;
    return attacker.team !== target.team;
  }

  /** Create (or refresh) the blocky rig for a networked human. */
  private ensureRemote(id: string, name: string, color: number): Ent {
    let e = this.remotes.get(id);
    if (e) {
      if (e.name !== name) {
        e.name = name;
        if (e.rig) {
          this.scene.remove(e.rig.group);
          e.rig = makeCharacter(name, color);
          this.scene.add(e.rig.group);
        }
      }
      return e;
    }
    e = {
      id: this.netBotSeq++,
      name,
      isBot: false,
      remote: true,
      netId: id,
      color,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      onGround: false, crouch: false,
      slideT: 0, slideDir: new THREE.Vector3(),
      hp: 100, alive: true, weapon: "ar",
      ammo: this.freshAmmo(),
      fireCd: 0, reloadT: 0,
      kills: 0, deaths: 0, score: 0, streak: 0,
      lastDamageT: -10, deadT: 0, spawnProtectT: 0, padCd: 0,
      input: { x: 0, z: 0, jump: false, sprint: false, crouch: false },
      ads: false, shots: 0, hits: 0, dmgDealt: 0, bestStreak: 0,
    };
    e.rig = makeCharacter(name, color);
    this.scene.add(e.rig.group);
    this.remotes.set(id, e);
    return e;
  }

  /** Called on every net tick with the roster + interpolated samples. */
  updateRemotePlayers(input: RemotePlayersInput): void {
    const seen = new Set<string>();
    for (const p of input.players) {
      if (p.playerId === this.player.netId) continue;
      seen.add(p.playerId);
      const e = this.ensureRemote(p.playerId, p.name, p.color);
      e.team = p.team;
      e.hp = p.hp;
      e.alive = p.alive;
      e.weapon = p.weapon;
      e.kills = p.kills;
      e.deaths = p.deaths;
      e.score = p.score;
      const s = input.sampleOf(p.playerId);
      if (s) {
        e.pos.set(s.x, s.y, s.z);
        e.yaw = s.yaw;
        e.pitch = s.pitch;
      }
      if (e.rig) {
        const rig = e.rig;
        rig.group.visible = true;
        if (!p.alive) {
          rig.fallT = 1;
          rig.group.rotation.x = -Math.PI / 2;
          rig.hpSprite.visible = false;
        } else {
          if (rig.fallT > 0) {
            rig.fallT = 0;
            rig.group.rotation.x = 0;
            rig.lastHpDrawn = -1;
          }
          rig.hpSprite.visible = true;
          rig.group.position.copy(e.pos);
          rig.group.rotation.y = e.yaw;
          updateCharacterAnim(rig, 2.2, e.pitch, 1 / 60);
          drawHpBar(rig, p.hp, TUNE.maxHp);
        }
      }
    }
    // Remove players who left.
    for (const [id, e] of [...this.remotes]) {
      if (seen.has(id)) continue;
      if (e.rig) this.scene.remove(e.rig.group);
      this.remotes.delete(id);
    }
  }

  /** Guest: build/refresh bots from the host's snapshot. */
  updateNetBots(input: NetBotsInput): void {
    const seen = new Set<number>();
    for (const b of input.bots) {
      seen.add(b.id);
      let e = this.netBots.get(b.id);
      if (!e) {
        e = {
          id: b.id, name: b.name, isBot: true, color: b.color,
          pos: new THREE.Vector3(), vel: new THREE.Vector3(),
          yaw: 0, pitch: 0, onGround: false, crouch: false,
          slideT: 0, slideDir: new THREE.Vector3(),
          hp: b.hp, alive: b.alive, weapon: "ar",
          ammo: this.freshAmmo(),
          fireCd: 0, reloadT: 0, kills: 0, deaths: 0, score: 0, streak: 0,
          lastDamageT: -10, deadT: 0, spawnProtectT: 0, padCd: 0,
          input: { x: 0, z: 0, jump: false, sprint: false, crouch: false },
          ads: false, shots: 0, hits: 0, dmgDealt: 0, bestStreak: 0,
        };
        e.rig = makeCharacter(b.name, b.color);
        this.scene.add(e.rig.group);
        this.netBots.set(b.id, e);
      }
      e.team = b.team;
      e.hp = b.hp;
      e.alive = b.alive;
      const s = input.sampleOf(b.id);
      if (s) {
        e.pos.set(s.x, s.y, s.z);
        e.yaw = s.yaw;
        e.pitch = s.pitch;
      }
      if (e.rig) {
        const rig = e.rig;
        rig.group.visible = true;
        if (!b.alive) {
          rig.fallT = 1;
          rig.group.rotation.x = -Math.PI / 2;
          rig.hpSprite.visible = false;
        } else {
          if (rig.fallT > 0) { rig.fallT = 0; rig.group.rotation.x = 0; rig.lastHpDrawn = -1; }
          rig.hpSprite.visible = true;
          rig.group.position.copy(e.pos);
          rig.group.rotation.y = e.yaw;
          updateCharacterAnim(rig, 2.0, e.pitch, 1 / 60);
          drawHpBar(rig, b.hp, TUNE.maxHp);
        }
      }
    }
    for (const [id, e] of [...this.netBots]) {
      if (seen.has(id)) continue;
      if (e.rig) this.scene.remove(e.rig.group);
      this.netBots.delete(id);
    }
  }

  /** Everyone I can shoot right now. */
  private netTargets(): Ent[] {
    const out: Ent[] = [...this.remotes.values()];
    out.push(...(this.mpIsHost ? this.bots : this.netBots.values()));
    return out;
  }

  /** Apply damage another player claims to have dealt to me. */
  applyNetDamage(dmg: number, fromName: string, head: boolean): void {
    if (!this.player.alive || this.player.spawnProtectT > 0) return;
    this.damage(this.player, dmg, this.mkProxy(fromName), head);
  }

  /** Host: apply damage a guest claims against one of my bots. */
  private botHitQueue: BotHitIn[] = [];
  applyBotDamage(botId: number, dmg: number, head: boolean): void {
    const bot = this.bots.find((b) => b.id === botId);
    if (!bot || !bot.alive || bot.spawnProtectT > 0) return;
    this.damage(bot, dmg, this.mkProxy("player"), head);
    if (bot.alive) {
      this.hitKind = head ? 2 : 1;
      this.hitKey++;
    }
  }
  /** Consume guest damage claims so the net layer can relay attribution. */
  drainBotHitQueue(): BotHitIn[] {
    const out = this.botHitQueue;
    this.botHitQueue = [];
    return out;
  }

  /** Synonymous attacker used so feed/kill attribution has a name. */
  private mkProxy(name: string): Ent {
    const existing = this.proxyCache.get(name);
    if (existing) return existing;
    const proxy: Ent = {
      id: this.netBotSeq++, name, isBot: false, remote: true, color: 0x94a3b8,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      yaw: 0, pitch: 0, onGround: false, crouch: false,
      slideT: 0, slideDir: new THREE.Vector3(),
      hp: 1, alive: true, weapon: "ar", ammo: this.freshAmmo(),
      fireCd: 0, reloadT: 0, kills: 0, deaths: 0, score: 0, streak: 0,
      lastDamageT: -10, deadT: 0, spawnProtectT: 0, padCd: 0,
      input: { x: 0, z: 0, jump: false, sprint: false, crouch: false },
      ads: false, shots: 0, hits: 0, dmgDealt: 0, bestStreak: 0,
      team: this.mpTeamMode === "ffa" ? -1 : -2,
    };
    this.proxyCache.set(name, proxy);
    return proxy;
  }
  private proxyCache = new Map<string, Ent>();

  /** Live state handed to the net client each tick. */
  netLocalState() {
    const p = this.player;
    return {
      x: p.pos.x, y: p.pos.y, z: p.pos.z,
      yaw: p.yaw, pitch: p.pitch,
      hp: Math.ceil(p.hp), alive: p.alive,
      weapon: p.weapon,
      deaths: p.deaths,
      streak: p.streak,
    };
  }

  /**
   * Host: assemble the world snapshot for the other players.
   * `extraEvents` carries damage other players claimed against my bots.
   */
  buildSnapshot(tick: number, timeLeft: number, extraEvents: NetEventIn[]) {
    const bots: Array<Record<string, unknown>> = this.mpIsHost
      ? this.bots.map((b) => ({
          id: b.id, name: b.name, color: b.color, team: b.team,
          x: round2(b.pos.x), y: round2(b.pos.y), z: round2(b.pos.z),
          yaw: round2(b.yaw), pitch: round2(b.pitch),
          hp: Math.ceil(b.hp), alive: b.alive,
          kills: b.kills, deaths: b.deaths, score: b.score,
        }))
      : [];
    return {
      tick,
      bots,
      events: extraEvents,
      timeLeft: Math.ceil(timeLeft),
    };
  }

  /** Scoreboard across humans (local + remote). */
  netStandings(): Standing[] {
    const rows: Standing[] = [
      { name: this.player.name, color: this.player.color, kills: this.player.kills, deaths: this.player.deaths, score: this.player.score, isPlayer: true, team: this.player.team },
    ];
    for (const r of this.remotes.values()) {
      rows.push({ name: r.name, color: r.color, kills: r.kills, deaths: r.deaths, score: r.score, isPlayer: false, team: r.team });
    }
    const bots = this.mpIsHost ? this.bots : [...this.netBots.values()];
    for (const b of bots) {
      rows.push({ name: b.name, color: b.color, kills: b.kills, deaths: b.deaths, score: b.score, isPlayer: false, team: b.team });
    }
    return rows.sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
