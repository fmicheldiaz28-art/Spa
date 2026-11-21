// Precalcula (hornea) la física con Rapier y guarda posiciones por fotograma.
// Remotion renderiza fotogramas en paralelo y desordenados, por eso la simulación
// no puede correr en vivo: se reproduce desde estos JSON de forma determinista.
import RAPIER from "@dimforge/rapier3d-compat";
import { writeFileSync, readFileSync } from "node:fs";

await RAPIER.init();
const timeline = JSON.parse(readFileSync(new URL("../src/data/timeline.json", import.meta.url)));
const FPS = timeline.fps;
const SUB = 4;
const r3 = (v) => Math.round(v * 1000) / 1000;

const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const fixedBox = (world, hx, hy, hz, x, y, z) => {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.7), body);
};

/* ---------------- Escena Mezclado: ingredientes cayendo a la tolva ---------------- */
const bakeMixing = () => {
  const frames = timeline.scenes.find((s) => s.id === "Mezclado").duration;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / (FPS * SUB);

  // Tolva: tronco de cono como trimesh
  const seg = 28;
  const yTop = 2.6, yBot = 1.75, rTop = 0.95, rBot = 0.34;
  const verts = [];
  const idx = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    verts.push(Math.cos(a) * rTop, yTop, Math.sin(a) * rTop);
    verts.push(Math.cos(a) * rBot, yBot, Math.sin(a) * rBot);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = i * 2 + 1, c = ((i + 1) % seg) * 2, d = ((i + 1) % seg) * 2 + 1;
    idx.push(a, b, c, c, b, d);
  }
  const hopper = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(0.3),
    hopper,
  );
  // Cuello de la tolva hacia la cámara
  // Cámara de mezcla (paredes y "parrilla" invisible)
  fixedBox(world, 0.8, 0.05, 0.6, 0, 0.5, 0); // suelo (cara superior en y=0.55)
  fixedBox(world, 0.05, 0.7, 0.6, -0.78, 1.15, 0);
  fixedBox(world, 0.05, 0.7, 0.6, 0.78, 1.15, 0);
  fixedBox(world, 0.8, 0.7, 0.05, 0, 1.15, -0.48);
  fixedBox(world, 0.8, 0.7, 0.05, 0, 1.15, 0.48);

  const rand = rng(7);
  const kinds = [
    ...Array(10).fill("caucho"),
    ...Array(34).fill("negro"),
    ...Array(18).fill("silice"),
    ...Array(10).fill("azufre"),
  ];
  // barajar
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const items = kinds.map((kind, i) => {
    const spawn = Math.floor((i / kinds.length) * 46);
    const ang = rand() * Math.PI * 2;
    const rad = Math.sqrt(rand()) * 0.55;
    const size =
      kind === "caucho" ? 0.11 : kind === "negro" ? 0.055 : kind === "silice" ? 0.05 : 0.045;
    return {
      kind,
      size,
      spawn,
      start: { x: Math.cos(ang) * rad, y: 3.2 + rand() * 0.9, z: Math.sin(ang) * rad },
      rot: { x: rand(), y: rand(), z: rand(), w: rand() },
      body: null,
      track: [],
    };
  });

  for (let f = 0; f < frames; f++) {
    for (const it of items) {
      if (it.spawn === f && !it.body) {
        const q = it.rot;
        const n = Math.hypot(q.x, q.y, q.z, q.w);
        const desc = RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(it.start.x, it.start.y, it.start.z)
          .setRotation({ x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n })
          .setLinvel(0, -1.5, 0);
        it.body = world.createRigidBody(desc);
        const col =
          it.kind === "caucho"
            ? RAPIER.ColliderDesc.cuboid(it.size, it.size * 0.8, it.size * 1.1)
            : RAPIER.ColliderDesc.ball(it.size);
        world.createCollider(col.setRestitution(0.25).setFriction(0.6).setDensity(1.2), it.body);
      }
    }
    for (let s = 0; s < SUB; s++) world.step();
    for (const it of items) {
      if (!it.body) {
        it.track.push(null);
        continue;
      }
      const p = it.body.translation();
      const q = it.body.rotation();
      it.track.push([r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)]);
    }
  }
  return {
    frames,
    items: items.map(({ kind, size, track }) => ({ kind, size, track })),
  };
};

/* ---------------- Escena Cierre: llantas que caen y se apilan + una que rueda ---------------- */
const TIRE_R = 1.0;
const TIRE_HALF = 0.29;

const simulateOutro = (rollSpeed, record) => {
  const frames = timeline.scenes.find((s) => s.id === "Cierre").duration;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / (FPS * SUB);
  fixedBox(world, 20, 0.5, 20, 0, -0.5, 0);
  const rand = rng(21);
  const stack = [];
  const STACK_X = -0.55;
  for (let i = 0; i < 4; i++) {
    stack.push({
      spawn: i * 8,
      pos: {
        x: STACK_X + (rand() - 0.5) * 0.12,
        y: TIRE_HALF + i * 2 * TIRE_HALF + 1.6,
        z: (rand() - 0.5) * 0.12,
      },
      tilt: (rand() - 0.5) * 0.12,
      body: null,
      track: [],
      impact: null,
    });
  }
  const roller = {
    spawn: 18,
    body: null,
    track: [],
  };
  for (let f = 0; f < frames; f++) {
    for (const t of stack) {
      if (t.spawn === f) {
        const q = { x: Math.sin(t.tilt / 2), y: 0, z: 0, w: Math.cos(t.tilt / 2) };
        t.body = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(t.pos.x, t.pos.y, t.pos.z)
            .setRotation(q)
            .setLinvel(0, -2, 0)
            .setAngularDamping(0.8),
        );
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(TIRE_HALF, TIRE_R)
            .setRestitution(0.3)
            .setFriction(0.9)
            .setDensity(1),
          t.body,
        );
      }
    }
    if (roller.spawn === f) {
      // cilindro con eje Z (rueda de pie), rodando en +X
      const q = { x: Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) };
      roller.body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(-3.6, TIRE_R + 0.002, 1.5)
          .setRotation(q)
          .setLinvel(rollSpeed, 0, 0)
          .setAngvel({ x: 0, y: 0, z: -rollSpeed / TIRE_R })
          .setLinearDamping(0.9)
          .setAngularDamping(0.9)
          .enabledRotations(false, false, true),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cylinder(TIRE_HALF, TIRE_R).setFriction(1.2).setDensity(1),
        roller.body,
      );
    }
    const vyBefore = stack.map((t) => (t.body ? t.body.linvel().y : 0));
    for (let s = 0; s < SUB; s++) world.step();
    stack.forEach((t, i) => {
      if (!t.body) {
        t.track.push(null);
        return;
      }
      const vy = t.body.linvel().y;
      if (t.impact === null && vyBefore[i] < -1.5 && vy > vyBefore[i] + 1.2) t.impact = f;
      const p = t.body.translation();
      const q = t.body.rotation();
      t.track.push([r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)]);
    });
    if (roller.body) {
      const p = roller.body.translation();
      const q = roller.body.rotation();
      roller.track.push([r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)]);
    } else roller.track.push(null);
  }
  const last = roller.track[roller.track.length - 1];
  if (!record) return last[0];
  return {
    frames,
    stack: stack.map((t) => ({ track: t.track, impact: t.impact })),
    roller: { track: roller.track, spawn: roller.spawn },
  };
};

// Busca la velocidad inicial para que la llanta que rueda se detenga en x≈0.75
let lo = 1, hi = 12;
for (let i = 0; i < 30; i++) {
  const mid = (lo + hi) / 2;
  if (simulateOutro(mid, false) < 0.75) lo = mid;
  else hi = mid;
}
const outro = simulateOutro((lo + hi) / 2, true);
const mixing = bakeMixing();

writeFileSync(new URL("../src/data/mixing.json", import.meta.url), JSON.stringify(mixing));
writeFileSync(new URL("../src/data/outro.json", import.meta.url), JSON.stringify(outro));
console.log("mezclado:", mixing.items.length, "cuerpos ·", mixing.frames, "fotogramas");
console.log(
  "cierre: impactos",
  outro.stack.map((s) => s.impact),
  "· velocidad rodante",
  ((lo + hi) / 2).toFixed(2),
  "· x final",
  outro.roller.track.at(-1)[0],
);
const finalY = mixing.items.map((it) => it.track.at(-1)?.[1]).filter((v) => v !== undefined);
console.log("mezclado y final min/max:", Math.min(...finalY), Math.max(...finalY));
