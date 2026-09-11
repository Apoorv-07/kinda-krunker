// ---------------------------------------------------------------------------
// Pooled visual effects: GPU point particles (sparks + smoke), tracers,
// muzzle flashes with light, and jump-pad rings. Zero per-frame allocation.
// ---------------------------------------------------------------------------

import * as THREE from "three";

const MAX_PARTICLES = 600;
const MAX_TRACERS = 32;
const MAX_FLASHES = 10;
const MAX_RINGS = 12;

const PARTICLE_VERT = `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (240.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  float a = smoothstep(0.5, 0.08, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

class ParticlePool {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private baseSize: Float32Array;
  private baseAlpha: Float32Array;
  private head = 0;
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, blending: THREE.Blending, capacity: number) {
    const cap = Math.min(capacity, MAX_PARTICLES);
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.baseSize = new Float32Array(cap);
    this.baseAlpha = new Float32Array(cap);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      "aColor",
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      "aSize",
      new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      "aAlpha",
      new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage),
    );

    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  burst(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    count: number,
    speed: number,
    size: number,
    life: number,
    gravity = 12,
    drag = 2.5,
    spreadY = 1,
    alpha = 1,
  ) {
    for (let i = 0; i < count; i++) {
      const idx = this.head;
      this.head = (this.head + 1) % this.life.length;
      const i3 = idx * 3;
      this.pos[i3] = x;
      this.pos[i3 + 1] = y;
      this.pos[i3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const up = (Math.random() - 0.2) * spreadY;
      const s = speed * (0.35 + Math.random() * 0.85);
      this.vel[i3] = Math.cos(a) * s;
      this.vel[i3 + 1] = up * s;
      this.vel[i3 + 2] = Math.sin(a) * s;
      const jitter = 0.75 + Math.random() * 0.45;
      this.col[i3] = Math.min(1, color.r * jitter);
      this.col[i3 + 1] = Math.min(1, color.g * jitter);
      this.col[i3 + 2] = Math.min(1, color.b * jitter);
      const L = life * (0.6 + Math.random() * 0.8);
      this.life[idx] = L;
      this.maxLife[idx] = L;
      this.grav[idx] = gravity;
      this.drag[idx] = drag;
      this.baseSize[idx] = size * (0.6 + Math.random() * 0.9);
      this.baseAlpha[idx] = alpha * (0.7 + Math.random() * 0.5);
      this.size[idx] = this.baseSize[idx];
      this.alpha[idx] = this.baseAlpha[idx];
    }
  }

  update(dt: number) {
    const n = this.life.length;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const dragF = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dragF;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dragF - this.grav[i] * dt;
      this.vel[i3 + 2] *= dragF;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.vel[i3 + 1] < 0) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] *= -0.3;
      }
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = this.baseAlpha[i] * t;
      this.size[i] = this.baseSize[i] * (0.5 + t * 0.5);
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate =
      true;
    (this.geo.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate =
      true;
    (this.geo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate =
      true;
    (this.geo.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate =
      true;
  }
}

interface Tracer {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  life: number;
  maxLife: number;
}

interface Flash {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  life: number;
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
}

export class FxSystem {
  sparks: ParticlePool;
  smoke: ParticlePool;
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private rings: Ring[] = [];
  private tmpColor = new THREE.Color();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparks = new ParticlePool(
      scene,
      THREE.AdditiveBlending,
      MAX_PARTICLES,
    );
    this.smoke = new ParticlePool(scene, THREE.NormalBlending, 220);

    // tracer pool
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = 9;
      scene.add(line);
      this.tracers.push({ line, mat, life: 0, maxLife: 0.07 });
    }

    // muzzle flash pool
    const flashGeo = new THREE.PlaneGeometry(0.34, 0.34);
    for (let i = 0; i < MAX_FLASHES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffcf80,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(flashGeo, mat);
      mesh.visible = false;
      const light = new THREE.PointLight(0xffaa44, 0, 9, 2);
      scene.add(mesh);
      scene.add(light);
      this.flashes.push({ mesh, light, life: 0 });
    }

    // jump pad rings
    const ringGeo = new THREE.RingGeometry(0.55, 0.8, 32);
    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, mat, life: 0, maxLife: 0.5 });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffd27a) {
    const t = this.tracers.find((x) => x.life <= 0);
    if (!t) return;
    const attr = t.line.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    t.mat.color.setHex(color);
    t.mat.opacity = 0.9;
    t.life = t.maxLife;
  }

  muzzle(pos: THREE.Vector3, color = 0xffaa44) {
    const f = this.flashes.find((x) => x.life <= 0);
    if (!f) return;
    f.mesh.visible = true;
    f.mesh.position.copy(pos);
    f.mesh.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.9;
    f.mesh.scale.set(s, s, s);
    (f.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    f.light.position.copy(pos);
    f.light.color.setHex(color);
    f.light.intensity = 2.4;
    f.life = 0.055;
  }

  ring(x: number, y: number, z: number, color = 0x00e5ff) {
    const r = this.rings.find((x) => x.life <= 0);
    if (!r) return;
    r.mesh.visible = true;
    r.mesh.position.set(x, y + 0.06, z);
    r.mat.color.setHex(color);
    r.mat.opacity = 0.9;
    r.mesh.scale.setScalar(0.5);
    r.life = r.maxLife;
  }

  impact(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    color = 0xffb347,
    count = 10,
  ) {
    this.tmpColor.setHex(color);
    this.sparks.burst(
      x,
      y,
      z,
      this.tmpColor,
      count,
      5.5,
      0.16,
      0.45,
      14,
      3,
      1.4,
    );
    this.smoke.burst(
      x,
      y,
      z,
      new THREE.Color(0.7, 0.68, 0.62),
      3,
      1.4,
      0.5,
      0.8,
      -1.5,
      1.2,
      1.2,
      0.35,
    );
    void nx;
    void ny;
    void nz;
  }

  blood(x: number, y: number, z: number) {
    this.tmpColor.setHex(0xff3b3b);
    this.sparks.burst(x, y, z, this.tmpColor, 12, 4.5, 0.15, 0.5, 12, 3, 1.6);
  }

  explosion(x: number, y: number, z: number) {
    this.tmpColor.setHex(0xff8833);
    this.sparks.burst(x, y, z, this.tmpColor, 22, 8, 0.24, 0.6, 10, 2.5);
    this.tmpColor.setHex(0xffdd66);
    this.sparks.burst(x, y, z, this.tmpColor, 12, 5, 0.18, 0.4, 8, 2.5);
    this.smoke.burst(
      x,
      y,
      z,
      new THREE.Color(0.55, 0.55, 0.55),
      8,
      3,
      0.7,
      1.2,
      -1,
      1.2,
      1.6,
      0.4,
    );
  }

  update(dt: number) {
    this.sparks.update(dt);
    this.smoke.update(dt);
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const k = Math.max(0, t.life / t.maxLife);
      t.mat.opacity = 0.9 * k;
      if (t.life <= 0) t.mat.opacity = 0;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.mesh.visible = false;
        f.light.intensity = 0;
        (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
      } else {
        f.light.intensity = 2.4 * (f.life / 0.055);
        (f.mesh.material as THREE.MeshBasicMaterial).opacity = f.life / 0.055;
      }
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life / r.maxLife);
      if (r.life <= 0) {
        r.mesh.visible = false;
        r.mat.opacity = 0;
      } else {
        r.mesh.scale.setScalar(0.5 + t * 2.2);
        r.mat.opacity = 0.9 * (1 - t);
      }
    }
  }

  dispose() {
    this.scene.remove(this.sparks.points, this.smoke.points);
    for (const t of this.tracers) {
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      t.mat.dispose();
    }
    for (const f of this.flashes) {
      this.scene.remove(f.mesh, f.light);
      (f.mesh.material as THREE.Material).dispose();
    }
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      r.mat.dispose();
    }
  }
}
