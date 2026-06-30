import type { Inventory, Cosmetics, CreatureType } from "../../types";
import { rand } from "../../lib/text";

/**
 * 2D canvas aquarium, ported from the legacy single-file build.
 *
 * Difference from legacy: instead of spawning on each reward and removing on
 * each penalty, the engine *reconciles* its live population to match the
 * persisted inventory every time `setInventory` is called. This keeps the tank
 * correct across reloads, conversions and penalties without event wiring.
 */

type Fish = {
  type: CreatureType;
  x: number; y: number; size: number; color: string;
  vx: number; vy: number; phase: number; speed: number;
};
type Structure = {
  type: CreatureType; x: number; baseY: number;
  h?: number; seg?: number; r?: number; tentacles?: number;
  phase?: number; hue?: number; branches?: { angle: number; len: number; w: number }[];
};
type Bubble = { x: number; y: number; r: number; speed: number; phase: number };

const FISH_TYPES: CreatureType[] = ["smallFish", "moonFish", "clownfish", "bigFish", "turtle"];
const STRUCT_TYPES: CreatureType[] = ["seaweed", "anemone", "coral"];

const SPRITES: Record<string, { px: number; palette: Record<string, string>; frames: string[][] }> = {
  smallFish: {
    px: 2,
    palette: { A: "#e9b955", B: "#a17a37", H: "#f7d690", E: "#1a1410" },
    frames: [
      ["....AAAA..", "BAAAAAAA.E", ".AAAAAAA.E", "BAAAAAAA..", "....AAAA.."],
      ["....AAAA..", ".AAAAAAA.E", "BAAAAAAA.E", ".AAAAAAA..", "....AAAA.."]
    ]
  },
  moonFish: {
    px: 3,
    palette: { M: "#e7d9b0", N: "#a99b76", H: "#f5ebc6", E: "#1a1410" },
    frames: [
      ["...MMM...", "..MMMMM..", ".MMMMMMM.", "NMMMMMMMM", "NMMMMMMME", "NMMMMMMM.", ".MMMMMMM.", "..MMMMM..", "...MMM..."],
      ["...MMM...", "..MMMMM..", "NMMMMMMM.", "NMMMMMMMM", ".MMMMMMME", ".MMMMMMM.", ".MMMMMMM.", "..MMMMM..", "...MMM..."]
    ]
  },
  clownfish: {
    px: 3,
    palette: { O: "#e07a3c", W: "#fff5dd", B: "#8e3f17", E: "#1a1410" },
    frames: [
      ["....OOOO..", "BOWOOWOOOE", ".OWOOWOOOE", "BOWOOWOOO.", "....OOOO.."],
      ["....OOOO..", ".OWOOWOOOE", "BOWOOWOOOE", ".OWOOWOOO.", "....OOOO.."]
    ]
  },
  bigFish: {
    px: 4,
    palette: { P: "#bb6abf", Q: "#7e468a", H: "#d59cdb", E: "#1a1410" },
    frames: [
      [".....PPPPPPP...", "...PPPPPPPPPP..", "..QPPPPPPPPPPP.", ".QPPPPPPPPPPPE.", "QPPPPPPPPPPPPEE", "QPPPPPPPPPPPPE.", "..QPPPPPPPPPPP.", "...QPPPPPPPPP..", "....PPPPPPPP...", "......PPPPP...."],
      [".....PPPPPPP...", "..QPPPPPPPPP...", ".QPPPPPPPPPPP..", "QPPPPPPPPPPPPE.", ".QPPPPPPPPPPPEE", "QPPPPPPPPPPPPE.", ".QPPPPPPPPPPPP.", "..QPPPPPPPPPP..", "....PPPPPPPP...", "......PPPPP...."]
    ]
  },
  turtle: {
    px: 4,
    palette: { S: "#3a6b48", T: "#234d2d", H: "#5a8a5e", E: "#1a1410", F: "#3a6b48" },
    frames: [
      ["....SSSSSSS...", "..SSTSSSTSSS..", ".SSSSSSSSSSSH.", "SSSTSSSSTSSHHH", "SSSSSSSSSSSHEE", "SSSTSSSSTSSHHH", ".SSSSSSSSSSSH.", "..SSSSSSSSS...", "FFF........FFF", "F.............F"],
      ["....SSSSSSS...", "..SSTSSSTSSS..", ".SSSSSSSSSSSH.", "SSSTSSSSTSSHHH", "SSSSSSSSSSSHEE", "SSSTSSSSTSSHHH", ".SSSSSSSSSSSH.", "..SSSSSSSSS...", ".F.........F..", "FF.........FF."]
    ]
  }
};

export class AquariumEngine {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private creatures: Fish[] = [];
  private structures: Structure[] = [];
  private bubbles: Bubble[] = [];
  private cosmetics: Cosmetics | null = null;
  private imgCache: Record<string, { src: string; img: HTMLImageElement }> = {};
  private bgImg: HTMLImageElement | null = null;
  private lpBg: any = null;
  private raf = 0;
  private ro: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    for (let i = 0; i < 20; i++) {
      this.bubbles.push({ x: rand(0, this.W), y: rand(0, this.H), r: rand(1, 3), speed: rand(0.08, 0.22), phase: rand(0, 6) });
    }
  }

  setCosmetics(c: Cosmetics) {
    this.cosmetics = c;
    this.imgCache = {};
    this.bgImg = null;
  }

  /** Add/remove creatures so the tank matches the persisted inventory. */
  setInventory(inv: Inventory) {
    for (const type of FISH_TYPES) {
      let diff = inv[type] - this.creatures.filter((c) => c.type === type).length;
      while (diff > 0) { this.spawn(type); diff--; }
      while (diff < 0) { this.removeOne(this.creatures, type); diff++; }
    }
    for (const type of STRUCT_TYPES) {
      let diff = inv[type] - this.structures.filter((s) => s.type === type).length;
      while (diff > 0) { this.spawn(type); diff--; }
      while (diff < 0) { this.removeOne(this.structures, type); diff++; }
    }
  }

  start() {
    const loop = (t: number) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
  }

  /* ---------- internals ---------- */
  private resize() {
    const rect = this.cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.max(1, rect.width * dpr);
    this.cv.height = Math.max(1, rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.W = rect.width;
    this.H = rect.height;
    if (!this.lpBg || this.lpBg.W !== this.W || this.lpBg.H !== this.H) {
      this.lpBg = this.buildLowPolyBackground();
    }
  }

  private removeOne(arr: any[], type: CreatureType) {
    const idx = arr.findIndex((c) => c.type === type);
    if (idx >= 0) arr.splice(idx, 1);
  }

  private spawn(type: CreatureType) {
    const { W, H } = this;
    if (type === "smallFish") this.creatures.push(this.makeFish("smallFish", rand(0, W), rand(H * 0.2, H * 0.8)));
    else if (type === "moonFish") this.creatures.push(this.makeFish("moonFish", rand(0, W), rand(H * 0.2, H * 0.8)));
    else if (type === "clownfish") this.creatures.push(this.makeFish("clownfish", rand(0, W), rand(H * 0.4, H * 0.85)));
    else if (type === "bigFish") this.creatures.push(this.makeFish("bigFish", rand(0, W), rand(H * 0.3, H * 0.7)));
    else if (type === "turtle") this.creatures.push(this.makeTurtle(rand(0, W), rand(H * 0.3, H * 0.65)));
    else if (type === "seaweed") this.structures.push(this.makeSeaweed(rand(W * 0.05, W * 0.95), H - 4));
    else if (type === "anemone") this.structures.push(this.makeAnemone(rand(W * 0.1, W * 0.9), H - 6));
    else if (type === "coral") this.structures.push(this.makeCoral(rand(W * 0.08, W * 0.92), H - 6));
  }

  private makeFish(type: CreatureType, x: number, y: number): Fish {
    let color = "#f0c674", size = 8, speed = rand(0.2, 0.35);
    if (type === "moonFish") { color = "#e7d9b0"; size = 16; speed = rand(0.1, 0.2); }
    if (type === "clownfish") { color = "#e07a3c"; size = 12; speed = rand(0.13, 0.22); }
    if (type === "bigFish") { color = "#bb6abf"; size = 28; speed = rand(0.06, 0.12); }
    return { type, x, y, size, color, vx: (Math.random() < 0.5 ? -1 : 1) * speed, vy: rand(-0.05, 0.05), phase: Math.random() * 6, speed };
  }
  private makeTurtle(x: number, y: number): Fish {
    return { type: "turtle", x, y, size: 26, color: "#3a6b48", vx: (Math.random() < 0.5 ? -1 : 1) * 0.06, vy: rand(-0.02, 0.02), phase: Math.random() * 6, speed: 0.06 };
  }
  private makeSeaweed(x: number, baseY: number): Structure {
    return { type: "seaweed", x, baseY, h: rand(40, 80), seg: 8, phase: Math.random() * 6, hue: rand(120, 150) };
  }
  private makeAnemone(x: number, baseY: number): Structure {
    return { type: "anemone", x, baseY, r: rand(10, 16), tentacles: 12, phase: Math.random() * 6, hue: rand(330, 360) };
  }
  private makeCoral(x: number, baseY: number): Structure {
    const branches = [];
    const n = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) branches.push({ angle: rand(-Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6), len: rand(18, 32), w: rand(3, 6) });
    return { type: "coral", x, baseY, branches, hue: rand(0, 30) };
  }

  private getImage(type: CreatureType): HTMLImageElement | null {
    const url = this.cosmetics?.creatures[type];
    if (!url) return null;
    if (this.imgCache[type] && this.imgCache[type].src === url) return this.imgCache[type].img;
    const img = new Image();
    img.src = url;
    this.imgCache[type] = { src: url, img };
    return img;
  }
  private getBgImage(): HTMLImageElement | null {
    const url = this.cosmetics?.background;
    if (!url) return null;
    if (this.bgImg && this.bgImg.src === url) return this.bgImg;
    this.bgImg = new Image();
    this.bgImg.src = url;
    return this.bgImg;
  }

  private buildLowPolyBackground() {
    const { W, H } = this;
    const layers = [
      { y: 0, color: "#1d5b88" },
      { y: H * 0.25, color: "#174e7a" },
      { y: H * 0.45, color: "#103c61" },
      { y: H * 0.65, color: "#0a2d4b" },
      { y: H * 0.82, color: "#072138" }
    ];
    const sandTopY = H * 0.86;
    const sandPeaks = [];
    const cols = 14;
    for (let i = 0; i <= cols; i++) {
      sandPeaks.push({ x: (W * i) / cols, y: sandTopY + (Math.sin(i * 1.7) * 0.5 + Math.cos(i * 0.7) * 0.5) * 14 });
    }
    const rocks = [];
    for (let i = 0; i < 5; i++) {
      const cx = W * (0.1 + 0.18 * i + (i % 2) * 0.04);
      const base = H * 0.87 + (i % 2) * 4;
      const w = 30 + ((i * 13) % 24);
      const h = 22 + ((i * 7) % 18);
      rocks.push({ pts: [[cx - w / 2, base], [cx, base - h], [cx + w / 2, base]], color: i % 2 ? "#2a3b4f" : "#23354a" });
    }
    const beams = [];
    for (let i = 0; i < 3; i++) {
      const cx = W * (0.2 + i * 0.3);
      beams.push({ pts: [[cx - 30, 0], [cx + 30, 0], [cx + 90, H * 0.75], [cx - 90, H * 0.75]], color: "rgba(248,232,176,0.06)" });
    }
    return { W, H, layers, sandPeaks, rocks, beams };
  }

  private drawLowPolyBackground(t: number) {
    const ctx = this.ctx;
    const bg = this.lpBg;
    for (let i = 0; i < bg.layers.length; i++) {
      const top = bg.layers[i].y;
      const bottom = bg.layers[i + 1] ? bg.layers[i + 1].y : this.H;
      ctx.fillStyle = bg.layers[i].color;
      ctx.fillRect(0, Math.round(top), this.W, Math.ceil(bottom - top) + 1);
    }
    for (const beam of bg.beams) {
      ctx.fillStyle = beam.color;
      ctx.beginPath();
      ctx.moveTo(beam.pts[0][0], beam.pts[0][1]);
      for (let i = 1; i < beam.pts.length; i++) ctx.lineTo(beam.pts[i][0], beam.pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    for (const rock of bg.rocks) {
      ctx.fillStyle = rock.color;
      ctx.beginPath();
      ctx.moveTo(rock.pts[0][0], rock.pts[0][1]);
      for (let i = 1; i < rock.pts.length; i++) ctx.lineTo(rock.pts[i][0], rock.pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#c8a874";
    ctx.beginPath();
    ctx.moveTo(0, this.H);
    for (const p of bg.sandPeaks) ctx.lineTo(p.x, p.y);
    ctx.lineTo(this.W, this.H);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#a88857";
    for (let i = 0; i < bg.sandPeaks.length - 1; i += 2) {
      const a = bg.sandPeaks[i];
      const b = bg.sandPeaks[i + 1];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo((a.x + b.x) / 2, this.H);
      ctx.closePath();
      ctx.fill();
    }
    void t;
  }

  private drawBackground(t: number) {
    const ctx = this.ctx;
    const bgi = this.getBgImage();
    if (bgi && bgi.complete && bgi.naturalWidth > 0) {
      const ir = bgi.naturalWidth / bgi.naturalHeight;
      const cr = this.W / this.H;
      let dw, dh, dx, dy;
      if (ir > cr) { dh = this.H; dw = this.H * ir; dx = (this.W - dw) / 2; dy = 0; }
      else { dw = this.W; dh = this.W / ir; dx = 0; dy = (this.H - dh) / 2; }
      ctx.drawImage(bgi, dx, dy, dw, dh);
      ctx.fillStyle = "rgba(11,37,64,0.18)";
      ctx.fillRect(0, 0, this.W, this.H);
    } else {
      this.drawLowPolyBackground(t);
    }
  }

  private drawSprite(type: CreatureType, x: number, y: number, dir: number, t: number): boolean {
    const sp = SPRITES[type];
    if (!sp) return false;
    const ctx = this.ctx;
    const frame = sp.frames[Math.floor(t * 0.0025) % sp.frames.length];
    const rows = frame.length, cols = frame[0].length, px = sp.px;
    const w = cols * px, h = rows * px;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    if (dir < 0) ctx.scale(-1, 1);
    const ox = -Math.round(w / 2), oy = -Math.round(h / 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = frame[r][c];
        if (k === ".") continue;
        const col = sp.palette[k];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(ox + c * px, oy + r * px, px, px);
      }
    }
    ctx.restore();
    return true;
  }

  private drawFishImage(f: Fish, img: HTMLImageElement) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.vx >= 0 ? 1 : -1, 1);
    const targetW = f.size * 3.2;
    const ratio = img.naturalHeight / img.naturalWidth;
    ctx.drawImage(img, -targetW / 2, -(targetW * ratio) / 2, targetW, targetW * ratio);
    ctx.restore();
  }

  private drawFishProcedural(f: Fish, t: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.vx >= 0 ? 1 : -1, 1);
    const wag = Math.sin(t * 0.005 + f.phase) * (f.type === "bigFish" ? 0.08 : 0.18);
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, f.size, f.size * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.ellipse(2, 2, f.size * 0.7, f.size * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(-f.size, 0);
    ctx.lineTo(-f.size * 1.8, -f.size * 0.6 + wag * f.size);
    ctx.lineTo(-f.size * 1.8, f.size * 0.6 + wag * f.size);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1a1410";
    ctx.beginPath();
    ctx.arc(f.size * 0.55, -f.size * 0.1, Math.max(1.2, f.size * 0.08), 0, Math.PI * 2);
    ctx.fill();
    if (f.type === "clownfish") {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size * 0.18, f.size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(f.size * 0.5, 0, f.size * 0.12, f.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFish(f: Fish, t: number) {
    const img = this.getImage(f.type);
    if (img && img.complete && img.naturalWidth > 0) { this.drawFishImage(f, img); return; }
    if (!this.drawSprite(f.type, f.x, f.y, f.vx >= 0 ? 1 : -1, t)) this.drawFishProcedural(f, t);
  }

  private drawTurtleProcedural(o: Fish, t: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(o.vx >= 0 ? 1 : -1, 1);
    ctx.fillStyle = "#3a6b48";
    ctx.beginPath();
    ctx.ellipse(0, 0, o.size, o.size * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2c5235";
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(-o.size * 0.5 + i * o.size * 0.25, 0, o.size * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#5a8a5e";
    ctx.beginPath();
    ctx.ellipse(o.size * 0.9, -o.size * 0.1, o.size * 0.32, o.size * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    const flap = Math.sin(t * 0.004 + o.phase) * 0.4;
    ctx.beginPath();
    ctx.ellipse(o.size * 0.3, o.size * 0.5, o.size * 0.45, o.size * 0.18, 0.4 + flap, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-o.size * 0.3, o.size * 0.5, o.size * 0.4, o.size * 0.18, -0.4 - flap, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawTurtle(o: Fish, t: number) {
    const img = this.getImage("turtle");
    if (img && img.complete && img.naturalWidth > 0) { this.drawFishImage(o, img); return; }
    if (!this.drawSprite("turtle", o.x, o.y, o.vx >= 0 ? 1 : -1, t)) this.drawTurtleProcedural(o, t);
  }

  private drawStructure(s: Structure, t: number) {
    const img = this.getImage(s.type);
    const ctx = this.ctx;
    if (img && img.complete && img.naturalWidth > 0) {
      const ratio = img.naturalHeight / img.naturalWidth;
      const w = s.type === "seaweed" ? 36 : 56;
      ctx.drawImage(img, s.x - w / 2, s.baseY - w * ratio, w, w * ratio);
      return;
    }
    if (s.type === "seaweed") {
      ctx.save();
      ctx.strokeStyle = `hsl(${s.hue}, 50%, 35%)`;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.x, s.baseY);
      for (let i = 1; i <= s.seg!; i++) {
        const yy = s.baseY - (s.h! * i) / s.seg!;
        const sway = Math.sin(t * 0.002 + s.phase! + i * 0.3) * (i * 1.5);
        ctx.lineTo(s.x + sway, yy);
      }
      ctx.stroke();
      ctx.restore();
    } else if (s.type === "anemone") {
      ctx.save();
      ctx.fillStyle = `hsl(${s.hue}, 40%, 35%)`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.baseY, s.r! * 0.9, s.r! * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsl(${s.hue}, 65%, 65%)`;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      for (let i = 0; i < s.tentacles!; i++) {
        const ang = (i / s.tentacles!) * Math.PI - Math.PI;
        const sway = Math.sin(t * 0.003 + s.phase! + i) * 4;
        const tx = s.x + Math.cos(ang) * s.r! * 0.6;
        const ty = s.baseY + Math.sin(ang) * s.r! * 0.2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(tx + sway, ty - s.r! * 0.8, tx + sway * 1.5, ty - s.r! * 1.5);
        ctx.stroke();
      }
      ctx.restore();
    } else if (s.type === "coral") {
      ctx.save();
      for (const b of s.branches!) {
        ctx.strokeStyle = `hsl(${s.hue}, 55%, 55%)`;
        ctx.lineWidth = b.w;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(s.x, s.baseY);
        const ex = s.x + Math.cos(b.angle) * b.len;
        const ey = s.baseY + Math.sin(b.angle) * b.len;
        ctx.quadraticCurveTo(s.x + Math.cos(b.angle) * b.len * 0.4, s.baseY + Math.sin(b.angle) * b.len * 0.7, ex, ey);
        ctx.stroke();
        ctx.fillStyle = `hsl(${s.hue}, 70%, 70%)`;
        ctx.beginPath();
        ctx.arc(ex, ey, b.w * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawBubbles() {
    const ctx = this.ctx;
    for (const b of this.bubbles) {
      b.y -= b.speed;
      b.x += Math.sin(b.y * 0.04 + b.phase) * 0.3;
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1;
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
      if (b.y < -10) { b.y = this.H + 10; b.x = rand(0, this.W); }
    }
  }

  private updateFish(f: Fish) {
    const { W, H } = this;
    if (f.type === "smallFish") {
      let cx = 0, cy = 0, cn = 0, vx = 0, vy = 0;
      for (const o of this.creatures) {
        if (o === f || o.type !== "smallFish") continue;
        const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
        if (d < 80) { cx += o.x; cy += o.y; cn++; vx += o.vx; vy += o.vy; }
        if (d < 18 && d > 0) { f.vx -= (dx / d) * 0.02; f.vy -= (dy / d) * 0.02; }
      }
      if (cn) {
        f.vx += (cx / cn - f.x) * 0.0008;
        f.vy += (cy / cn - f.y) * 0.0008;
        f.vx += (vx / cn - f.vx) * 0.02;
        f.vy += (vy / cn - f.vy) * 0.02;
      }
    }
    if (f.type === "clownfish") {
      let target: Structure | null = null, td = 1e9;
      for (const s of this.structures) {
        if (s.type !== "anemone") continue;
        const d = Math.hypot(s.x - f.x, s.baseY - 20 - f.y);
        if (d < td) { td = d; target = s; }
      }
      if (target) {
        f.vx += (target.x - f.x) * 0.0004;
        f.vy += (target.baseY - 20 - f.y) * 0.0004;
        if (td < 30) {
          f.vx *= 0.85; f.vy *= 0.85;
          f.vx += Math.cos(performance.now() * 0.003 + f.phase) * 0.05;
          f.vy += Math.sin(performance.now() * 0.003 + f.phase) * 0.05;
        }
      }
    }
    if (f.type === "bigFish" || f.type === "moonFish") {
      f.vy += Math.sin(performance.now() * 0.0015 + f.phase) * 0.005;
    }
    const sp = Math.hypot(f.vx, f.vy), cap = f.speed * 1.5;
    if (sp > cap) { f.vx = (f.vx / sp) * cap; f.vy = (f.vy / sp) * cap; }
    if (sp < f.speed * 0.4) {
      if (sp > 0) { f.vx = (f.vx / sp) * f.speed * 0.5; f.vy = (f.vy / sp) * f.speed * 0.5; }
      else f.vx = f.speed * (Math.random() < 0.5 ? -1 : 1);
    }
    f.x += f.vx; f.y += f.vy;
    if (f.x < -f.size * 2) f.x = W + f.size * 2;
    if (f.x > W + f.size * 2) f.x = -f.size * 2;
    if (f.y < 20) { f.y = 20; f.vy = Math.abs(f.vy); }
    if (f.y > H - 24) { f.y = H - 24; f.vy = -Math.abs(f.vy); }
  }

  private updateTurtle(o: Fish) {
    const { W, H } = this;
    o.vy += Math.sin(performance.now() * 0.0008 + o.phase) * 0.003;
    o.x += o.vx; o.y += o.vy;
    if (o.x < -60) o.x = W + 60;
    if (o.x > W + 60) o.x = -60;
    if (o.y < 30) { o.y = 30; o.vy = Math.abs(o.vy); }
    if (o.y > H - 40) { o.y = H - 40; o.vy = -Math.abs(o.vy); }
  }

  private frame(t: number) {
    if (this.W === 0) this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this.drawBackground(t);
    for (const s of this.structures) this.drawStructure(s, t);
    for (const c of this.creatures) {
      if (c.type === "turtle") { this.updateTurtle(c); this.drawTurtle(c, t); }
      else { this.updateFish(c); this.drawFish(c, t); }
    }
    this.drawBubbles();
  }
}
