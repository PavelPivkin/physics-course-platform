import Konva from "konva";
import type { BoardObject, Bounds, Point } from "./model";

export type BoardRenderState = {
  objects: BoardObject[];
  selectedIds: Set<string>;
  draftObject: BoardObject | null;
  selectionBox: { start: Point; end: Point } | null;
  localCursor: Point | null;
  remoteCursor: Point | null;
  simulatingFrameId: string | null;
};

export type BoardHit = {
  objectId: string | null;
  frameSimulate: string | null;
  handle: "end" | "resize" | null;
};

const finite = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const PALETTE = {
  surface: "#0d2239",
  navy: "#0b1e33",
  blue: "#639bf2",
  orange: "#ff401c",
  white: "#f8fbff",
  muted: "#9eb0c4",
  gridMinor: "rgba(99,155,242,.10)",
  gridMajor: "rgba(99,155,242,.22)",
};

export class KonvaBoardRenderer {
  private readonly stage: Konva.Stage;
  private readonly gridLayer = new Konva.Layer({ listening: false });
  private readonly contentLayer = new Konva.Layer();
  private readonly overlayLayer = new Konva.Layer();
  private readonly content = new Konva.Group();
  private readonly overlay = new Konva.Group();
  private readonly grid: Konva.Shape;
  private readonly observer: ResizeObserver;
  private camera = { x: 0, y: 0, scale: 1 };

  constructor(private readonly container: HTMLDivElement) {
    this.stage = new Konva.Stage({ container, width: container.clientWidth || 1, height: container.clientHeight || 1 });
    this.grid = new Konva.Shape({ sceneFunc: (context) => this.drawGrid(context) });
    this.gridLayer.add(this.grid);
    this.contentLayer.add(this.content);
    this.overlayLayer.add(this.overlay);
    this.stage.add(this.gridLayer, this.contentLayer, this.overlayLayer);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  destroy() {
    this.observer.disconnect();
    this.stage.destroy();
  }

  get scale() { return this.camera.scale; }

  setTool(tool: string) {
    this.container.dataset.tool = tool;
  }

  render(state: BoardRenderState) {
    this.refreshPalette();
    this.content.destroyChildren();
    this.overlay.destroyChildren();
    const ordered = [...state.objects].sort((a, b) => Number(a.kind !== "frame") - Number(b.kind !== "frame"));
    for (const object of ordered) this.content.add(this.objectNode(object, state.selectedIds.has(object.id), state.simulatingFrameId));
    if (state.draftObject) this.content.add(this.objectNode(state.draftObject, false, null, true));
    if (state.selectionBox) this.overlay.add(this.marqueeNode(state.selectionBox));
    if (state.localCursor) this.overlay.add(this.cursorNode(state.localCursor, "указка", PALETTE.blue));
    if (state.remoteCursor) this.overlay.add(this.cursorNode(state.remoteCursor, "ученик", PALETTE.orange));
    this.applyCamera();
    this.gridLayer.batchDraw();
    this.contentLayer.batchDraw();
    this.overlayLayer.batchDraw();
  }

  toWorldPoint(clientX: number, clientY: number): Point {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.camera.x) / this.camera.scale,
      y: (clientY - rect.top - this.camera.y) / this.camera.scale,
    };
  }

  hitAt(clientX: number, clientY: number): BoardHit {
    const rect = this.container.getBoundingClientRect();
    let node: Konva.Node | null = this.stage.getIntersection({ x: clientX - rect.left, y: clientY - rect.top });
    const hit: BoardHit = { objectId: null, frameSimulate: null, handle: null };
    while (node && node !== this.stage) {
      hit.objectId ||= node.getAttr("objectId") || null;
      hit.frameSimulate ||= node.getAttr("frameSimulate") || null;
      hit.handle ||= node.getAttr("boardHandle") || null;
      node = node.getParent();
    }
    return hit;
  }

  panBy(dx: number, dy: number) {
    this.camera.x += dx;
    this.camera.y += dy;
    this.cameraChanged();
  }

  zoomAt(factor: number, clientX?: number, clientY?: number) {
    const oldScale = this.camera.scale;
    const nextScale = Math.min(8, Math.max(.08, oldScale * factor));
    const rect = this.container.getBoundingClientRect();
    const screenX = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const screenY = (clientY ?? rect.top + rect.height / 2) - rect.top;
    const worldX = (screenX - this.camera.x) / oldScale;
    const worldY = (screenY - this.camera.y) / oldScale;
    this.camera.scale = nextScale;
    this.camera.x = screenX - worldX * nextScale;
    this.camera.y = screenY - worldY * nextScale;
    this.cameraChanged();
  }

  resetCamera() {
    this.camera = { x: 0, y: 0, scale: 1 };
    this.cameraChanged();
  }

  private resize() {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.stage.size({ width, height });
    this.gridLayer.batchDraw();
  }

  private refreshPalette() {
    const styles = getComputedStyle(this.container);
    const value = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    PALETTE.surface = value("--board-surface", value("--navy", PALETTE.surface));
    PALETTE.navy = value("--navy", PALETTE.navy);
    PALETTE.blue = value("--light-blue", PALETTE.blue);
    PALETTE.orange = value("--orange", PALETTE.orange);
    PALETTE.white = value("--white", PALETTE.white);
    PALETTE.muted = value("--board-muted", PALETTE.muted);
    const light = document.documentElement.dataset.theme === "physics-light";
    PALETTE.gridMinor = light ? "rgba(33,68,133,.09)" : "rgba(99,155,242,.10)";
    PALETTE.gridMajor = light ? "rgba(33,68,133,.15)" : "rgba(99,155,242,.22)";
  }

  private cameraChanged() {
    this.applyCamera();
    this.gridLayer.batchDraw();
    this.contentLayer.batchDraw();
    this.overlayLayer.batchDraw();
  }

  private applyCamera() {
    for (const group of [this.content, this.overlay]) {
      group.position({ x: this.camera.x, y: this.camera.y });
      group.scale({ x: this.camera.scale, y: this.camera.scale });
    }
  }

  private drawGrid(context: Konva.Context) {
    const ctx = context._context;
    const width = this.stage.width(), height = this.stage.height();
    ctx.fillStyle = PALETTE.surface;
    ctx.fillRect(0, 0, width, height);
    const minor = 32 * this.camera.scale;
    if (minor < 7) return;
    const startX = ((this.camera.x % minor) + minor) % minor;
    const startY = ((this.camera.y % minor) + minor) % minor;
    ctx.lineWidth = 1;
    ctx.strokeStyle = PALETTE.gridMinor;
    ctx.beginPath();
    for (let x = startX; x < width; x += minor) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = startY; y < height; y += minor) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
    const major = minor * 5;
    const majorX = ((this.camera.x % major) + major) % major;
    const majorY = ((this.camera.y % major) + major) % major;
    ctx.strokeStyle = PALETTE.gridMajor;
    ctx.beginPath();
    for (let x = majorX; x < width; x += major) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = majorY; y < height; y += major) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
  }

  private objectNode(object: BoardObject, selected: boolean, simulatingFrameId: string | null, preview = false) {
    const group = new Konva.Group({ objectId: object.id, opacity: preview ? .7 : 1 });
    const color = object.color || PALETTE.white;
    const x = finite(object.x), y = finite(object.y);
    if (object.kind === "frame") {
      const w = finite(object.w, 720), h = finite(object.h, 460);
      group.add(new Konva.Rect({ x: x - w / 2, y: y - h / 2, width: w, height: h, cornerRadius: 18, fill: "rgba(33,68,133,.08)", stroke: PALETTE.blue, strokeWidth: 2, dash: [10, 7], listening: false }));
      group.add(new Konva.Rect({ x: x - w / 2, y: y - h / 2, width: w, height: h, cornerRadius: 18, stroke: "rgba(0,0,0,.001)", strokeWidth: 2, hitStrokeWidth: 18 }));
      group.add(new Konva.Text({ x: x - w / 2 + 24, y: y - h / 2 + 20, text: object.label || "Физическая модель", fill: PALETTE.blue, fontFamily: "Rubik", fontSize: 18, letterSpacing: 1.4 }));
      const running = simulatingFrameId === object.id;
      const button = new Konva.Group({ x: x + w / 2 - 54, y: y - h / 2 + 14, frameSimulate: object.id });
      button.add(new Konva.Rect({ width: 40, height: 30, cornerRadius: 7, fill: PALETTE.navy, stroke: running ? PALETTE.orange : PALETTE.blue, strokeWidth: 2 }));
      button.add(new Konva.Text({ width: 40, y: 6, align: "center", text: running ? "Ⅱ" : "▶", fill: running ? PALETTE.orange : PALETTE.blue, fontSize: 16, listening: false }));
      group.add(button);
      if (selected) {
        group.add(this.selectionRect(x - w / 2 - 8, y - h / 2 - 8, w + 16, h + 16, 22));
        group.add(this.handle(x + w / 2, y + h / 2, "resize"));
      }
      return group;
    }
    if (object.kind === "block") {
      const w = finite(object.w, 170), h = finite(object.h, 105);
      const body = new Konva.Group({ x, y, rotation: finite(object.angle) });
      body.add(new Konva.Rect({ x: -w / 2, y: -h / 2, width: w, height: h, cornerRadius: 7, fill: "rgba(99,155,242,.14)", stroke: color, strokeWidth: 3 }));
      body.add(new Konva.Circle({ x: 0, y: 0, radius: 6, fill: PALETTE.orange, listening: false }));
      body.add(this.centeredText(0, -32, object.label || "", 22));
      if (selected) { body.add(this.selectionRect(-w / 2 - 12, -h / 2 - 12, w + 24, h + 24, 8)); body.add(this.handle(w / 2, h / 2, "resize")); }
      group.add(body);
      return group;
    }
    if (object.kind === "ball") {
      const r = finite(object.r, 58);
      group.add(new Konva.Circle({ x, y, radius: r, fill: "rgba(99,155,242,.14)", stroke: color, strokeWidth: 3 }));
      group.add(new Konva.Circle({ x, y, radius: 6, fill: PALETTE.orange, listening: false }));
      group.add(this.centeredText(x, y - 32, object.label || "", 22));
      if (selected) { group.add(new Konva.Circle({ x, y, radius: r + 12, stroke: PALETTE.orange, strokeWidth: 2, dash: [8, 6], listening: false })); group.add(this.handle(x + r * .72, y + r * .72, "resize")); }
      return group;
    }
    if (object.kind === "pulley") {
      const r = finite(object.r, 55);
      group.add(new Konva.Line({ points: [x, y - r, x, y - r - 45, x - 24, y - r - 45, x + 24, y - r - 45], stroke: PALETTE.white, strokeWidth: 3 }));
      group.add(new Konva.Circle({ x, y, radius: r, fill: PALETTE.surface, stroke: color, strokeWidth: 4 }));
      group.add(new Konva.Circle({ x, y, radius: r * .38, stroke: color, strokeWidth: 4 }));
      if (selected) group.add(new Konva.Circle({ x, y, radius: r + 12, stroke: PALETTE.orange, strokeWidth: 2, dash: [8, 6], listening: false }));
      return group;
    }
    if (object.kind === "vector" || object.kind === "rope") {
      const x1 = finite(object.x1), y1 = finite(object.y1), x2 = finite(object.x2), y2 = finite(object.y2);
      if (object.kind === "vector") {
        group.add(new Konva.Arrow({ points: [x1, y1, x2, y2], stroke: color, fill: color, strokeWidth: 5, pointerLength: 15, pointerWidth: 13, hitStrokeWidth: 24 }));
        group.add(new Konva.Text({ x: (x1 + x2) / 2 + 12, y: (y1 + y2) / 2 - 30, text: `${object.label || "F"}${formatForce(object.force)}`, fill: color, fontFamily: "Georgia", fontStyle: "italic", fontSize: 26, listening: false }));
        if (selected) group.add(this.handle(x2, y2, "end"));
      } else group.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: color, strokeWidth: 4, lineCap: "round", dash: [3, 3], hitStrokeWidth: 20 }));
      return group;
    }
    if (object.kind === "surface") {
      const w = finite(object.w, 330), angle = finite(object.angle), rough = finite(object.friction) > 0;
      const surface = new Konva.Group({ x, y, rotation: angle });
      surface.add(new Konva.Line({ points: [-w / 2, 0, w / 2, 0], stroke: color, strokeWidth: 5, lineCap: "round", hitStrokeWidth: 20 }));
      if (rough) for (let i = 0; i < 14; i++) { const sx = -w / 2 + i * (w / 13); surface.add(new Konva.Line({ points: [sx, 0, sx - 10, 12], stroke: PALETTE.muted, strokeWidth: 2, listening: false })); }
      group.add(surface, this.centeredText(x, y - 28, `μ = ${finite(object.friction).toFixed(2)}`, 16, PALETTE.muted));
      return group;
    }
    if (object.kind === "spring") {
      const points = springPoints(finite(object.x1), finite(object.y1), finite(object.x2), finite(object.y2));
      group.add(new Konva.Line({ points, stroke: color, strokeWidth: 4, lineJoin: "round", hitStrokeWidth: 20 }));
      group.add(this.centeredText((finite(object.x1) + finite(object.x2)) / 2, (finite(object.y1) + finite(object.y2)) / 2 - 30, `k = ${finite(object.stiffness, 20)} Н/м`, 16, PALETTE.muted));
      return group;
    }
    if (object.kind === "path") {
      group.add(new Konva.Line({ points: (object.points || []).flatMap((point) => [point.x, point.y]), stroke: color, strokeWidth: 4, lineCap: "round", lineJoin: "round", hitStrokeWidth: 20 }));
      return group;
    }
    if (object.kind === "dipole") {
      group.add(new Konva.Circle({ x: x - 42, y, radius: 30, fill: "rgba(255,64,28,.2)", stroke: PALETTE.orange, strokeWidth: 3 }));
      group.add(new Konva.Circle({ x: x + 42, y, radius: 30, fill: "rgba(99,155,242,.2)", stroke: PALETTE.blue, strokeWidth: 3 }));
      group.add(this.centeredText(x - 42, y - 17, "+", 30), this.centeredText(x + 42, y - 17, "−", 30));
      return group;
    }
    if (object.kind === "atom") return this.atomNode(group, object);
    if (object.kind === "orbit") return this.orbitNode(group, object);
    if (object.kind === "container") return this.containerNode(group, object);
    const text = object.text || "";
    const fontSize = object.kind === "formula" ? 40 : 25;
    group.add(new Konva.Text({ x, y: y - fontSize, text, fill: color, fontFamily: object.kind === "formula" ? "Georgia" : "Rubik", fontStyle: object.kind === "formula" ? "italic" : "normal", fontSize, hitStrokeWidth: 12 }));
    if (selected) group.add(this.selectionRect(x - 12, y - fontSize - 10, Math.max(90, text.length * fontSize * .62), fontSize + 20, 5));
    return group;
  }

  private atomNode(group: Konva.Group, object: BoardObject) {
    const x = finite(object.x), y = finite(object.y), p = finite(object.protons, 1), n = finite(object.neutrons), e = finite(object.electrons, p);
    group.add(new Konva.Circle({ x, y, radius: 58, stroke: PALETTE.blue, strokeWidth: 2, dash: [5, 5] }), new Konva.Circle({ x, y, radius: 24, fill: PALETTE.orange }));
    for (let i = 0; i < Math.min(e, 8); i++) group.add(new Konva.Circle({ x: x + 58 * Math.cos(i / Math.max(e, 1) * Math.PI * 2), y: y + 58 * Math.sin(i / Math.max(e, 1) * Math.PI * 2), radius: 5, fill: PALETTE.blue }));
    group.add(this.centeredText(x, y + 88, `Z=${p}, A=${p + n}, q=${p - e}`, 16, PALETTE.muted));
    return group;
  }

  private orbitNode(group: Konva.Group, object: BoardObject) {
    const x = finite(object.x), y = finite(object.y);
    group.add(new Konva.Circle({ x, y, radius: 24, fill: PALETTE.orange }), new Konva.Circle({ x, y, radius: 96, stroke: PALETTE.blue, strokeWidth: 2, dash: [5, 5] }), new Konva.Circle({ x: x + 96, y, radius: 13, fill: PALETTE.blue }));
    group.add(this.centeredText(x, y + 118, "движение по окружности", 16, PALETTE.muted));
    return group;
  }

  private containerNode(group: Konva.Group, object: BoardObject) {
    const x = finite(object.x), y = finite(object.y), w = finite(object.w, 280), h = finite(object.h, 170), temp = finite(object.temperature, 20);
    const hot = Math.min(1, Math.max(0, (temp + 20) / 120));
    const color = `rgb(${Math.round(70 + hot * 185)},${Math.round(145 - hot * 85)},${Math.round(242 - hot * 190)})`;
    group.add(new Konva.Rect({ x: x - w / 2, y: y - h / 2, width: w, height: h, cornerRadius: 14, fill: "rgba(99,155,242,.08)", stroke: PALETTE.blue, strokeWidth: 3 }));
    for (let i = 0; i < 18; i++) group.add(new Konva.Circle({ x: x - w / 2 + 22 + (i * 47) % (w - 40), y: y - h / 2 + 24 + (i * 31) % (h - 45), radius: 4 + i % 3, fill: color, opacity: .8, listening: false }));
    group.add(this.centeredText(x, y + h / 2 + 14, `T = ${temp} °C · тепловая модель`, 16, PALETTE.muted));
    return group;
  }

  private centeredText(x: number, y: number, text: string, fontSize: number, fill = PALETTE.white) {
    return new Konva.Text({ x: x - 180, y, width: 360, align: "center", text, fill, fontFamily: "Rubik", fontSize, listening: false });
  }

  private selectionRect(x: number, y: number, width: number, height: number, radius: number) {
    return new Konva.Rect({ x, y, width, height, cornerRadius: radius, stroke: PALETTE.orange, strokeWidth: 2, dash: [8, 6], listening: false });
  }

  private handle(x: number, y: number, boardHandle: "end" | "resize") {
    return new Konva.Circle({ x, y, radius: 10, fill: PALETTE.orange, stroke: PALETTE.navy, strokeWidth: 3, boardHandle });
  }

  private marqueeNode(box: { start: Point; end: Point }) {
    const bounds = normalizeBounds(box.start, box.end);
    return new Konva.Rect({ x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top, fill: "rgba(99,155,242,.12)", stroke: PALETTE.blue, strokeWidth: 2 / this.camera.scale, dash: [7 / this.camera.scale, 5 / this.camera.scale], listening: false });
  }

  private cursorNode(point: Point, label: string, color: string) {
    const group = new Konva.Group({ x: point.x, y: point.y, listening: false });
    group.add(new Konva.Line({ points: [0, 0, 5, 26, 12, 17, 22, 16], closed: true, fill: color }));
    group.add(new Konva.Text({ x: 20, y: 22, text: label, fill: color, fontFamily: "Rubik", fontSize: 17 }));
    return group;
  }
}

function normalizeBounds(a: Point, b: Point): Bounds {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

function springPoints(x1: number, y1: number, x2: number, y2: number) {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / length, uy = (y2 - y1) / length, px = -uy, py = ux;
  return [{ x: x1, y: y1 }, ...Array.from({ length: 10 }, (_, i) => ({ x: x1 + ux * (20 + i * ((length - 40) / 9)) + px * (i % 2 ? 14 : -14), y: y1 + uy * (20 + i * ((length - 40) / 9)) + py * (i % 2 ? 14 : -14) })), { x: x2, y: y2 }].flatMap((point) => [point.x, point.y]);
}

function formatForce(force?: number) {
  if (!force) return "";
  return ` · ${force >= 1_000_000 ? `${force / 1_000_000} МН` : force >= 1_000 ? `${force / 1_000} кН` : `${force} Н`}`;
}
