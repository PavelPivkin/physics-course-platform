export type Point = { x: number; y: number };
export type Bounds = { left: number; top: number; right: number; bottom: number };
export type ObjectKind = "frame" | "block" | "ball" | "pulley" | "vector" | "rope" | "path" | "formula" | "text" | "surface" | "spring" | "dipole" | "atom" | "orbit" | "container";

export type BoardObject = {
  id: string;
  kind: ObjectKind;
  color: string;
  label?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: Point[];
  text?: string;
  parentId?: string;
  force?: number;
  mass?: number;
  friction?: number;
  angle?: number;
  stiffness?: number;
  temperature?: number;
  velocity?: Point;
  protons?: number;
  neutrons?: number;
  electrons?: number;
};

const number = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value as number : fallback;

export abstract class PhysicsEntity {
  constructor(public readonly data: BoardObject) {}

  get id() { return this.data.id; }
  get parentId() { return this.data.parentId; }
  abstract bounds(): Bounds;

  translate(dx: number, dy: number) {
    this.data.x = number(this.data.x) + dx;
    this.data.y = number(this.data.y) + dy;
  }
}

export class FrameEntity extends PhysicsEntity {
  bounds(): Bounds {
    const x = number(this.data.x), y = number(this.data.y), w = number(this.data.w, 720), h = number(this.data.h, 460);
    return { left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2 };
  }
}

export class BodyEntity extends PhysicsEntity {
  bounds(): Bounds {
    const x = number(this.data.x), y = number(this.data.y);
    if (this.data.kind === "ball" || this.data.kind === "pulley") {
      const r = number(this.data.r, 58);
      return { left: x - r, top: y - r, right: x + r, bottom: y + r };
    }
    const w = number(this.data.w, 170), h = number(this.data.h, 105);
    return { left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2 };
  }
}

export class ForceEntity extends PhysicsEntity {
  bounds(): Bounds {
    const x1 = number(this.data.x1), y1 = number(this.data.y1), x2 = number(this.data.x2), y2 = number(this.data.y2);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
  }

  translateEnd(dx: number, dy: number) {
    this.data.x2 = number(this.data.x2) + dx;
    this.data.y2 = number(this.data.y2) + dy;
  }

  translate(dx: number, dy: number) {
    this.data.x1 = number(this.data.x1) + dx;
    this.data.y1 = number(this.data.y1) + dy;
    this.translateEnd(dx, dy);
  }
}

export class PathEntity extends PhysicsEntity {
  bounds(): Bounds {
    const points = this.data.points || [];
    if (!points.length) return { left: 0, top: 0, right: 0, bottom: 0 };
    return {
      left: Math.min(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      right: Math.max(...points.map((point) => point.x)),
      bottom: Math.max(...points.map((point) => point.y)),
    };
  }

  translate(dx: number, dy: number) {
    this.data.points = (this.data.points || []).map((point) => ({ x: point.x + dx, y: point.y + dy }));
  }
}

export class GenericEntity extends PhysicsEntity {
  bounds(): Bounds {
    const x = number(this.data.x), y = number(this.data.y), w = number(this.data.w, 120), h = number(this.data.h, 80);
    return { left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2 };
  }
}

export class PhysicsScene {
  constructor(public objects: BoardObject[]) {}

  entity(object: BoardObject) {
    if (object.kind === "frame") return new FrameEntity(object);
    if (["block", "ball", "pulley"].includes(object.kind)) return new BodyEntity(object);
    if (["vector", "rope", "spring"].includes(object.kind)) return new ForceEntity(object);
    if (object.kind === "path") return new PathEntity(object);
    return new GenericEntity(object);
  }

  get(id: string | null | undefined) { return this.objects.find((object) => object.id === id); }
  isBody(object: BoardObject | undefined): object is BoardObject { return Boolean(object && ["block", "ball"].includes(object.kind)); }

  belongsToFrame(object: BoardObject, frameId: string) {
    let parentId = object.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (parentId === frameId) return true;
      seen.add(parentId);
      parentId = this.get(parentId)?.parentId;
    }
    return false;
  }

  frameOf(object: BoardObject | undefined) {
    if (!object) return undefined;
    if (object.kind === "frame") return object;
    return this.objects.find((candidate) => candidate.kind === "frame" && this.belongsToFrame(object, candidate.id));
  }

  descendants(frameId: string) { return this.objects.filter((object) => this.belongsToFrame(object, frameId)); }
  forcesFor(bodyId: string) { return this.objects.filter((object) => object.kind === "vector" && object.parentId === bodyId); }

  remove(ids: Set<string>) {
    const expanded = new Set(ids);
    for (const object of this.objects) {
      if ([...ids].some((id) => object.parentId === id || this.belongsToFrame(object, id))) expanded.add(object.id);
    }
    this.objects = this.objects.filter((object) => !expanded.has(object.id));
    return this.objects;
  }

  translate(ids: Iterable<string>, dx: number, dy: number) {
    const selected = new Set(ids);
    for (const id of selected) {
      const object = this.get(id);
      if (!object) continue;
      const entity = this.entity(object);
      if (object.kind === "vector" && this.isBody(this.get(object.parentId))) (entity as ForceEntity).translateEnd(dx, dy);
      else entity.translate(dx, dy);
      if (object.kind === "frame") {
        for (const child of this.descendants(object.id)) this.entity(child).translate(dx, dy);
      } else if (["block", "ball"].includes(object.kind)) {
        for (const force of this.forcesFor(object.id)) this.entity(force).translate(dx, dy);
      }
    }
  }

  inside(bounds: Bounds, frameId?: string) {
    return this.objects.filter((object) => {
      if (object.kind === "frame" || (frameId && !this.belongsToFrame(object, frameId))) return false;
      const box = this.entity(object).bounds();
      return box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;
    });
  }

  validateForces() {
    const bodies = new Set(this.objects.filter((object) => ["block", "ball"].includes(object.kind)).map((object) => object.id));
    this.objects = this.objects.filter((object) => object.kind !== "vector" || Boolean(object.parentId && bodies.has(object.parentId)));
    return this.objects;
  }
}
