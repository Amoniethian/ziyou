import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Inventory, DecorItem, DecorType } from "../../types";
import { DECOR_VARIANT_COUNTS } from "../../types";
import { getModel, getHeading, getPitch, hasModel, BUNDLED_MODELS, bundledModelUrl, decorVariantUrl, type ModelSlot } from "./modelStore";

type ModelTemplate = { object: THREE.Object3D; animations: THREE.AnimationClip[] };
export type Spoken = { en: string; zh: string; word?: string };

/**
 * 3D glass aquarium, ported from legacy/cihai-3d-preview.html and extended:
 *  - decor placed by persistent id (drag-to-arrange)
 *  - fish reconciled to inventory counts (they swim)
 *  - any slot (fish / decor / whole tank) replaceable by an uploaded GLB
 *
 * Coordinates are cleaned up vs the prototype so the sand sits on the tank
 * floor and decor rests on the sand.
 */

const BOX_W = 12, BOX_H = 5, BOX_D = 5;
const AQ_Y = BOX_H / 2 - 2;                 // tank centre: 0.5
const TANK_BOTTOM = AQ_Y - BOX_H / 2;       // -2
const SAND_THICK = 0.5;
const SAND_TOP_Y = TANK_BOTTOM + SAND_THICK; // -1.5
const SAND_CENTER_Y = TANK_BOTTOM + SAND_THICK / 2;
const WATER_Y = AQ_Y + BOX_H / 2 - 0.1;      // 2.9

const FISH_TYPES = ["smallFish", "moonFish", "clownfish", "bigFish", "turtle", "emberFish"] as const;
type FishType = (typeof FISH_TYPES)[number];

const DECOR_X = (BOX_W / 2) - 1.0;  // placement clamp
const DECOR_Z = (BOX_D / 2) - 0.9;

const DECOR_SCALE: Partial<Record<DecorType, number>> = { coral: 2.5 };

// Fit target (max bounding-box dimension) for an uploaded fish model. Default
// 0.6; per-type overrides let some creatures read larger.
const FISH_FIT_DEFAULT = 0.6;
const FISH_FIT: Partial<Record<FishType, number>> = { moonFish: 1.08 };

// Creatures that school together (counted jointly toward the 3+ threshold).
const SCHOOL_TYPES: ReadonlySet<string> = new Set(["smallFish", "moonFish"]);

// Tail-beat per type: smaller fish swish with bigger amplitude and faster beat.
const FISH_BEAT: Record<string, { amp: number; freq: number }> = {
  smallFish: { amp: 1.8, freq: 2.2 },
  emberFish: { amp: 1.9, freq: 2.4 },
  moonFish: { amp: 1.1, freq: 1.2 },
  clownfish: { amp: 1.35, freq: 1.6 },
  bigFish: { amp: 0.8, freq: 0.8 }
};

function lowPolyMat(color: number) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, flatShading: true });
}

export class Aquarium3D {
  private cv: HTMLCanvasElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private loader = (() => {
    // Draco-compressed models (organic decor) need a decoder; it's bundled in
    // public/draco/ and loaded once, then geometry stays tiny.
    const l = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(import.meta.env.BASE_URL + "draco/");
    l.setDRACOLoader(draco);
    return l;
  })();
  private raf = 0;
  private ro: ResizeObserver;
  private last = performance.now();

  private glassMat!: THREE.MeshPhysicalMaterial;
  private sandMat!: THREE.MeshStandardMaterial;
  private tankGroup = new THREE.Group();      // procedural glass + edges + water
  private sandMesh!: THREE.Mesh;
  private customTank: THREE.Object3D | null = null;
  private dir!: THREE.DirectionalLight;

  private fish: THREE.Object3D[] = [];
  private decorMeshes = new Map<string, THREE.Object3D>();
  private decorItems: DecorItem[] = [];
  private decorVariants = new Map<string, ModelTemplate>(); // "rock1" -> bundled model
  private models: Partial<Record<ModelSlot, ModelTemplate>> = {};

  // atmosphere
  private bubbles: { mesh: THREE.Mesh; speed: number; phase: number }[] = [];
  private causticLayers: { tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial; sx: number; sy: number; baseOp: number; rate: number }[] = [];
  private waterMesh: THREE.Mesh | null = null;
  private causticLight: THREE.SpotLight | null = null;
  private causticLightTex: THREE.CanvasTexture | null = null;
  // reusable temps for the swim loop (avoid per-frame allocation / GC jank)
  private _v1 = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  // shared travel headings — the main shoal and the (separate) ember shoal
  private schoolHeading = new THREE.Vector3(1, 0, 0.25).normalize();
  private emberHeading = new THREE.Vector3(-1, 0, 0.4).normalize();
  private paperTex: THREE.Texture | null = null; // emberFish illustration texture

  private waterColor = 0xb8dcd8;
  private sandColor = 0xc8a874;

  // arrange-mode drag
  private arrange = false;
  private onMove: ((id: string, x: number, z: number) => void) | null = null;
  private onSelect: ((id: string | null) => void) | null = null;
  private selectedId: string | null = null;
  private outline: THREE.BoxHelper | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SAND_TOP_Y);
  private dragging: THREE.Object3D | null = null;

  // tap-to-speak (a fish shows a random example sentence in a bubble)
  private downX = 0;
  private downY = 0;
  private bubbleFish: THREE.Object3D | null = null;
  private bubbleBox = new THREE.Box3();
  private bubbleAnchor = new THREE.Vector3();
  private sentenceProvider: (() => Spoken | null) | null = null;
  private onBubble: ((s: Spoken | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    const wrap = canvas.parentElement!;
    const w = wrap.clientWidth || 600;
    const h = wrap.clientHeight || 400;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    this.camera.position.set(9, 6, 18);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(w, h, false);
    // Cap at 1.5 — on high-DPI phones/tablets this roughly halves the pixels
    // versus 2× and keeps the calm aquarium smooth.
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 32;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.target.set(0, 0.4, 0);
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.6;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    this.dir = new THREE.DirectionalLight(0xfff0d0, 0.85);
    this.dir.position.set(3, 9, 4);
    this.dir.castShadow = true;
    this.dir.shadow.mapSize.set(1024, 1024);
    Object.assign(this.dir.shadow.camera, { near: 1, far: 30, left: -8, right: 8, top: 8, bottom: -8 });
    this.scene.add(this.dir);
    const fill = new THREE.DirectionalLight(0xb8d8e8, 0.25);
    fill.position.set(-3, 2, 5);
    this.scene.add(fill);

    this.scene.add(this.tankGroup);
    this.buildTank();
    this.buildAtmosphere();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(wrap);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  /* ---------- public API ---------- */
  private loop = (now: number) => {
    this.frame(now);
    this.raf = requestAnimationFrame(this.loop);
  };
  // Pause the render loop while the tab/page is hidden (saves CPU + battery).
  private onVisibility = () => {
    if (document.hidden) {
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    } else if (!this.raf) {
      this.raf = requestAnimationFrame(this.loop);
    }
  };
  start() {
    document.addEventListener("visibilitychange", this.onVisibility);
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.ro.disconnect();
    this.cv.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    if (this.outline) this.outline.geometry.dispose();
    this.renderer.dispose();
  }

  setPalette(water: number, sand: number) {
    this.waterColor = water;
    this.sandColor = sand;
    if (this.glassMat) this.glassMat.color.setHex(water);
    if (this.sandMat) this.sandMat.color.setHex(sand);
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
  }

  setArrange(
    on: boolean,
    onMove: (id: string, x: number, z: number) => void,
    onSelect?: (id: string | null) => void
  ) {
    this.arrange = on;
    this.onMove = onMove;
    this.onSelect = onSelect ?? null;
    this.cv.style.cursor = on ? "grab" : "";
    if (!on) this.select(null); // leaving arrange clears the highlight
  }

  /** Select a decor item (or null) and draw a highlight outline around it. */
  private select(id: string | null) {
    this.selectedId = id;
    this.refreshOutline();
    this.onSelect?.(id);
  }

  /** Public: sync the selection from the UI (e.g. after adding a rock).
   * Does NOT fire onSelect, so it won't loop back into React. */
  selectDecor(id: string | null) {
    this.selectedId = id;
    this.refreshOutline();
  }

  /** (Re)build the selection outline to match the selected mesh. */
  private refreshOutline() {
    if (this.outline) {
      this.scene.remove(this.outline);
      this.outline.geometry.dispose();
      this.outline = null;
    }
    if (!this.selectedId) return;
    const mesh = this.decorMeshes.get(this.selectedId);
    if (!mesh) return;
    this.outline = new THREE.BoxHelper(mesh, 0xffcf6b);
    (this.outline.material as THREE.LineBasicMaterial).transparent = true;
    (this.outline.material as THREE.LineBasicMaterial).opacity = 0.9;
    this.scene.add(this.outline);
  }

  /** Load all uploaded models present in storage, then rebuild affected objects. */
  async loadAllModels() {
    // emberFish has no uploadable model, so it's not a ModelSlot.
    const slots: ModelSlot[] = ["smallFish", "moonFish", "clownfish", "bigFish", "turtle", "rock", "coral", "anemone", "seaweed", "tank"];
    await Promise.all(slots.filter((s) => hasModel(s) || BUNDLED_MODELS.has(s)).map((s) => this.refreshModel(s, false)));
    await this.loadDecorVariants();
    this.rebuildAllFish();
    this.rebuildAllDecor();
    this.applyTankModel();
  }

  /** Load the bundled decor style variants (public/models/<type><n>.glb). */
  private async loadDecorVariants() {
    this.decorVariants.clear();
    const jobs: Promise<void>[] = [];
    for (const [type, count] of Object.entries(DECOR_VARIANT_COUNTS)) {
      for (let v = 1; v <= count; v++) {
        jobs.push(
          this.loadGLB(decorVariantUrl(type, v))
            .then(({ scene, animations }) => {
              this.fit(scene, 1.2);
              scene.traverse((m) => {
                if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; }
              });
              this.decorVariants.set(type + v, { object: scene, animations });
            })
            .catch(() => { /* missing variant file → procedural fallback */ })
        );
      }
    }
    await Promise.all(jobs);
  }

  async refreshModel(slot: ModelSlot, rebuild = true) {
    // Player upload wins; otherwise fall back to a bundled default if one ships.
    const url = (await getModel(slot)) || bundledModelUrl(slot);
    if (!url) {
      delete this.models[slot];
    } else {
      try {
        const { scene, animations } = await this.loadGLB(url);
        const targetMax = slot === "tank"
          ? BOX_W
          : (FISH_TYPES as readonly string[]).includes(slot)
            ? (FISH_FIT[slot as FishType] ?? FISH_FIT_DEFAULT)
            : 1.2;
        this.fit(scene, targetMax);
        scene.traverse((m) => {
          if ((m as THREE.Mesh).isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        this.models[slot] = { object: scene, animations };
      } catch {
        delete this.models[slot];
      }
    }
    if (rebuild) {
      if (slot === "tank") this.applyTankModel();
      else if ((FISH_TYPES as readonly string[]).includes(slot)) this.rebuildFishType(slot as FishType);
      else this.rebuildDecorType(slot as DecorType);
    }
  }

  setFish(inv: Inventory) {
    for (const type of FISH_TYPES) {
      const desired = (inv as any)[type] as number;
      const have = this.fish.filter((f) => f.userData.type === type);
      let diff = desired - have.length;
      while (diff > 0) { this.spawnFish(type); diff--; }
      while (diff < 0) { this.removeOneFish(type); diff++; }
    }
  }

  setDecor(items: DecorItem[]) {
    this.decorItems = items;
    const ids = new Set(items.map((d) => d.id));
    for (const [id, mesh] of this.decorMeshes) {
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        this.decorMeshes.delete(id);
      }
    }
    for (const item of items) {
      let mesh = this.decorMeshes.get(item.id);
      if (!mesh) {
        mesh = this.makeDecor(item);
        mesh.userData.decorType = item.type;
        this.decorMeshes.set(item.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(item.x, SAND_TOP_Y + (item.y ?? 0), item.z);
      mesh.rotation.y = item.rot;
      mesh.scale.setScalar((DECOR_SCALE[item.type] ?? 1) * (item.scale ?? 1));
    }
    // Keep the selection outline matched to the (possibly resized) item.
    if (this.selectedId) this.refreshOutline();
  }

  /* ---------- tank ---------- */
  private buildTank() {
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: this.waterColor, transparent: true, opacity: 0.15, roughness: 0.05,
      metalness: 0, transmission: 0.95, thickness: 0.5, ior: 1.3,
      clearcoat: 0.2, clearcoatRoughness: 0.1,
      side: THREE.DoubleSide, depthWrite: false
    });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D), this.glassMat);
    glass.position.y = AQ_Y;
    this.tankGroup.add(glass);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D)),
      new THREE.LineBasicMaterial({ color: 0x2c4a4d, transparent: true, opacity: 0.45 })
    );
    edges.position.y = AQ_Y;
    this.tankGroup.add(edges);

    const surfMat = new THREE.MeshStandardMaterial({
      color: 0xeaf5f4, transparent: true, opacity: 0.18, roughness: 0.08, metalness: 0.1
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(BOX_W - 0.1, BOX_D - 0.1), surfMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.name = "water";
    this.waterMesh = water;
    this.tankGroup.add(water);

    // Sand floor with a gentle bump.
    this.sandMat = new THREE.MeshStandardMaterial({ color: this.sandColor, roughness: 0.95, flatShading: true });
    const sandGeom = new THREE.BoxGeometry(BOX_W - 0.1, SAND_THICK, BOX_D - 0.1, 20, 1, 12);
    const pos = sandGeom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, SAND_THICK / 2 + Math.sin(x * 0.8 + z * 0.6) * 0.06 + Math.cos(x * 0.5 - z * 0.9) * 0.05);
      }
    }
    sandGeom.computeVertexNormals();
    this.sandMesh = new THREE.Mesh(sandGeom, this.sandMat);
    this.sandMesh.position.y = SAND_CENTER_Y;
    this.sandMesh.receiveShadow = true;
    this.scene.add(this.sandMesh);
  }

  private applyTankModel() {
    if (this.customTank) {
      this.scene.remove(this.customTank);
      this.customTank = null;
    }
    const m = this.models.tank;
    if (m) {
      this.customTank = m.object.clone(true);
      this.customTank.position.y = AQ_Y;
      this.scene.add(this.customTank);
      this.tankGroup.visible = false; // hide procedural glass + water
    } else {
      this.tankGroup.visible = true;
    }
  }

  /* ---------- atmosphere: bubbles + god rays + caustics ---------- */
  private buildAtmosphere() {
    // Rising bubbles
    const bubbleMat = new THREE.MeshStandardMaterial({
      color: 0xeaffff, roughness: 0.1, transparent: true, opacity: 0.35
    });
    for (let i = 0; i < 26; i++) {
      const r = 0.02 + Math.random() * 0.05;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 5), bubbleMat);
      mesh.position.set(
        (Math.random() - 0.5) * (BOX_W - 1.4),
        TANK_BOTTOM + Math.random() * BOX_H,
        (Math.random() - 0.5) * (BOX_D - 1.4)
      );
      this.scene.add(mesh);
      this.bubbles.push({ mesh, speed: 0.2 + Math.random() * 0.4, phase: Math.random() * 6 });
    }

    // Caustics: two overlapping bright webs drifting at different scales/speeds,
    // so the light on the sand shimmers (波光粼粼) instead of sliding rigidly.
    const causticSpecs = [
      { repeat: [2, 1.5], y: 0.03, op: 0.38, sx: 0.012, sy: 0.008, rate: 0.5 },
      { repeat: [3.2, 2.4], y: 0.05, op: 0.26, sx: -0.018, sy: 0.011, rate: 0.8 }
    ];
    for (const spec of causticSpecs) {
      const tex = this.makeCausticTexture();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(spec.repeat[0], spec.repeat[1]);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: spec.op,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOX_W - 0.2, BOX_D - 0.2), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = SAND_TOP_Y + spec.y;
      this.scene.add(mesh);
      this.causticLayers.push({ tex, mat, sx: spec.sx, sy: spec.sy, baseOp: spec.op, rate: spec.rate });
    }

    // A downward caustic projector (light cookie) so the shimmer dapples
    // EVERYTHING — rocks, coral, plants, fish — not just the flat sand.
    const projTex = this.makeCausticTexture();
    projTex.wrapS = projTex.wrapT = THREE.RepeatWrapping;
    projTex.repeat.set(2.4, 2.4);
    const sl = new THREE.SpotLight(0xeafcff, 4, 0, Math.PI / 3.4, 0.7, 0);
    sl.position.set(0.4, AQ_Y + BOX_H + 1.5, 0.4);
    sl.target.position.set(0, SAND_TOP_Y, 0);
    sl.castShadow = true;
    sl.shadow.mapSize.set(512, 512); // smaller shadow → much cheaper; cookie still reads fine
    sl.shadow.camera.near = 1;
    sl.shadow.camera.far = 20;
    sl.map = projTex;
    this.scene.add(sl);
    this.scene.add(sl.target);
    this.causticLight = sl;
    this.causticLightTex = projTex;
  }

  private makeCausticTexture(): THREE.CanvasTexture {
    const size = 256;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    // Sum of integer-frequency sine waves so the pattern tiles seamlessly.
    const waves: { nx: number; ny: number; ph: number }[] = [];
    for (let k = 0; k < 6; k++) {
      const nx = (1 + Math.floor(Math.random() * 3)) * (Math.random() < 0.5 ? -1 : 1);
      const ny = (1 + Math.floor(Math.random() * 3)) * (Math.random() < 0.5 ? -1 : 1);
      waves.push({ nx, ny, ph: Math.random() * Math.PI * 2 });
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        for (const w of waves) {
          v += Math.sin((w.nx * x / size + w.ny * y / size) * Math.PI * 2 + w.ph);
        }
        const n = Math.max(0, v / waves.length * 0.5 + 0.5);
        const b = Math.pow(n, 3) * 255;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = b;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* ---------- factories ---------- */
  /**
   * A fish built as a flexible flat strip: a steady head plus a chain of body
   * segments. The swim loop ripples the segments as a head→tail travelling wave
   * (growing toward the tail) and bends the whole strip into turns.
   */
  private makeFishGeneric(o: { color: number; tail: number; size: number; stripe?: boolean; translucent?: boolean }): THREE.Group {
    const s = o.size;
    const g = new THREE.Group();
    const mat = (c: number) =>
      o.translucent
        ? new THREE.MeshStandardMaterial({
            color: c, roughness: 0.3, metalness: 0, flatShading: true,
            transparent: true, opacity: 0.6, emissive: c, emissiveIntensity: 0.4
          })
        : lowPolyMat(c);
    const bodyMat = mat(o.color);
    const finMat = mat(o.tail);

    // Head — on the root, so it barely moves while the body waves.
    const head = new THREE.Mesh(new THREE.BoxGeometry(s * 0.72, s * 0.95, s * 0.5), bodyMat);
    head.position.x = s * 0.34;
    head.castShadow = true;
    g.add(head);
    for (const dz of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(s * 0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0x1a1410 }));
      eye.position.set(s * 0.6, s * 0.12, dz * s * 0.24);
      g.add(eye);
    }

    // Body segments — a chain, each bends a little relative to the one ahead.
    const segLen = s * 0.55;
    const hs = [1.0, 0.85, 0.62, 0.4]; // height (Y) head→tail
    const ts = [0.48, 0.4, 0.3, 0.18]; // thickness (Z, flat) head→tail
    const segs: THREE.Object3D[] = [];
    let parent: THREE.Object3D = g;
    for (let i = 0; i < hs.length; i++) {
      const seg = new THREE.Group();
      seg.position.x = i === 0 ? 0 : -segLen;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(segLen * 1.05, s * hs[i], s * ts[i]), bodyMat);
      mesh.position.x = -segLen / 2;
      mesh.castShadow = true;
      seg.add(mesh);
      parent.add(seg);
      segs.push(seg);
      parent = seg;
    }

    // Tail fin (vertical, flat) at the end of the chain.
    const tail = new THREE.Mesh(new THREE.ConeGeometry(s * 0.5, s * 0.72, 3), finMat);
    tail.position.set(-segLen * 0.5, 0, 0);
    tail.rotation.z = Math.PI / 2;
    tail.scale.z = 0.3;
    parent.add(tail);

    // Dorsal fin on the first body segment.
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(s * 0.3, s * 0.5, 3), finMat);
    dorsal.position.set(-segLen * 0.4, s * 0.5, 0);
    dorsal.scale.z = 0.25;
    segs[0].add(dorsal);

    // Clownfish bands.
    if (o.stripe) {
      const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(s * 0.14, s * 0.97, s * 0.52), white);
      b1.position.x = s * 0.18;
      g.add(b1);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(s * 0.13, s * 0.86, s * 0.42), white);
      b2.position.x = -segLen * 0.5;
      segs[1].add(b2);
    }

    g.userData.segs = segs;
    return g;
  }

  /**
   * The break-reward "super small fish": the user's orange illustration mapped
   * onto a flat plane (a paper fish). The plane has segments along its length so
   * the swim loop ripples it (vertex wave). The image faces right, so head = +X.
   */
  private makeEmberFish(): THREE.Group {
    const g = new THREE.Group();
    if (!this.paperTex) {
      this.paperTex = new THREE.TextureLoader().load(import.meta.env.BASE_URL + "paperfish.png");
      this.paperTex.colorSpace = THREE.SRGBColorSpace;
    }
    const w = 0.34, h = (w * 960) / 1440; // image aspect
    const geo = new THREE.PlaneGeometry(w, h, 8, 1);
    // Mirror the texture horizontally so the painted head lines up with +X (the
    // travel direction) instead of the tail — the fish was facing backwards.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    uv.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: this.paperTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide
    });
    g.add(new THREE.Mesh(geo, mat));
    g.userData.waveGeo = geo;
    g.userData.waveW = w;
    return g;
  }

  // The "turtle" reward slot is rendered as a jellyfish: translucent bell + tentacles.
  private makeJellyfish(): THREE.Group {
    const g = new THREE.Group();
    const bell = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xdcaed6, roughness: 0.3, transparent: true, opacity: 0.6, flatShading: true })
    );
    bell.castShadow = true;
    g.add(bell);
    g.userData.bell = bell;
    const tentMat = new THREE.MeshStandardMaterial({ color: 0xe7c6e6, transparent: true, opacity: 0.7, flatShading: true });
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, 0.5, 4), tentMat);
      t.position.set(Math.cos(ang) * 0.18, -0.26, Math.sin(ang) * 0.18);
      t.rotation.z = Math.cos(ang) * 0.2;
      t.rotation.x = Math.sin(ang) * 0.2;
      g.add(t);
    }
    g.userData.jellyfish = true;
    return g;
  }

  private makeRock(): THREE.Group {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + Math.random() * 0.3, 0), lowPolyMat(0x35353a));
    rock.scale.set(1, 0.7 + Math.random() * 0.3, 1);
    rock.position.y = 0.25;
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    rock.receiveShadow = true;
    g.add(rock);
    return g;
  }
  private makeCoral(): THREE.Group {
    const g = new THREE.Group();
    const palette = [0xe07a8a, 0xd97aa0, 0xea9bb0, 0xc35878];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.7, 6), lowPolyMat(color));
    trunk.position.y = 0.35;
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.35, 5), lowPolyMat(color));
      branch.position.set(Math.cos(ang) * 0.18, 0.55, Math.sin(ang) * 0.18);
      branch.rotation.set(0.5, ang, 0);
      g.add(branch);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), lowPolyMat(0xfac0d0));
      tip.position.set(Math.cos(ang) * 0.32, 0.78, Math.sin(ang) * 0.32);
      g.add(tip);
    }
    return g;
  }
  private makeAnemone(): THREE.Group {
    const g = new THREE.Group();
    const palette = [0xd97aa0, 0xea9bb0, 0xc54f8a, 0xe6a8c0];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), lowPolyMat(color));
    g.add(base);
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, 0.4, 4), lowPolyMat(color));
      t.position.set(Math.cos(ang) * 0.22, 0.22, Math.sin(ang) * 0.22);
      t.rotation.set(Math.sin(ang) * 0.5, 0, Math.cos(ang) * 0.5);
      g.add(t);
    }
    return g;
  }
  private makeSeaweed(): THREE.Group {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.25, 4), lowPolyMat(0x4d8a4d));
      seg.position.y = i * 0.22 + 0.12;
      seg.rotation.z = Math.sin(i * 0.6) * 0.15;
      g.add(seg);
    }
    g.userData.seaweed = true;
    return g;
  }

  /** Clone a GLB template into a group, wiring up its animation mixer if it has clips. */
  private instantiateModel(tpl: ModelTemplate): THREE.Group {
    const m = skeletonClone(tpl.object);
    const g = new THREE.Group();
    g.add(m);
    if (tpl.animations.length) {
      const mixer = new THREE.AnimationMixer(m);
      for (const clip of tpl.animations) mixer.clipAction(clip).play();
      g.userData.mixer = mixer;
    }
    return g;
  }

  private makeDecor(item: DecorItem): THREE.Group {
    const type = item.type;
    // Priority: a player's uploaded model overrides everything; else the bundled
    // style variant for this item; else the procedural shape.
    if (this.models[type]) return this.instantiateModel(this.models[type]!);
    const variant = this.decorVariants.get(type + (item.variant ?? 1));
    if (variant) return this.instantiateModel(variant);
    if (type === "rock") return this.makeRock();
    if (type === "coral") return this.makeCoral();
    if (type === "anemone") return this.makeAnemone();
    return this.makeSeaweed();
  }

  private makeFish(type: FishType): THREE.Group {
    // emberFish is procedural-only (never an uploaded slot), hence the cast.
    const model = this.models[type as ModelSlot];
    if (model) return this.instantiateModel(model);
    if (type === "smallFish") return this.makeFishGeneric({ color: 0xe9b955, tail: 0xa17a37, size: 0.05 });
    if (type === "emberFish") return this.makeEmberFish();
    if (type === "moonFish") return this.makeFishGeneric({ color: 0xe7d9b0, tail: 0xa99b76, size: 0.32 });
    if (type === "clownfish") return this.makeFishGeneric({ color: 0xe07a3c, tail: 0x8e3f17, size: 0.093, stripe: true });
    if (type === "bigFish") return this.makeFishGeneric({ color: 0xbb6abf, tail: 0x7e468a, size: 0.42 });
    // turtle slot = 七彩麒麟 (mandarin fish): teal body, orange fins.
    return this.makeFishGeneric({ color: 0x2aa9b5, tail: 0xe98a3c, size: 0.18, stripe: true });
  }

  /* ---------- spawn / rebuild ---------- */
  /** Deterministic 大/小 size pick for the index-th fish of a type — stable
   * across rebuilds, so a fish keeps the size it was "born" with. */
  private fishIsBig(type: FishType, index: number): boolean {
    const h = ((index + 1) * 374761393 + type.length * 668265263) >>> 0;
    return ((h ^ (h >>> 15)) & 1) === 0;
  }

  private spawnFish(type: FishType) {
    const index = this.fish.filter((f) => f.userData.type === type).length;
    const mesh = this.makeFish(type);
    mesh.userData.type = type;
    // Two discrete size variants (大/小), randomly assigned at birth and fixed —
    // bounded so neither a giant nor an invisible fish ever appears.
    const big = this.fishIsBig(type, index);
    mesh.userData.big = big;
    mesh.scale.multiplyScalar(big ? 1.2 : 0.8);
    const x = (Math.random() - 0.5) * (BOX_W - 1.6);
    const y = AQ_Y + (Math.random() - 0.5) * 1.6;
    const z = (Math.random() - 0.5) * (BOX_D - 1.6);
    mesh.position.set(x, y, z);
    const speed =
      type === "bigFish" || type === "turtle" ? 0.3 :
      type === "moonFish" ? 0.5 :
      type === "emberFish" ? 1.0 : 0.8;
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2).normalize();
    mesh.userData.swim = {
      speed,
      vel: dir.clone().multiplyScalar(speed * 0.5),
      phase: Math.random() * 6,
      wDir: dir.clone(),          // smoothly-wandering desired heading
      dSpeed: speed * 0.5,        // current (eased) speed
      spdPhase: Math.random() * 6,
      dart: 0,                    // dart-burst countdown (seconds)
      behavior: "cruise",         // cruise(长行) / play(短行) / explore(探索) / cling(依附) / dart-rest (emberFish)
      bTimer: 1 + Math.random() * 6,
      targetMesh: null,           // decor being explored / clung to
      dartTarget: new THREE.Vector3() // fire-sprite dart destination (emberFish)
    };
    this.assignBehavior(mesh);
    this.fish.push(mesh);
    this.scene.add(mesh);
  }

  /** Pick a decor mesh to visit (optionally preferring one or more types). */
  private pickDecor(prefer?: DecorType | DecorType[]): THREE.Object3D | null {
    const arr = [...this.decorMeshes.values()];
    if (!arr.length) return null;
    if (prefer) {
      const set = new Set(Array.isArray(prefer) ? prefer : [prefer]);
      const p = arr.filter((m) => set.has(m.userData.decorType));
      if (p.length) return p[(Math.random() * p.length) | 0];
    }
    return arr[(Math.random() * arr.length) | 0];
  }

  /**
   * Roll the next behaviour for a fish:
   *  - seahorse (bigFish): perch in the seaweed; mandarin fish (turtle):
   *    potter along the reef bottom near coral/rock.
   *  - clownfish: only short trips (短行), exploring (探索) and clinging (依附)
   *    to decor — preferring anemones.
   *  - schooling fish: mostly cruise with the shoal; occasionally a solo short
   *    trip or a decor exploration, then back to cruise.
   */
  private assignBehavior(f: THREE.Object3D) {
    const sw = f.userData.swim;
    const type = f.userData.type as FishType;
    if (type === "clownfish") {
      // Clownfish live curled up in the coral/anemone — they never leave. Keep
      // the SAME nest across reassigns; only pick a new one if the old one is
      // gone (deleted). If the nest still exists, don't reset `hovering` — so a
      // fish already settled stays settled instead of re-approaching every cycle.
      sw.behavior = "cling";
      sw.bTimer = 12 + Math.random() * 10;
      if (!sw.targetMesh || !sw.targetMesh.parent) {
        sw.targetMesh = this.pickDecor(["coral", "anemone"]) || this.pickDecor();
        sw.hovering = false; // brand-new nest: approach it
      }
      return;
    }
    if (type === "bigFish") {
      // Seahorse: tail tucked into the seaweed, drifting and swaying in place.
      // About once a minute it randomly decides whether to drift over to a
      // different frond (else it stays put on the same one).
      sw.behavior = "cling";
      sw.bTimer = 55 + Math.random() * 12; // ~1 min between "switch frond?" checks
      if (!sw.targetMesh || !sw.targetMesh.parent || Math.random() < 0.35) {
        sw.targetMesh = this.pickDecor("seaweed") || this.pickDecor();
        sw.hovering = false; // drift over to the new frond
      }
      return;
    }
    sw.targetMesh = null;
    sw.hovering = false; // re-approach freshly-assigned decor before settling
    if (type === "turtle") {
      // 七彩麒麟 (mandarin fish): a slow reef bottom-dweller — mostly nosing
      // around the coral / rock, with the occasional short gentle drift. Rarely
      // ventures into open water.
      const r = Math.random();
      if (r < 0.78) { sw.behavior = "explore"; sw.bTimer = 5 + Math.random() * 6; sw.targetMesh = this.pickDecor(["coral", "rock", "anemone"]); }
      else { sw.behavior = "play"; sw.bTimer = 3 + Math.random() * 4; }
      return;
    }
    // Schooling fish: after a side-quest always return to cruise; from cruise,
    // venture out only occasionally.
    if (sw.behavior && sw.behavior !== "cruise") {
      sw.behavior = "cruise";
      sw.bTimer = 10 + Math.random() * 10;
      return;
    }
    const r = Math.random();
    if (r < 0.85) { sw.behavior = "cruise"; sw.bTimer = 14 + Math.random() * 12; }
    else if (r < 0.93) { sw.behavior = "play"; sw.bTimer = 3 + Math.random() * 4; }
    else { sw.behavior = "explore"; sw.bTimer = 5 + Math.random() * 5; sw.targetMesh = this.pickDecor(); }
  }

  private removeOneFish(type: FishType) {
    const idx = this.fish.findIndex((f) => f.userData.type === type);
    if (idx >= 0) {
      this.scene.remove(this.fish[idx]);
      this.fish.splice(idx, 1);
    }
  }
  private rebuildFishType(type: FishType) {
    const n = this.fish.filter((f) => f.userData.type === type).length;
    for (let i = 0; i < n; i++) this.removeOneFish(type);
    for (let i = 0; i < n; i++) this.spawnFish(type);
  }
  private rebuildAllFish() {
    for (const t of FISH_TYPES) this.rebuildFishType(t);
  }
  private rebuildDecorType(type: DecorType) {
    for (const item of this.decorItems) {
      if (item.type !== type) continue;
      const old = this.decorMeshes.get(item.id);
      if (old) {
        this.scene.remove(old);
        this.decorMeshes.delete(item.id);
      }
    }
    this.setDecor(this.decorItems);
  }
  private rebuildAllDecor() {
    for (const mesh of this.decorMeshes.values()) this.scene.remove(mesh);
    this.decorMeshes.clear();
    this.setDecor(this.decorItems);
  }

  /* ---------- GLB helpers ---------- */
  private async loadGLB(dataUrl: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
    const buf = await (await fetch(dataUrl)).arrayBuffer();
    return new Promise((resolve, reject) => {
      this.loader.parse(buf, "", (g) => resolve({ scene: g.scene, animations: g.animations || [] }), reject);
    });
  }
  private fit(obj: THREE.Object3D, targetMax: number) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = targetMax / maxDim;
    obj.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    obj.position.sub(center);
    // sit base near origin so decor rests on the sand
    obj.position.y += (size.y * scale) / 2;
  }

  /* ---------- arrange drag ---------- */
  private setPointer(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  private onPointerDown = (e: PointerEvent) => {
    this.downX = e.clientX;
    this.downY = e.clientY;
    if (!this.arrange) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.decorMeshes.values()], true);
    if (hits.length) {
      const top = [...this.decorMeshes.entries()].find(([, m]) => this.isAncestor(m, hits[0].object));
      if (top) {
        this.dragging = top[1];
        this.dragging.userData.id = top[0];
        this.controls.enabled = false;
        this.cv.style.cursor = "grabbing";
        this.select(top[0]); // selecting highlights it; dragging still moves it
      }
    } else {
      this.select(null); // tap empty water → deselect
    }
  };
  private isAncestor(anc: THREE.Object3D, node: THREE.Object3D): boolean {
    let n: THREE.Object3D | null = node;
    while (n) {
      if (n === anc) return true;
      n = n.parent;
    }
    return false;
  }
  private onPointerMove = (e: PointerEvent) => {
    if (!this.arrange || !this.dragging) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, hit)) {
      const x = THREE.MathUtils.clamp(hit.x, -DECOR_X, DECOR_X);
      const z = THREE.MathUtils.clamp(hit.z, -DECOR_Z, DECOR_Z);
      this.dragging.position.x = x;
      this.dragging.position.z = z;
      this.outline?.update();
    }
  };
  private onPointerUp = (e: PointerEvent) => {
    if (this.dragging) {
      const id = this.dragging.userData.id as string;
      this.onMove?.(id, this.dragging.position.x, this.dragging.position.z);
      this.dragging = null;
      this.controls.enabled = true;
      this.cv.style.cursor = this.arrange ? "grab" : "";
      return;
    }
    if (this.arrange) return;
    // A tap (not an orbit drag) selects a fish to speak.
    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    if (moved < 6) this.handleTap(e);
  };

  private handleTap(e: PointerEvent) {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.fish, true);
    if (hits.length) {
      const top = this.fish.find((f) => this.isAncestor(f, hits[0].object)) || null;
      this.bubbleFish = top;
      const sentence = top ? (this.sentenceProvider?.() ?? null) : null;
      this.onBubble?.(sentence);
    } else {
      // tap empty water → dismiss
      this.bubbleFish = null;
      this.onBubble?.(null);
    }
  }

  setSentenceProvider(fn: () => Spoken | null) {
    this.sentenceProvider = fn;
  }
  setOnBubble(fn: (s: Spoken | null) => void) {
    this.onBubble = fn;
  }
  /** Screen position (canvas px) of the speaking fish, or null. */
  projectBubble(): { x: number; y: number } | null {
    if (!this.bubbleFish || !this.fish.includes(this.bubbleFish)) {
      if (this.bubbleFish) {
        this.bubbleFish = null;
        this.onBubble?.(null);
      }
      return null;
    }
    // Anchor a point ABOVE the fish's bounding box (in world space) so the
    // bubble clears the fish at any zoom level, regardless of how small it is.
    this.bubbleBox.setFromObject(this.bubbleFish);
    const top = this.bubbleAnchor.set(
      this.bubbleFish.position.x,
      this.bubbleBox.max.y + 0.3,
      this.bubbleFish.position.z
    );
    const v = top.project(this.camera);
    if (v.z > 1) return null;
    const r = this.cv.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height };
  }

  /** Wander a shoal's shared travel heading, turning it back near the walls. */
  private wanderHeading(sh: THREE.Vector3, center: THREE.Vector3, rate: number, halfX: number, halfZ: number, dt: number) {
    const a = (Math.random() - 0.5) * rate * dt;
    const ca = Math.cos(a), sa = Math.sin(a);
    sh.set(sh.x * ca - sh.z * sa, 0, sh.x * sa + sh.z * ca);
    if (center.x > halfX - 1.6) sh.x -= 1.2 * dt;
    if (center.x < -halfX + 1.6) sh.x += 1.2 * dt;
    if (center.z > halfZ - 1.2) sh.z -= 1.2 * dt;
    if (center.z < -halfZ + 1.2) sh.z += 1.2 * dt;
    sh.normalize();
  }

  /* ---------- loop ---------- */
  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const halfX = BOX_W / 2 - 0.7, halfZ = BOX_D / 2 - 0.7;
    const yTop = AQ_Y + BOX_H / 2 - 0.7, yBot = TANK_BOTTOM + 0.7;

    // Two separate shoals: small+moon fish, and the ember "super small fish"
    // (its own group, its own livelier rhythm). Each gathers a centre and wanders
    // its own shared travel heading.
    const mainSchool = this.fish.filter((f) => f.userData.swim && SCHOOL_TYPES.has(f.userData.type));
    const emberSchool = this.fish.filter((f) => f.userData.swim && f.userData.type === "emberFish");
    const mainSchooling = mainSchool.length >= 3;
    const emberSchooling = emberSchool.length >= 2;
    let mainCenter: THREE.Vector3 | null = null;
    let emberCenter: THREE.Vector3 | null = null;
    if (mainSchooling) {
      mainCenter = new THREE.Vector3();
      for (const f of mainSchool) mainCenter.add(f.position);
      mainCenter.multiplyScalar(1 / mainSchool.length);
      this.wanderHeading(this.schoolHeading, mainCenter, 0.5, halfX, halfZ, dt);
    }
    if (emberSchooling) {
      emberCenter = new THREE.Vector3();
      for (const f of emberSchool) emberCenter.add(f.position);
      emberCenter.multiplyScalar(1 / emberSchool.length);
      this.wanderHeading(this.emberHeading, emberCenter, 1.1, halfX, halfZ, dt); // livelier
    }

    const desired = this._v1;
    for (const f of this.fish) {
      const sw = f.userData.swim;
      if (!sw) continue;
      const type = f.userData.type as FishType;
      const beat = FISH_BEAT[type] || { amp: 1, freq: 1 };

      // --- behaviour state machine: 长行 / 短行 / 探索 / 依附 ---
      sw.bTimer -= dt;
      if (sw.targetMesh && !sw.targetMesh.parent) sw.targetMesh = null; // decor removed
      if (sw.bTimer <= 0) this.assignBehavior(f);
      const beh: string = sw.behavior;

      // --- desired heading: smooth wander (gentle yaw drift + a little pitch) ---
      // Smoothly-drifting wander: low-pass the random yaw into a slowly-varying
      // turn RATE, so the heading curves gently instead of jittering every frame.
      // (That per-frame jitter was feeding the body-curve below and reading as a
      // twitch/seizure — "卡膜抽搐".)
      sw.wRate = THREE.MathUtils.clamp((sw.wRate ?? 0) * 0.92 + (Math.random() - 0.5) * 0.45, -0.9, 0.9);
      const yaw = sw.wRate * dt;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const nx = sw.wDir.x * cy - sw.wDir.z * sy;
      const nz = sw.wDir.x * sy + sw.wDir.z * cy;
      sw.wDir.set(nx, sw.wDir.y + (Math.random() - 0.5) * 0.3 * dt, nz);
      sw.wDir.y *= 0.9; // strong bias toward horizontal (level swimming)
      sw.wDir.normalize();
      desired.copy(sw.wDir);

      let faceTarget: THREE.Vector3 | null = null;
      let speedScale = 1;
      const visiting = beh === "explore" || beh === "cling";

      // Which shoal this fish belongs to (emberFish has its own separate one).
      const isEmber = type === "emberFish";
      const isSchooler = isEmber || SCHOOL_TYPES.has(type);
      const grpSchooling = isEmber ? emberSchooling : mainSchooling;
      const grpCenter = isEmber ? emberCenter : mainCenter;
      const grpHeading = isEmber ? this.emberHeading : this.schoolHeading;
      const grpMembers = isEmber ? emberSchool : mainSchool;

      if (beh === "cruise" && isSchooler && grpSchooling) {
        // 长行: travel along the shoal's shared heading, staying together + spaced.
        desired.copy(grpHeading);                                                  // collective travel
        desired.addScaledVector(sw.wDir, 0.2);                                     // a little individuality
        desired.addScaledVector(this._v2.copy(grpCenter!).sub(f.position), 0.3);   // cohesion
        for (const o of grpMembers) {
          if (o === f) continue;
          const d = f.position.distanceTo(o.position);
          if (d > 0 && d < 0.6) desired.addScaledVector(this._v2.copy(f.position).sub(o.position).divideScalar(d), ((0.6 - d) / 0.6) * 1.2);
        }
      } else if (visiting && sw.targetMesh) {
        // 探索 / 依附: swim to a piece of decor, then hover, face it and nuzzle.
        const to = this._v2.copy(sw.targetMesh.position);
        to.y += 0.5; // aim a touch above the base
        const hoverX = to.x, hoverY = to.y, hoverZ = to.z;
        to.sub(f.position);
        const dist = to.length();
        const near = beh === "cling" ? (type === "bigFish" ? 0.28 : 0.4) : 0.95; // seahorse tucks in tightest
        // Hysteresis: once settled in to hover it STAYS hovering until it drifts
        // well past `near` again. Without this the fish flickered between "dash
        // toward" and "hover" every frame at the boundary — the visible twitch.
        if (sw.hovering) { if (dist > near * 1.9) sw.hovering = false; }
        else if (dist <= near) sw.hovering = true;
        if (!sw.hovering) {
          // Clinging fish (clownfish) FRANTICALLY rush home if their nest was
          // moved — fast approach + a dart so the steering snaps. Explorers just
          // glide in: ease the speed down as they close in so they don't lurch
          // past the target and snap back.
          const dash = beh === "cling";
          const sp = dash
            ? THREE.MathUtils.clamp((dist - near) * 3.5, 1.4, 3.4)
            : THREE.MathUtils.clamp((dist - near) * 1.6, 0.25, 1.8);
          if (dash && dist > near * 1.5) sw.dart = Math.max(sw.dart, 0.25);
          desired.copy(to).divideScalar(dist).multiplyScalar(sp); // head toward it
        } else if (type === "bigFish") {
          // Seahorse perch: hang LOW against the frond, tail tucked down into it
          // (sit near the seaweed base, not floating above it), just drifting +
          // swaying gently in place (飘飘摇摇) — barely travels.
          const sx = hoverX + Math.sin(sw.spdPhase * 0.7) * 0.06;
          const sz = hoverZ + Math.cos(sw.spdPhase * 0.5) * 0.06;
          const sy = (hoverY - 0.6) + 0.08 * Math.sin(sw.spdPhase * 0.9); // drop into the frond
          desired.set(sx - f.position.x, sy - f.position.y, sz - f.position.z);
          // Rock the facing slowly side to side, like it's swaying in a current.
          const swayA = Math.sin(sw.spdPhase * 0.6) * 0.25;
          faceTarget = this._v2.set(f.position.x + Math.cos(swayA), f.position.y, f.position.z + Math.sin(swayA));
          speedScale = 0.12; // essentially anchored to the seaweed
        } else {
          // Nestle — DON'T ram the decor. Gently potter around it on a small
          // orbit whose radius breathes in and out: tuck in to hide, drift out
          // to peek. Look the way it's drifting (探头探脑), or back at its home
          // when it has settled still.
          if (sw.orbitDir === undefined) { sw.orbit = Math.random() * 6.283; sw.orbitDir = Math.random() < 0.5 ? -0.5 : 0.5; }
          sw.orbit += dt * sw.orbitDir;
          const peek = 0.30 + 0.20 * Math.sin(sw.spdPhase * 0.8); // 0.10 hide … 0.50 peek
          const tx = hoverX + Math.cos(sw.orbit) * peek;
          const tz = hoverZ + Math.sin(sw.orbit) * peek;
          const ty = hoverY + 0.12 * Math.sin(sw.spdPhase * 1.3); // gentle bob
          desired.set(tx - f.position.x, ty - f.position.y, tz - f.position.z);
          const dl = desired.length();
          faceTarget = dl < 0.06
            ? this._v2.set(hoverX, hoverY, hoverZ)                          // settled: look home
            : this._v2.set(f.position.x + desired.x, f.position.y, f.position.z + desired.z); // peeking around
          speedScale = 0.42; // slow potter around the nest
        }
      }
      // play (短行) and cruise for seahorse/jellyfish just wander.

      // --- soft wall avoidance: curve inward as a wall nears (no hard bounce) ---
      const m = 1.3, my = 0.7;
      if (f.position.x > halfX - m) desired.x -= ((f.position.x - (halfX - m)) / m) * 1.6;
      if (f.position.x < -halfX + m) desired.x += ((-f.position.x - (halfX - m)) / m) * 1.6;
      if (f.position.z > halfZ - m) desired.z -= ((f.position.z - (halfZ - m)) / m) * 1.6;
      if (f.position.z < -halfZ + m) desired.z += ((-f.position.z - (halfZ - m)) / m) * 1.6;
      if (f.position.y > yTop - my) desired.y -= ((f.position.y - (yTop - my)) / my) * 1.4;
      // Floor avoidance — skipped while visiting decor so they can dip to the sand.
      if (!visiting && f.position.y < yBot + my) desired.y += (((yBot + my) - f.position.y) / my) * 1.4;
      if (desired.lengthSq() > 1e-4) desired.normalize();

      // --- speed eases up/down; free-roaming fast fish occasionally dart ---
      sw.spdPhase += dt * 0.5;
      const freeRoam = beh === "cruise" || beh === "play";
      if (sw.dart > 0) sw.dart -= dt;
      // Ember "fire sprites" dart often (keeps their agile zip while schooling).
      else if (freeRoam && sw.speed >= 0.5 && Math.random() < (type === "emberFish" ? 0.03 : 0.004))
        sw.dart = (type === "emberFish" ? 0.18 : 0.3) + Math.random() * (type === "emberFish" ? 0.3 : 0.5);
      const ease = 0.65 + 0.25 * Math.sin(sw.spdPhase) + (sw.dart > 0 ? 1.0 : 0);
      const targetSpeed = sw.speed * Math.max(0.2, ease) * speedScale;
      sw.dSpeed += (targetSpeed - sw.dSpeed) * Math.min(1, 1.8 * dt);
      desired.multiplyScalar(sw.dSpeed);

      // --- steer velocity toward desired (snappy for darts, smooth otherwise) ---
      const resp = Math.min(1, (sw.dart > 0 ? 4.5 : 2.4) * dt);
      sw.vel.x += (desired.x - sw.vel.x) * resp;
      sw.vel.y += (desired.y - sw.vel.y) * resp;
      sw.vel.z += (desired.z - sw.vel.z) * resp;

      f.position.addScaledVector(sw.vel, dt);
      // Safety backstop so nobody ever slips through the glass.
      f.position.x = THREE.MathUtils.clamp(f.position.x, -halfX, halfX);
      f.position.y = THREE.MathUtils.clamp(f.position.y, yBot, yTop);
      f.position.z = THREE.MathUtils.clamp(f.position.z, -halfZ, halfZ);

      if (f.userData.mixer) f.userData.mixer.update(dt);
      // Tail beat keeps pace with speed; smaller fish beat faster (beat.freq).
      sw.phase += dt * (3.5 + 6 * (sw.dSpeed / Math.max(0.01, sw.speed))) * beat.freq;
      if (f.userData.bell) {
        // Legacy procedural jellyfish (only if no model): stay upright + pulse.
        f.rotation.set(0, getHeading("turtle"), 0);
        const s = Math.sin(sw.phase * 0.7);
        f.userData.bell.scale.set(1 - s * 0.08, 1 + s * 0.15, 1 - s * 0.08);
      } else {
        // Yaw-only turning, staying upright (so a vertical model like a seahorse
        // doesn't tip over). Face the decor when hovering at it, else the swim
        // direction. The +90° aligns the model's +X (head) with that direction.
        if (faceTarget) {
          f.lookAt(faceTarget.x, f.position.y, faceTarget.z);
        } else {
          f.lookAt(this._v1.set(f.position.x + sw.vel.x, f.position.y, f.position.z + sw.vel.z));
        }
        f.rotateY(Math.PI / 2 + getHeading(type as ModelSlot));
        // Upright correction (rolls a model that was authored lying on its side).
        const pitch = getPitch(type as ModelSlot);
        if (pitch) f.rotateX(pitch);

        // Soft idle sway for a perched guppy — only for models WITHOUT their own
        // animation. If the model ships built-in clips (mixer), let those play
        // alone instead of double-animating it.
        if (type === "bigFish" && sw.hovering && !f.userData.mixer) {
          f.rotateZ(Math.sin(sw.phase * 0.8) * 0.17);
          f.rotateX(Math.sin(sw.phase * 0.55 + 1.0) * 0.09);
        }

        // How sharply the fish is turning (smoothed) → bank the body + curve the tail.
        const yawNow = Math.atan2(sw.vel.x, sw.vel.z);
        let turn = yawNow - (sw.prevYaw ?? yawNow);
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));        // shortest angle
        sw.prevYaw = yawNow;
        sw.turnSmooth = (sw.turnSmooth ?? 0) * 0.85 + (turn / Math.max(dt, 0.001)) * 0.15;
        const ts = sw.turnSmooth;
        const curve = THREE.MathUtils.clamp(ts * 0.5, -0.8, 0.8);

        // The spine stays HORIZONTAL and level (the head-direction is the spine
        // axis — lookAt above keeps it level). The body sways ONLY left↔right
        // (yaw): a wave travels head→tail and grows toward the tail, so the tail
        // really swishes; turning bends the whole strip sideways. No roll/pitch,
        // so nothing wobbles.
        const segs = f.userData.segs as THREE.Object3D[] | undefined;
        if (segs) {
          const n = segs.length;
          for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            segs[i].rotation.y = Math.sin(sw.phase - i * 0.9) * (0.08 + 0.38 * t) * beat.amp + curve * (0.25 + 0.75 * t);
          }
        }
        // Paper fish (textured emberFish): ripple the flat plane as a travelling
        // wave — head steady, growing toward the tail.
        const waveGeo = f.userData.waveGeo as THREE.PlaneGeometry | undefined;
        if (waveGeo) {
          const ww = f.userData.waveW as number;
          const pos = waveGeo.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const ampF = (ww / 2 - x) / ww; // 0 at head(+X) → 1 at tail(-X)
            pos.setZ(i, Math.sin(x * (7.5 / ww) - sw.phase) * 0.045 * ampF);
          }
          pos.needsUpdate = true;
        }
      }
    }
    // Animated decor (e.g. a swaying GLB anemone).
    for (const m of this.decorMeshes.values()) {
      if (m.userData.mixer) (m.userData.mixer as THREE.AnimationMixer).update(dt);
    }

    // Bubbles rise + wobble, recycle at the surface.
    const t = now * 0.001;
    for (const b of this.bubbles) {
      b.mesh.position.y += b.speed * dt;
      b.mesh.position.x += Math.sin(t + b.phase) * 0.12 * dt;
      if (b.mesh.position.y > WATER_Y) {
        b.mesh.position.y = TANK_BOTTOM + 0.2;
        b.mesh.position.x = (Math.random() - 0.5) * (BOX_W - 1.4);
        b.mesh.position.z = (Math.random() - 0.5) * (BOX_D - 1.4);
      }
    }
    // Caustics drift + breathe (each layer at its own pace → live shimmer).
    for (let i = 0; i < this.causticLayers.length; i++) {
      const L = this.causticLayers[i];
      L.tex.offset.x = (t * L.sx) % 1;
      L.tex.offset.y = (t * L.sy) % 1;
      L.mat.opacity = L.baseOp * (0.7 + 0.45 * Math.sin(t * L.rate + i * 1.7));
    }
    // Gentle sparkle on the water surface.
    if (this.waterMesh) {
      (this.waterMesh.material as THREE.MeshStandardMaterial).opacity = 0.16 + 0.06 * Math.sin(t * 0.8);
    }
    // Projector caustics drift + breathe (dapples every object below).
    if (this.causticLight && this.causticLightTex) {
      this.causticLightTex.offset.x = (t * 0.015) % 1;
      this.causticLightTex.offset.y = (t * 0.01) % 1;
      this.causticLight.intensity = 2.4 + 1.0 * Math.sin(t * 0.6);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const wrap = this.cv.parentElement!;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}
