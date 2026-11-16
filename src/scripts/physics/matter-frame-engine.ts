import Matter from "matter-js";
import type { BoardObject } from "./model";

const value = (input: number | undefined, fallback = 0) => Number.isFinite(input) ? input as number : fallback;

export class MatterFrameEngine {
  private readonly engine = Matter.Engine.create();
  private readonly bodies = new Map<string, Matter.Body>();
  private readonly lastPositions = new Map<string, { x: number; y: number }>();

  constructor(private readonly frame: BoardObject, private readonly objects: BoardObject[], gravity: boolean) {
    this.engine.gravity.y = gravity ? 1 : 0;
    this.engine.gravity.scale = 0.001;
    this.buildWorld();
  }

  private buildWorld() {
    const frameX = value(this.frame.x), frameY = value(this.frame.y), width = value(this.frame.w, 720), height = value(this.frame.h, 460);
    const walls = [
      Matter.Bodies.rectangle(frameX, frameY - height / 2, width, 20, { isStatic: true }),
      Matter.Bodies.rectangle(frameX, frameY + height / 2, width, 20, { isStatic: true }),
      Matter.Bodies.rectangle(frameX - width / 2, frameY, 20, height, { isStatic: true }),
      Matter.Bodies.rectangle(frameX + width / 2, frameY, 20, height, { isStatic: true }),
    ];
    Matter.Composite.add(this.engine.world, walls);

    for (const object of this.objects) {
      if (object.parentId !== this.frame.id) continue;
      if (object.kind === "block" || object.kind === "ball") {
        const options = { friction: 0.25, restitution: 0.15 };
        const body = object.kind === "ball"
          ? Matter.Bodies.circle(value(object.x), value(object.y), value(object.r, 58), options)
          : Matter.Bodies.rectangle(value(object.x), value(object.y), value(object.w, 170), value(object.h, 105), options);
        if (object.kind === "block") Matter.Body.setAngle(body, value(object.angle) * Math.PI / 180);
        Matter.Body.setMass(body, Math.max(value(object.mass, 1), 0.1));
        this.bodies.set(object.id, body);
        this.lastPositions.set(object.id, { x: body.position.x, y: body.position.y });
        Matter.Composite.add(this.engine.world, body);
      }
      if (object.kind === "surface") {
        const surface = Matter.Bodies.rectangle(value(object.x), value(object.y), value(object.w, 330), 16, {
          isStatic: true,
          angle: value(object.angle) * Math.PI / 180,
          friction: Math.max(value(object.friction), 0),
        });
        Matter.Composite.add(this.engine.world, surface);
      }
    }

    for (const spring of this.objects.filter((object) => object.kind === "spring" && object.parentId === this.frame.id)) {
      const end = { x: value(spring.x2), y: value(spring.y2) };
      const target = [...this.bodies.values()].sort((a, b) => Matter.Vector.magnitude(Matter.Vector.sub(a.position, end)) - Matter.Vector.magnitude(Matter.Vector.sub(b.position, end)))[0];
      if (!target || Matter.Vector.magnitude(Matter.Vector.sub(target.position, end)) > 100) continue;
      const anchor = { x: value(spring.x1), y: value(spring.y1) };
      const constraint = Matter.Constraint.create({
        pointA: anchor,
        bodyB: target,
        length: Math.hypot(end.x - anchor.x, end.y - anchor.y),
        stiffness: Math.min(Math.max(value(spring.stiffness, 20) / 100, 0.02), 1),
        damping: 0.05,
      });
      Matter.Composite.add(this.engine.world, constraint);
    }
  }

  step(deltaMs: number) {
    for (const [id, body] of this.bodies) {
      for (const force of this.objects.filter((object) => object.kind === "vector" && object.parentId === id)) {
        const dx = value(force.x2) - value(force.x1), dy = value(force.y2) - value(force.y1), length = Math.hypot(dx, dy) || 1;
        const magnitude = Math.min(Math.max(value(force.force), 0), 1_000_000) * 0.000005;
        Matter.Body.applyForce(body, body.position, { x: dx / length * magnitude, y: dy / length * magnitude });
      }
    }
    Matter.Engine.update(this.engine, Math.min(deltaMs, 34));
  }

  sync() {
    const moved: Array<{ object: BoardObject; dx: number; dy: number }> = [];
    for (const object of this.objects) {
      const body = this.bodies.get(object.id);
      if (!body) continue;
      const previous = this.lastPositions.get(object.id) || body.position;
      const dx = body.position.x - previous.x, dy = body.position.y - previous.y;
      object.x = body.position.x;
      object.y = body.position.y;
      if (object.kind === "block") object.angle = body.angle * 180 / Math.PI;
      object.velocity = { x: body.velocity.x, y: body.velocity.y };
      this.lastPositions.set(object.id, { x: body.position.x, y: body.position.y });
      moved.push({ object, dx, dy });
    }
    return moved;
  }
}
