// ---------------------------------------------------------------------------
// Bot characters + AI. Blocky Krunker-style humanoids built from boxes with
// canvas face textures, floating name tags and HP bars. AI is state-light:
// acquire nearest visible target, keep range, strafe, jump, shoot.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { DIFFICULTY_TUNING, Difficulty, TUNE } from "./config";
import type { Ent } from "./engine";

export interface CharacterRig {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  lArm: THREE.Group;
  rArm: THREE.Group;
  lLeg: THREE.Group;
  rLeg: THREE.Group;
  gun: THREE.Group;
  nameSprite: THREE.Sprite;
  hpSprite: THREE.Sprite;
  hpCanvas: HTMLCanvasElement;
  hpCtx: CanvasRenderingContext2D;
  mats: THREE.MeshStandardMaterial[];
  walkPhase: number;
  flashT: number;
  fallT: number;
  lastHpDrawn: number;
}

function makeFaceTexture(color: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  const col = "#" + color.toString(16).padStart(6, "0");
  g.fillStyle = col;
  g.fillRect(0, 0, 64, 64);
  // visor
  g.fillStyle = "rgba(10,12,20,0.92)";
  g.fillRect(4, 18, 56, 20);
  // glowing eyes
  g.fillStyle = "#7df9ff";
  g.fillRect(12, 24, 12, 8);
  g.fillRect(40, 24, 12, 8);
  // mouth grille
  g.fillStyle = "rgba(0,0,0,0.5)";
  for (let i = 0; i < 4; i++) g.fillRect(20 + i * 7, 44, 4, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNameTexture(name: string, color: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "bold 30px ui-monospace, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.85)";
  g.strokeText(name, 128, 30);
  g.fillStyle = "#" + color.toString(16).padStart(6, "0");
  g.fillText(name, 128, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeCharacter(name: string, color: number): CharacterRig {
  const group = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];
  const mat = (c: number) => {
    const m = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.7,
      metalness: 0.15,
    });
    mats.push(m);
    return m;
  };
  const bodyMat = mat(color);
  const darkMat = mat(0x1a1d29);
  const headMat = new THREE.MeshStandardMaterial({
    map: makeFaceTexture(color),
    roughness: 0.7,
    metalness: 0.1,
  });
  mats.push(headMat);

  // body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.32), bodyMat);
  body.position.y = 1.06;
  group.add(body);
  // head (faces -Z, same as camera yaw 0)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), headMat);
  head.position.y = 1.56;
  group.add(head);
  // arms (pivot at shoulder)
  const mkArm = (side: number) => {
    const a = new THREE.Group();
    a.position.set(side * 0.34, 1.34, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.55, 0.15), bodyMat);
    m.position.y = -0.26;
    a.add(m);
    group.add(a);
    return a;
  };
  const lArm = mkArm(-1);
  const rArm = mkArm(1);
  // legs (pivot at hip)
  const mkLeg = (side: number) => {
    const l = new THREE.Group();
    l.position.set(side * 0.13, 0.76, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.76, 0.19), darkMat);
    m.position.y = -0.38;
    l.add(m);
    group.add(l);
    return l;
  };
  const lLeg = mkLeg(-1);
  const rLeg = mkLeg(1);
  // gun in right hand
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.16, 0.62),
    darkMat,
  );
  gun.add(gunBody);
  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.34),
    mat(0x333844),
  );
  barrel.position.set(0, 0.02, -0.44);
  gun.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.1), darkMat);
  mag.position.set(0, -0.18, 0.05);
  mag.rotation.x = 0.3;
  gun.add(mag);
  gun.position.set(0, -0.32, -0.18);
  rArm.add(gun);

  // name tag
  const nameSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeNameTexture(name, color),
      transparent: true,
      depthWrite: false,
    }),
  );
  nameSprite.scale.set(1.9, 0.47, 1);
  nameSprite.position.y = 2.15;
  group.add(nameSprite);

  // HP bar
  const hpCanvas = document.createElement("canvas");
  hpCanvas.width = 128;
  hpCanvas.height = 16;
  const hpCtx = hpCanvas.getContext("2d")!;
  const hpSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(hpCanvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  hpSprite.scale.set(1.05, 0.13, 1);
  hpSprite.position.y = 1.92;
  group.add(hpSprite);

  group.traverse((o) => {
    o.frustumCulled = false;
    o.renderOrder = 5;
  });

  return {
    group,
    body,
    head,
    lArm,
    rArm,
    lLeg,
    rLeg,
    gun,
    nameSprite,
    hpSprite,
    hpCanvas,
    hpCtx,
    mats,
    walkPhase: 0,
    flashT: 0,
    fallT: 0,
    lastHpDrawn: -1,
  };
}

export function drawHpBar(rig: CharacterRig, hp: number, maxHp: number) {
  if (Math.round(hp) === rig.lastHpDrawn) return;
  rig.lastHpDrawn = Math.round(hp);
  const g = rig.hpCtx;
  g.clearRect(0, 0, 128, 16);
  g.fillStyle = "rgba(0,0,0,0.65)";
  g.fillRect(0, 0, 128, 16);
  const frac = Math.max(0, hp / maxHp);
  g.fillStyle = frac > 0.5 ? "#3ddc84" : frac > 0.25 ? "#ffb800" : "#ff4444";
  g.fillRect(2, 2, 124 * frac, 12);
  (rig.hpSprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
}

export function updateCharacterAnim(
  rig: CharacterRig,
  speed: number,
  pitch: number,
  dt: number,
) {
  if (rig.fallT > 0) {
    // lying dead — no anim
    return;
  }
  const moving = speed > 0.6;
  if (moving) rig.walkPhase += speed * dt * 2.4;
  const swing = moving ? Math.sin(rig.walkPhase) * 0.75 : 0;
  rig.lLeg.rotation.x = swing;
  rig.rLeg.rotation.x = -swing;
  rig.lArm.rotation.x = -swing * 0.8;
  rig.rArm.rotation.x = -pitch;
  rig.gun.rotation.x = 0;
  // aim gun toward pitch (rArm rotates, gun inside follows)
  rig.group.position.y = moving ? Math.abs(Math.sin(rig.walkPhase)) * 0.04 : 0;
  // hit flash decay
  if (rig.flashT > 0) {
    rig.flashT -= dt;
    const f = Math.max(0, rig.flashT / 0.12);
    for (const m of rig.mats) m.emissive.setRGB(f, f * 0.25, f * 0.25);
    if (rig.flashT <= 0) for (const m of rig.mats) m.emissive.setRGB(0, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface BotCtx {
  now: number;
  rng: () => number;
  difficulty: Difficulty;
  arenaHalf: number;
  entities: Ent[];
  colliders: {
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
  }[];
  fireAt: (bot: Ent, target: Ent, spread: number, dmg: number) => void;
  worldHit: (
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    max: number,
  ) => number;
}

export interface BotBrain {
  dest: THREE.Vector3;
  repathT: number;
  reactT: number;
  fireT: number;
  strafeDir: number;
  strafeT: number;
  dodgeT: number;
  targetId: number;
  lastX: number;
  lastZ: number;
  stuckT: number;
}

export function makeBotBrain(rng: () => number): BotBrain {
  return {
    dest: new THREE.Vector3(rng() * 40 - 20, 0, rng() * 40 - 20),
    repathT: 2 + rng() * 3,
    reactT: 0,
    fireT: 0.5,
    strafeDir: 1,
    strafeT: 0.6 + rng(),
    dodgeT: 1 + rng() * 2,
    targetId: -1,
    lastX: 0,
    lastZ: 0,
    stuckT: 0,
  };
}

function angleLerp(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + THREE.MathUtils.clamp(d, -maxStep, maxStep);
}

export function tickBot(bot: Ent, ctx: BotCtx, dt: number) {
  const brain = bot.brain!;
  const tun = DIFFICULTY_TUNING[ctx.difficulty];
  const rng = ctx.rng;

  // --- find target ---------------------------------------------------------
  let target: Ent | null = null;
  let bestD = 46;
  const eyeY = bot.pos.y + TUNE.eyeHeight;
  for (const e of ctx.entities) {
    if (e === bot || !e.alive) continue;
    if (e.spawnProtectT > 0) continue;
    const dx = e.pos.x - bot.pos.x,
      dz = e.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    const dirX = dx / d,
      dirZ = dz / d;
    const dy = e.pos.y + 1.2 - eyeY;
    const wh = ctx.worldHit(
      bot.pos.x,
      eyeY,
      bot.pos.z,
      dirX,
      dy / d,
      dirZ,
      d - 0.5,
    );
    if (wh < d - 0.5) continue;
    target = e;
    bestD = d;
  }

  // --- movement intent -------------------------------------------------------
  let ix = 0,
    iz = 0;
  let jump = false;
  let sprint = false;

  if (target) {
    if (brain.targetId !== target.id) {
      brain.targetId = target.id;
      brain.reactT = tun.react * (0.8 + rng() * 0.5);
    }
    const dx = target.pos.x - bot.pos.x,
      dz = target.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(dx, dz);
    bot.yaw = angleLerp(bot.yaw, wantYaw, 7.5 * dt);
    bot.pitch = THREE.MathUtils.clamp(
      Math.atan2(target.pos.y + 1.1 - eyeY, Math.max(0.1, d)),
      -1.1,
      1.1,
    );

    if (d > 13) {
      ix = dx / d;
      iz = dz / d;
      sprint = true;
    } else if (d < 6) {
      // back off while still facing
      ix = (-dx / d) * 0.7;
      iz = (-dz / d) * 0.7;
    } else {
      // strafe
      brain.strafeT -= dt;
      if (brain.strafeT <= 0) {
        brain.strafeT = 0.5 + rng() * 1.0;
        brain.strafeDir = rng() > 0.5 ? 1 : -1;
      }
      ix = (dx / d) * 0.25 + (-dz / d) * brain.strafeDir;
      iz = (dz / d) * 0.25 + (dx / d) * brain.strafeDir;
    }
    // occasional dodge jump
    brain.dodgeT -= dt;
    if (brain.dodgeT <= 0) {
      brain.dodgeT = 1.4 + rng() * 2.4;
      if (d < 12 && rng() > 0.4) jump = true;
    }
    // --- shoot ---
    brain.reactT -= dt;
    brain.fireT -= dt;
    if (brain.reactT <= 0 && brain.fireT <= 0 && bestD < 44) {
      brain.fireT = tun.fireDelay * (0.85 + rng() * 0.4);
      const spread = tun.spread * (1 + bestD / 34);
      ctx.fireAt(bot, target, spread, tun.dmgMul);
    }
  } else {
    brain.targetId = -1;
    // patrol toward dest
    brain.repathT -= dt;
    const dx = brain.dest.x - bot.pos.x,
      dz = brain.dest.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.6 || brain.repathT <= 0) {
      brain.dest.set(
        rng() * (ctx.arenaHalf * 2 - 6) - ctx.arenaHalf + 3,
        0,
        rng() * (ctx.arenaHalf * 2 - 6) - ctx.arenaHalf + 3,
      );
      brain.repathT = 4 + rng() * 5;
    } else {
      ix = dx / d;
      iz = dz / d;
      sprint = rng() > 0.6;
    }
    // stuck detection → jump + new dest
    const moved = Math.hypot(bot.pos.x - brain.lastX, bot.pos.z - brain.lastZ);
    brain.lastX = bot.pos.x;
    brain.lastZ = bot.pos.z;
    if (moved < 0.02) {
      brain.stuckT += dt;
      if (brain.stuckT > 0.4) {
        jump = true;
        brain.stuckT = 0;
        if (rng() > 0.5) brain.repathT = 0;
      }
    } else {
      brain.stuckT = 0;
    }
  }

  // write intent (engine physics consumes it)
  const len = Math.hypot(ix, iz);
  if (len > 0.01) {
    ix /= len;
    iz /= len;
  }
  bot.input.x = ix;
  bot.input.z = iz;
  bot.input.jump = jump;
  bot.input.sprint = sprint;
  bot.input.crouch = false;
}
