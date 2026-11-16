import { KonvaBoardRenderer } from "./physics/konva-board-renderer";
import { MatterFrameEngine } from "./physics/matter-frame-engine";
import { PhysicsScene, type BoardObject, type Bounds, type ObjectKind, type Point } from "./physics/model";

const app = document.querySelector<HTMLElement>("[data-board-app]")!;
const canvas = document.querySelector<HTMLDivElement>("[data-physics-canvas]")!;

if (!app || !canvas) {
  throw new Error("Physics board root is missing");
}

const toolButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-tool]")];
const selectionEmpty = document.querySelector<HTMLElement>("[data-selection-empty]");
const selectionFields = document.querySelector<HTMLElement>("[data-selection-fields]");
const labelInput = document.querySelector<HTMLInputElement>("[data-object-label]");
const toast = document.querySelector<HTMLElement>("[data-board-toast]");
const zoomOutput = document.querySelector<HTMLOutputElement>("[data-zoom-value]");
const statusPill = document.querySelector<HTMLElement>("[data-connection-status]");
const dialog = document.querySelector<HTMLDialogElement>("[data-collaboration-dialog]");
const signalInput = document.querySelector<HTMLInputElement>("[data-signal-url]");
const dialogStatus = document.querySelector<HTMLElement>("[data-dialog-status]");
const shareResult = document.querySelector<HTMLElement>("[data-share-result]");
const shareInput = document.querySelector<HTMLInputElement>("[data-share-link]");
const properties = document.querySelector<HTMLElement>("[data-object-properties]");
const tasksDialog = document.querySelector<HTMLDialogElement>("[data-tasks-dialog]");
const taskSearch = document.querySelector<HTMLInputElement>("[data-task-search]");
const taskResults = document.querySelector<HTMLElement>("[data-task-results]");
const forceScale = document.querySelector<HTMLSelectElement>("[data-force-scale]");
const simulationState = document.querySelector<HTMLElement>("[data-simulation-state]");
const gravityInput = document.querySelector<HTMLInputElement>("[data-gravity]");

const COLORS = new Set(["#ff401c", "#639bf2", "#0b1e33", "#ffffff"]);
const STORAGE_KEY = "physics-board-v1";
const params = new URLSearchParams(window.location.search);

let objects: BoardObject[] = loadBoard();
let scene = new PhysicsScene(objects);
let selectedId: string | null = null;
let selectedIds = new Set<string>();
let activeTool = "select";
let activeForce = "Fтяж";
let pointerStart: Point | null = null;
let draftObject: BoardObject | null = null;
let dragOriginal: BoardObject | null = null;
let dragSceneOriginal: BoardObject[] | null = null;
let dragMoved = false;
let selectionBox: { start: Point; end: Point } | null = null;
let undoStack: string[] = [];
let future: string[] = [];
let toastTimer = 0;
let remoteCursor: Point | null = null;
let lastCursorSent = 0;
let sharedPointer: Point | null = null;
let simulating = false;
let simulationFrame = 0;
let simulationLast = 0;
let simulationSnapshot = "";
let simulatingFrameId: string | null = null;
let matterEngine: MatterFrameEngine | null = null;
let selectedHandle: "end" | "resize" | null = null;
let forceUnit = 1;
let spacePressed = false;
let cameraDrag: { pointerId: number; x: number; y: number } | null = null;
const touchPoints = new Map<number, { x: number; y: number }>();
let pinchDistance = 0;
let pinchCenter: Point | null = null;
const renderer = new KonvaBoardRenderer(canvas);

const TASKS = [
  { id: "oge-03", title: "ОГЭ №3 · Невесомость", topic: "Механика", text: "Пакет с водой падает: какие силы действуют на воду?" },
  { id: "oge-05", title: "ОГЭ №5 · Сила Архимеда", topic: "Статика", text: "Сравните показания динамометра в двух жидкостях." },
  { id: "oge-07", title: "ОГЭ №7 · Равновесие рычага", topic: "Моменты сил", text: "Подберите положение груза для равновесия." },
  { id: "oge-17", title: "ОГЭ №17 · Закон Ома", topic: "Электричество", text: "Исследуйте зависимость силы тока от напряжения." },
];

let socket: WebSocket | null = null;
let peer: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
let roomId = params.get("room") || "";
let peerRole: "host" | "guest" | "" = "";

const savedSignal = params.get("signal");
if (signalInput) {
  signalInput.value = savedSignal || (isLocalHost() ? `ws://${window.location.hostname}:8787` : "");
}

render();
setTool("select");
updateZoom();

if (roomId && signalInput?.value) {
  window.setTimeout(() => connectToRoom(roomId), 350);
}

toolButtons.forEach((button) => {
  button.addEventListener("click", () => setTool(button.dataset.tool || "select"));
});

document.querySelectorAll<HTMLButtonElement>("[data-force]").forEach((button) => {
  button.addEventListener("click", () => {
    activeForce = button.dataset.force || "F";
    document.querySelectorAll("[data-force]").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    setTool("vector");
    showToast(`Сила ${activeForce}: протяните стрелку от тела`);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-formula]").forEach((button, index) => {
  button.addEventListener("click", () => {
    const frame = selectedFrame() || objects.find((object) => object.kind === "frame");
    if (!frame) { showToast("Сначала создайте физический фрейм"); return; }
    const text = button.dataset.formula || "F = ma";
    commit(() => {
      objects.push({
        id: createId(),
        kind: "formula",
        x: finite(frame.x) + (index % 2) * 80,
        y: finite(frame.y) - 120 + (index % 4) * 70,
        color: index % 2 ? "#639bf2" : "#ff401c",
        text,
        parentId: frame.id,
      });
    });
    selectedId = objects.at(-1)?.id || null;
    selectedIds = new Set(selectedId ? [selectedId] : []);
    setTool("select");
    render();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "undo") undo();
    if (action === "redo") redo();
    if (action === "delete") removeSelected();
    if (action === "clear") clearBoard();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-object-color]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!selectedIds.size) return;
    const color = button.dataset.objectColor || "#ff401c";
    commit(() => {
      objects.filter((item) => selectedIds.has(item.id)).forEach((object) => object.color = safeColor(color));
    });
  });
});

labelInput?.addEventListener("change", () => {
  if (!selectedId) return;
  commit(() => {
    const object = objects.find((item) => item.id === selectedId);
    if (!object) return;
    if (object.kind === "formula" || object.kind === "text") object.text = labelInput.value.slice(0, 80);
    else object.label = labelInput.value.slice(0, 24);
  });
});

forceScale?.addEventListener("change", () => {
  forceUnit = Number(forceScale.value) || 1;
  render();
});

document.querySelectorAll<HTMLButtonElement>("[data-template]").forEach((button) => {
  button.addEventListener("click", () => insertTemplate(button.dataset.template || ""));
});

document.querySelector("[data-open-tasks]")?.addEventListener("click", () => {
  renderTasks();
  tasksDialog?.showModal();
});
taskSearch?.addEventListener("input", renderTasks);
taskResults?.addEventListener("click", (event) => {
  const task = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-task-id]");
  if (task) attachTask(task.dataset.taskId || "");
});

document.querySelectorAll<HTMLButtonElement>("[data-simulation]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.simulation === "toggle") toggleSimulation();
    else resetSimulation();
  });
});

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerUp);
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  renderer.zoomAt(Math.exp(-event.deltaY * .0015), event.clientX, event.clientY);
  updateZoom();
}, { passive: false });

document.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.zoom;
    if (action === "fit") renderer.resetCamera();
    else renderer.zoomAt(action === "in" ? 1.22 : 0.82);
    updateZoom();
  });
});

document.querySelector<HTMLButtonElement>("[data-theme-toggle]")?.addEventListener("click", () => queueMicrotask(render));

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.matches("input, textarea, [contenteditable='true']")) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && key === "a") {
    event.preventDefault();
    selectedIds = new Set(objects.filter((object) => object.kind !== "frame").map((object) => object.id));
    selectedId = [...selectedIds].at(-1) || null;
    render();
    return;
  }
  if (event.code === "Space") { event.preventDefault(); spacePressed = true; }
  if (event.key === "Delete" || event.key === "Backspace") removeSelected();
  if (key === "v") setTool("select");
  if (key === "h") setTool("pan");
  if (key === "p") setTool("pen");
  if (key === "f") setTool("vector");
  if (key === "r") setTool("rope");
  if (key === "t") setTool("text");
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Space") spacePressed = false;
});

document.querySelector("[data-open-collaboration]")?.addEventListener("click", () => dialog?.showModal());
document.querySelector("[data-create-room]")?.addEventListener("click", () => {
  roomId = createRoomId();
  connectToRoom(roomId, true);
});
document.querySelector("[data-connect-room]")?.addEventListener("click", () => {
  roomId = roomId || params.get("room") || "";
  if (!roomId) {
    setDialogStatus("В ссылке нет идентификатора комнаты. Попросите преподавателя прислать приглашение.", true);
    return;
  }
  connectToRoom(roomId);
});
document.querySelector("[data-copy-link]")?.addEventListener("click", copyShareLink);

function handlePointerDown(event: PointerEvent) {
  if (event.pointerType === "touch") {
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.size === 2) {
      const [a, b] = [...touchPoints.values()];
      pinchDistance = Math.hypot(b.x - a.x, b.y - a.y);
      pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pointerStart = null;
      selectionBox = null;
      draftObject = null;
      render();
      return;
    }
  }
  if (activeTool === "pan" || spacePressed || event.button === 1) {
    cameraDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (event.button !== 0) return;
  const point = toBoardPoint(event);
  pointerStart = point;
  canvas.setPointerCapture(event.pointerId);

  const hit = renderer.hitAt(event.clientX, event.clientY);
  const targetId = hit.objectId;
  const frameAction = hit.frameSimulate;
  const handle = hit.handle || undefined;

  if (frameAction) {
    selectedId = frameAction;
    selectedIds = new Set([frameAction]);
    toggleSimulation(frameAction);
    pointerStart = null;
    return;
  }

  if (activeTool === "select") {
    if (event.shiftKey && targetId) {
      if (selectedIds.has(targetId)) selectedIds.delete(targetId);
      else selectedIds.add(targetId);
      selectedId = selectedIds.has(targetId) ? targetId : [...selectedIds].at(-1) || null;
    } else if (targetId && selectedIds.has(targetId)) {
      selectedId = targetId;
    } else {
      selectedIds = new Set(targetId ? [targetId] : []);
      selectedId = targetId;
    }
    selectedHandle = handle || null;
    dragOriginal = targetId ? structuredClone(objects.find((item) => item.id === targetId) || null) : null;
    dragSceneOriginal = structuredClone(objects);
    if (!targetId) selectionBox = { start: point, end: point };
    dragMoved = false;
    render();
    return;
  }

  if (activeTool === "pointer") {
    sharedPointer = point;
    renderPointer();
    sendCursor(point);
    return;
  }

  if (activeTool === "frame") {
    commit(() => objects.push({ id: createId(), kind: "frame", color: "#639bf2", label: "Физическая модель", x: point.x, y: point.y, w: 720, h: 460 }));
    selectedId = objects.at(-1)?.id || null;
    selectedIds = new Set(selectedId ? [selectedId] : []);
    setTool("select");
    render();
    return;
  }

  const frame = frameAt(point);
  if (!frame) {
    showToast("Сначала добавьте физический фрейм: тела и схемы живут внутри него");
    return;
  }

  if (activeTool === "pen") {
    pushHistory();
    draftObject = { id: createId(), kind: "path", color: "#ffffff", points: [point], parentId: frame.id };
    objects.push(draftObject);
    selectedId = draftObject.id;
    selectedIds = new Set([draftObject.id]);
    render();
    return;
  }

  if (activeTool === "vector" || activeTool === "rope") {
    const body = activeTool === "vector" ? nearestBody(point, frame.id) : undefined;
    if (activeTool === "vector" && !body) {
      pointerStart = null;
      showToast("Сила должна начинаться на теле внутри фрейма");
      return;
    }
    const start = body ? { x: finite(body.x), y: finite(body.y) } : point;
    draftObject = {
      id: createId(),
      kind: activeTool,
      color: activeTool === "vector" ? "#ff401c" : "#639bf2",
      label: activeTool === "vector" ? activeForce : undefined,
      x1: start.x,
      y1: start.y,
      x2: point.x,
      y2: point.y,
      parentId: body?.id || frame.id,
      force: activeTool === "vector" ? vectorForce(start, point) : undefined,
    };
    renderPreview();
    return;
  }

  if (["block", "ball", "pulley", "text", "surface", "spring"].includes(activeTool)) {
    commit(() => {
      if (activeTool === "block") {
        objects.push({ id: createId(), kind: "block", color: "#639bf2", label: "m", x: point.x, y: point.y, w: 170, h: 105, parentId: frame.id, mass: 1, velocity: { x: 0, y: 0 } });
      } else if (activeTool === "ball") {
        objects.push({ id: createId(), kind: "ball", color: "#639bf2", label: "m", x: point.x, y: point.y, r: 58, parentId: frame.id, mass: 1, velocity: { x: 0, y: 0 } });
      } else if (activeTool === "pulley") {
        objects.push({ id: createId(), kind: "pulley", color: "#ff401c", label: "", x: point.x, y: point.y, r: 55, parentId: frame.id });
      } else if (activeTool === "surface") {
        objects.push({ id: createId(), kind: "surface", color: "#ffffff", x: point.x, y: point.y, w: 330, angle: 0, friction: 0, parentId: frame.id });
      } else if (activeTool === "spring") {
        objects.push({ id: createId(), kind: "spring", color: "#ff401c", x1: point.x, y1: point.y, x2: point.x + 180, y2: point.y, stiffness: 20, parentId: frame.id });
      } else {
        objects.push({ id: createId(), kind: "text", color: "#ffffff", text: "подпись", x: point.x, y: point.y, parentId: frame.id });
      }
    });
    selectedId = objects.at(-1)?.id || null;
    selectedIds = new Set(selectedId ? [selectedId] : []);
    setTool("select");
    render();
  }
}

function handlePointerMove(event: PointerEvent) {
  if (event.pointerType === "touch" && touchPoints.has(event.pointerId)) {
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.size >= 2) {
      const [a, b] = [...touchPoints.values()];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchCenter) renderer.panBy(center.x - pinchCenter.x, center.y - pinchCenter.y);
      if (pinchDistance > 0) renderer.zoomAt(distance / pinchDistance, center.x, center.y);
      pinchDistance = distance;
      pinchCenter = center;
      updateZoom();
      return;
    }
  }
  if (cameraDrag?.pointerId === event.pointerId) {
    renderer.panBy(event.clientX - cameraDrag.x, event.clientY - cameraDrag.y);
    cameraDrag.x = event.clientX;
    cameraDrag.y = event.clientY;
    updateZoom();
    return;
  }
  const point = toBoardPoint(event);
  sendCursor(point);
  if (activeTool === "pointer" && pointerStart) {
    sharedPointer = point;
    renderPointer();
    return;
  }
  if (!pointerStart) return;

  if (activeTool === "select" && selectionBox && !selectedId) {
    selectionBox.end = point;
    renderSelectionBox();
    return;
  }

  if (activeTool === "select" && selectedId && dragOriginal && dragSceneOriginal) {
    const dx = point.x - pointerStart.x;
    const dy = point.y - pointerStart.y;
    if (!dragMoved && Math.hypot(dx, dy) > 2) {
      pushHistory();
      dragMoved = true;
    }
    if (dragMoved) {
      objects = structuredClone(dragSceneOriginal);
      scene = new PhysicsScene(objects);
      const object = objects.find((item) => item.id === selectedId);
      if (object && selectedHandle === "end" && object.kind === "vector") {
        object.x2 = snap(point.x); object.y2 = snap(point.y); object.force = vectorForce({ x: finite(object.x1), y: finite(object.y1) }, { x: finite(object.x2), y: finite(object.y2) });
      } else if (object && selectedHandle === "resize" && ["block", "ball", "frame"].includes(object.kind)) {
        resizeObject(object, dragOriginal, point, event.shiftKey);
      } else if (object) {
        scene.translate(topLevelSelection(), dx, dy);
        constrainSelectedEntities();
      }
      render();
      sendBoardState();
    }
    return;
  }

  if (activeTool === "pen" && draftObject?.points) {
    const previous = draftObject.points.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 3) {
      draftObject.points.push(point);
      render();
    }
    return;
  }

  if ((activeTool === "vector" || activeTool === "rope") && draftObject) {
    draftObject.x2 = snap(point.x);
    draftObject.y2 = snap(point.y);
    draftObject.force = draftObject.kind === "vector" ? vectorForce({ x: finite(draftObject.x1), y: finite(draftObject.y1) }, { x: finite(draftObject.x2), y: finite(draftObject.y2) }) : undefined;
    renderPreview();
  }
}

function handlePointerUp(event: PointerEvent) {
  touchPoints.delete(event.pointerId);
  if (touchPoints.size < 2) { pinchDistance = 0; pinchCenter = null; }
  if (cameraDrag?.pointerId === event.pointerId) {
    cameraDrag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    return;
  }
  if (!pointerStart) return;
  const point = toBoardPoint(event);

  if (activeTool === "select" && selectionBox && !selectedId) {
    const bounds = normalizedBounds(selectionBox.start, selectionBox.end);
    if (Math.hypot(selectionBox.end.x - selectionBox.start.x, selectionBox.end.y - selectionBox.start.y) > 8) {
      selectedIds = new Set(scene.inside(bounds).map((object) => object.id));
      selectedId = [...selectedIds].at(-1) || null;
    }
    selectionBox = null;
  } else if ((activeTool === "vector" || activeTool === "rope") && draftObject) {
    draftObject.x2 = point.x;
    draftObject.y2 = point.y;
    const length = Math.hypot((draftObject.x2 || 0) - (draftObject.x1 || 0), (draftObject.y2 || 0) - (draftObject.y1 || 0));
    if (length > 12) {
      pushHistory();
      objects.push(draftObject);
      selectedId = draftObject.id;
      selectedIds = new Set([draftObject.id]);
      saveAndSync();
    }
    draftObject = null;
    setTool("select");
  } else if (activeTool === "pen" && draftObject) {
    draftObject = null;
    saveAndSync();
  } else if (activeTool === "select" && dragMoved) {
    saveAndSync();
  }

  pointerStart = null;
  selectedHandle = null;
  dragOriginal = null;
  dragSceneOriginal = null;
  dragMoved = false;
  render();
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

function render() {
  anchorForces();
  renderer.render({
    objects,
    selectedIds,
    draftObject,
    selectionBox,
    localCursor: activeTool === "pointer" ? sharedPointer : null,
    remoteCursor,
    simulatingFrameId: simulating ? simulatingFrameId : null,
  });
  renderer.setTool(activeTool);
  updateInspector();
}

function anchorForces() {
  for (const force of objects.filter((object) => object.kind === "vector")) {
    const body = scene.get(force.parentId);
    if (!scene.isBody(body)) continue;
    force.x1 = finite(body.x);
    force.y1 = finite(body.y);
  }
}

function renderSelectionBox() {
  render();
}

function normalizedBounds(a: Point, b: Point): Bounds {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

function topLevelSelection() {
  return [...selectedIds].filter((id) => {
    const object = scene.get(id);
    if (!object?.parentId) return true;
    return !selectedIds.has(object.parentId) && ![...selectedIds].some((selected) => scene.get(selected)?.kind === "frame" && scene.belongsToFrame(object, selected));
  });
}

function constrainSelectedEntities() {
  for (const id of topLevelSelection()) {
    const object = scene.get(id);
    const frame = scene.frameOf(object);
    if (!object || !frame || object.kind === "frame") continue;
    const frameBounds = scene.entity(frame).bounds();
    const entity = scene.entity(object);
    if (object.kind === "vector") {
      object.x2 = clamp(finite(object.x2), frameBounds.left + 12, frameBounds.right - 12);
      object.y2 = clamp(finite(object.y2), frameBounds.top + 54, frameBounds.bottom - 12);
      continue;
    }
    const bounds = entity.bounds();
    let dx = 0, dy = 0;
    if (bounds.left < frameBounds.left) dx = frameBounds.left - bounds.left;
    if (bounds.right > frameBounds.right) dx = frameBounds.right - bounds.right;
    if (bounds.top < frameBounds.top + 48) dy = frameBounds.top + 48 - bounds.top;
    if (bounds.bottom > frameBounds.bottom) dy = frameBounds.bottom - bounds.bottom;
    if (dx || dy) {
      entity.translate(dx, dy);
      if (["block", "ball"].includes(object.kind)) for (const force of scene.forcesFor(object.id)) scene.entity(force).translate(dx, dy);
    }
    if (["block", "ball"].includes(object.kind)) {
      const before = { x: finite(object.x), y: finite(object.y) };
      const next = snapBodyToSurface(object, before);
      const snapDx = next.x - before.x, snapDy = next.y - before.y;
      object.x = next.x; object.y = next.y;
      for (const force of scene.forcesFor(object.id)) scene.entity(force).translate(snapDx, snapDy);
    }
  }
}

function renderPreview() {
  render();
}

function renderObject(object: BoardObject, preview = false) {
  const selected = selectedIds.has(object.id) && !preview ? " is-selected" : "";
  const color = safeColor(object.color);
  const label = escapeHtml(object.label || "");
  const text = escapeHtml(object.text || "");
  const groupStart = `<g class="board-object${selected}" data-object-id="${escapeHtml(object.id)}">`;

  if (object.kind === "frame") {
    const x = finite(object.x), y = finite(object.y), w = finite(object.w, 720), h = finite(object.h, 460);
    const running = simulatingFrameId === object.id && simulating;
    return `${groupStart}<rect class="physics-frame" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="18"></rect><text class="frame-label" x="${x - w / 2 + 24}" y="${y - h / 2 + 38}">${label || "Физическая модель"}</text><g class="frame-simulation-button${running ? " is-running" : ""}" data-frame-simulate="${object.id}" transform="translate(${x + w / 2 - 54} ${y - h / 2 + 14})"><rect width="40" height="30" rx="7"></rect><text x="20" y="21">${running ? "Ⅱ" : "▶"}</text></g><rect class="selection-ring" x="${x - w / 2 - 8}" y="${y - h / 2 - 8}" width="${w + 16}" height="${h + 16}" rx="22"></rect>${selected ? `<circle class="resize-handle" data-handle="resize" cx="${x + w / 2}" cy="${y + h / 2}" r="10"></circle>` : ""}</g>`;
  }

  if (object.kind === "block") {
    const x = finite(object.x), y = finite(object.y), w = finite(object.w, 170), h = finite(object.h, 105);
    return `${groupStart}<rect class="selection-ring" x="${x - w / 2 - 12}" y="${y - h / 2 - 12}" width="${w + 24}" height="${h + 24}" rx="8"></rect><rect class="body-fill" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="7" style="stroke:${color}"></rect><circle class="body-center" cx="${x}" cy="${y}" r="6"></circle><text class="body-label" x="${x}" y="${y - 20}">${label}</text>${selected ? `<circle class="resize-handle" data-handle="resize" cx="${x + w / 2}" cy="${y + h / 2}" r="9"></circle>` : ""}</g>`;
  }

  if (object.kind === "ball") {
    const x = finite(object.x), y = finite(object.y), r = finite(object.r, 58);
    return `${groupStart}<circle class="selection-ring" cx="${x}" cy="${y}" r="${r + 12}"></circle><circle class="body-fill" cx="${x}" cy="${y}" r="${r}" style="stroke:${color}"></circle><circle class="body-center" cx="${x}" cy="${y}" r="6"></circle><text class="body-label" x="${x}" y="${y - 20}">${label}</text>${selected ? `<circle class="resize-handle" data-handle="resize" cx="${x + r * .72}" cy="${y + r * .72}" r="9"></circle>` : ""}</g>`;
  }

  if (object.kind === "pulley") {
    const x = finite(object.x), y = finite(object.y), r = finite(object.r, 55);
    return `${groupStart}<circle class="selection-ring" cx="${x}" cy="${y}" r="${r + 14}"></circle><path class="pulley-mount" d="M${x} ${y - r}V${y - r - 45}M${x - 24} ${y - r - 45}H${x + 24}" style="stroke:${color}"></path><circle class="pulley-outer" cx="${x}" cy="${y}" r="${r}" style="stroke:${color}"></circle><circle class="pulley-inner" cx="${x}" cy="${y}" r="${r * 0.38}" style="stroke:${color}"></circle></g>`;
  }

  if (object.kind === "vector" || object.kind === "rope") {
    const x1 = finite(object.x1), y1 = finite(object.y1), x2 = finite(object.x2), y2 = finite(object.y2);
    const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
    if (object.kind === "vector") {
      return `${groupStart}<line class="selection-ring" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line><line class="vector-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${color}"></line><text class="vector-label" x="${midX + 12}" y="${midY - 12}" style="fill:${color}">${label} ${formatForce(object.force)}</text>${selected ? `<circle class="vector-handle" data-handle="end" cx="${x2}" cy="${y2}" r="10"></circle>` : ""}</g>`;
    }
    return `${groupStart}<line class="selection-ring" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line><line class="rope-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${color}"></line></g>`;
  }

  if (object.kind === "surface") {
    const x = finite(object.x), y = finite(object.y), w = finite(object.w, 330), angle = finite(object.angle);
    const rough = finite(object.friction) > 0;
    return `${groupStart}<g transform="rotate(${angle} ${x} ${y})"><line class="surface-line" x1="${x - w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y}" style="stroke:${color}"></line>${rough ? Array.from({ length: 14 }, (_, i) => `<line class="surface-hatch" x1="${x - w / 2 + i * (w / 13)}" y1="${y}" x2="${x - w / 2 + i * (w / 13) - 10}" y2="${y + 12}"></line>`).join("") : ""}</g><text class="object-caption" x="${x}" y="${y - 18}">μ = ${finite(object.friction).toFixed(2)}</text></g>`;
  }

  if (object.kind === "spring") {
    const x1 = finite(object.x1), y1 = finite(object.y1), x2 = finite(object.x2), y2 = finite(object.y2);
    return `${groupStart}<path class="spring-line" d="${springPath(x1, y1, x2, y2)}" style="stroke:${color}"></path><text class="object-caption" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 18}">k = ${finite(object.stiffness, 20)} Н/м</text></g>`;
  }

  if (object.kind === "dipole") return `${groupStart}<circle class="charge-positive" cx="${finite(object.x) - 42}" cy="${finite(object.y)}" r="30"></circle><circle class="charge-negative" cx="${finite(object.x) + 42}" cy="${finite(object.y)}" r="30"></circle><text class="charge-text" x="${finite(object.x) - 42}" y="${finite(object.y) + 8}">+</text><text class="charge-text" x="${finite(object.x) + 42}" y="${finite(object.y) + 8}">−</text></g>`;
  if (object.kind === "atom") return renderAtom(object, groupStart);
  if (object.kind === "orbit") return renderOrbit(object, groupStart);
  if (object.kind === "container") return renderContainer(object, groupStart);

  if (object.kind === "path") {
    const points = (object.points || []).map((point) => `${finite(point.x)},${finite(point.y)}`).join(" ");
    return `${groupStart}<polyline class="selection-ring" points="${points}"></polyline><polyline class="pen-path" points="${points}" style="stroke:${color}"></polyline></g>`;
  }

  const x = finite(object.x), y = finite(object.y);
  const className = object.kind === "formula" ? "formula-label" : "text-label";
  return `${groupStart}<rect class="selection-ring" x="${x - 16}" y="${y - 50}" width="${Math.max(90, text.length * (object.kind === "formula" ? 26 : 15))}" height="70" rx="5"></rect><text class="${className}" x="${x}" y="${y}" style="fill:${color}">${text}</text></g>`;
}

function updateInspector() {
  const selected = objects.find((item) => item.id === selectedId);
  const multiple = selectedIds.size > 1;
  if (selectionEmpty) {
    selectionEmpty.hidden = Boolean(selected) && !multiple;
    selectionEmpty.textContent = multiple ? `Выбрано объектов: ${selectedIds.size}. Перетащите любой из них, чтобы переместить группу.` : "Выберите объект, чтобы изменить подпись и цвет.";
  }
  if (selectionFields) selectionFields.hidden = !selected || multiple;
  if (labelInput && selected) labelInput.value = selected.kind === "formula" || selected.kind === "text" ? selected.text || "" : selected.label || "";
  if (properties) properties.innerHTML = selected && !multiple ? inspectorFields(selected) : "";
  properties?.querySelectorAll<HTMLInputElement>("[data-property]").forEach((input) => input.addEventListener("change", () => {
    if (!selectedId) return;
    commit(() => {
      const object = objects.find((item) => item.id === selectedId);
      if (!object) return;
      const property = input.dataset.property as keyof BoardObject;
      const number = Number(input.value);
      if (Number.isFinite(number)) (object as Record<string, unknown>)[property] = number;
    });
  }));
  const frame = selectedFrame();
  if (simulationState) simulationState.textContent = simulatingFrameId === frame?.id && simulating ? "идёт" : frame ? "готов" : "выберите фрейм";
  setSimulationButtonText(simulatingFrameId === frame?.id && simulating ? "❚❚ Пауза" : "▷ Запустить выбранный");
}

function selectedFrame() {
  return scene.frameOf(scene.get(selectedId));
}

function setTool(tool: string) {
  activeTool = tool;
  toolButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.tool === tool));
  renderer.setTool(tool);
}

function commit(change: () => void) {
  pushHistory();
  change();
  scene = new PhysicsScene(objects);
  saveAndSync();
  render();
}

function pushHistory() {
  undoStack.push(JSON.stringify(objects));
  if (undoStack.length > 80) undoStack.shift();
  future = [];
}

function undo() {
  const state = undoStack.pop();
  if (!state) return;
  future.push(JSON.stringify(objects));
  objects = normalizeObjects(JSON.parse(state));
  scene = new PhysicsScene(objects);
  selectedId = null;
  selectedIds.clear();
  saveAndSync();
  render();
}

function redo() {
  const state = future.pop();
  if (!state) return;
  undoStack.push(JSON.stringify(objects));
  objects = normalizeObjects(JSON.parse(state));
  scene = new PhysicsScene(objects);
  selectedId = null;
  selectedIds.clear();
  saveAndSync();
  render();
}

function removeSelected() {
  if (!selectedIds.size) return;
  commit(() => {
    objects = scene.remove(selectedIds);
    selectedId = null;
    selectedIds.clear();
  });
}

function clearBoard() {
  if (!objects.length) return;
  commit(() => {
    objects = [];
    selectedId = null;
    selectedIds.clear();
    stopSimulation(false);
  });
  showToast("Доска очищена. Отменить можно через Ctrl/⌘ + Z");
}

function inspectorFields(object: BoardObject) {
  const fields: [string, string, number, number, number][] = [];
  if (["block", "ball"].includes(object.kind)) fields.push(["Масса, кг", "mass", finite(object.mass, 1), 0.1, 100]);
  if (object.kind === "surface") fields.push(["Трение μ", "friction", finite(object.friction), 0, 2], ["Угол, °", "angle", finite(object.angle), -75, 75]);
  if (object.kind === "spring") fields.push(["Жёсткость k, Н/м", "stiffness", finite(object.stiffness, 20), 1, 300]);
  if (object.kind === "container") fields.push(["Температура, °C", "temperature", finite(object.temperature, 20), -50, 200]);
  if (object.kind === "atom") fields.push(["Протоны", "protons", finite(object.protons, 1), 1, 118], ["Нейтроны", "neutrons", finite(object.neutrons, 0), 0, 180], ["Электроны", "electrons", finite(object.electrons, 1), 0, 118]);
  return fields.map(([label, property, value, min, max]) => `<label class="property-field"><span>${label}</span><input data-property="${property}" type="number" step="${property === "friction" ? "0.05" : "1"}" min="${min}" max="${max}" value="${value}" /></label>`).join("");
}

function resizeObject(object: BoardObject, original: BoardObject, point: Point, proportion: boolean) {
  const dx = Math.abs(point.x - finite(original.x)) * 2;
  const dy = Math.abs(point.y - finite(original.y)) * 2;
  if (object.kind === "ball") object.r = clamp(Math.max(dx, dy) / 2, 18, 180);
  else {
    const ratio = finite(original.w, 1) / Math.max(finite(original.h, 1), 1);
    object.w = clamp(dx, 100, 1300); object.h = clamp(proportion ? object.w / ratio : dy, 70, 900);
  }
}

function frameAt(point: Point) {
  return objects.find((object) => object.kind === "frame" && Math.abs(point.x - finite(object.x)) < finite(object.w, 720) / 2 && Math.abs(point.y - finite(object.y)) < finite(object.h, 460) / 2);
}

function snapBodyToSurface(body: BoardObject, point: Point) {
  const surface = objects.find((item) => item.kind === "surface" && item.parentId === body.parentId && Math.abs(finite(item.angle)) < 3 && point.x >= finite(item.x) - finite(item.w, 330) / 2 && point.x <= finite(item.x) + finite(item.w, 330) / 2 && Math.abs(point.y - finite(item.y)) < 72);
  if (!surface) return point;
  const half = body.kind === "ball" ? finite(body.r, 58) : finite(body.h, 105) / 2;
  return { x: point.x, y: finite(surface.y) - half - 3 };
}

function snap(value: number) { return Math.round(value / 12) * 12; }
function vectorForce(start: Point, end: Point) { return Math.round((Math.hypot(end.x - start.x, end.y - start.y) / 32) * forceUnit * 10) / 10; }
function formatForce(force?: number) { return force ? `· ${force >= 1000000 ? `${force / 1000000} МН` : force >= 1000 ? `${force / 1000} кН` : `${force} Н`}` : ""; }

function springPath(x1: number, y1: number, x2: number, y2: number) {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / length, uy = (y2 - y1) / length, px = -uy, py = ux;
  const points = [{ x: x1, y: y1 }, ...Array.from({ length: 10 }, (_, i) => ({ x: x1 + ux * (20 + i * ((length - 40) / 9)) + px * (i % 2 ? 14 : -14), y: y1 + uy * (20 + i * ((length - 40) / 9)) + py * (i % 2 ? 14 : -14) })), { x: x2, y: y2 }];
  return `M${points.map((point) => `${point.x} ${point.y}`).join("L")}`;
}

function renderAtom(object: BoardObject, groupStart: string) {
  const x = finite(object.x), y = finite(object.y), p = finite(object.protons, 1), n = finite(object.neutrons), e = finite(object.electrons, p);
  return `${groupStart}<circle class="atom-orbit" cx="${x}" cy="${y}" r="58"></circle><circle class="atom-nucleus" cx="${x}" cy="${y}" r="24"></circle>${Array.from({ length: Math.min(e, 8) }, (_, i) => `<circle class="electron" cx="${x + 58 * Math.cos((i / Math.max(e, 1)) * Math.PI * 2)}" cy="${y + 58 * Math.sin((i / Math.max(e, 1)) * Math.PI * 2)}" r="5"></circle>`).join("")}<text class="atom-label" x="${x}" y="${y + 100}">Z=${p}, A=${p + n}, q=${p - e}</text></g>`;
}
function renderOrbit(object: BoardObject, groupStart: string) {
  const x = finite(object.x), y = finite(object.y);
  return `${groupStart}<circle class="sun" cx="${x}" cy="${y}" r="24"></circle><circle class="atom-orbit" cx="${x}" cy="${y}" r="96"></circle><circle class="planet" cx="${x + 96}" cy="${y}" r="13"></circle><path class="vector-line" d="M${x + 54} ${y - 68}A96 96 0 0 1 ${x + 110} ${y - 12}" style="stroke:#ff401c"></path><text class="object-caption" x="${x}" y="${y + 130}">движение по окружности</text></g>`;
}
function renderContainer(object: BoardObject, groupStart: string) {
  const x = finite(object.x), y = finite(object.y), w = finite(object.w, 280), h = finite(object.h, 170), temp = finite(object.temperature, 20);
  const hot = clamp((temp + 20) / 120, 0, 1), color = `rgb(${Math.round(70 + hot * 185)} ${Math.round(145 - hot * 85)} ${Math.round(242 - hot * 190)})`;
  return `${groupStart}<rect class="container-box" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="14"></rect>${Array.from({ length: 18 }, (_, i) => `<circle cx="${x - w / 2 + 22 + (i * 47) % (w - 40)}" cy="${y - h / 2 + 24 + (i * 31) % (h - 45)}" r="${4 + (i % 3)}" fill="${color}" opacity=".8"></circle>`).join("")}<text class="object-caption" x="${x}" y="${y + h / 2 + 25}">T = ${temp} °C · тепловая модель</text></g>`;
}

function renderPointer() {
  render();
}

function insertTemplate(template: string) {
  const frame = selectedFrame() || objects.find((item) => item.kind === "frame");
  if (!frame) { showToast("Создайте физический фрейм, затем добавьте схему"); return; }
  const x = finite(frame.x), y = finite(frame.y);
  const presets: Record<string, Partial<BoardObject>[]> = {
    "rough-surface": [{ kind: "surface", color: "#ffffff", x, y: y + 120, w: 380, friction: .3, angle: 0 }],
    incline: [{ kind: "surface", color: "#ffffff", x, y: y + 120, w: 380, friction: 0, angle: -25 }],
    "movable-pulley": [{ kind: "pulley", color: "#ff401c", x, y, r: 48 }, { kind: "rope", color: "#639bf2", x1: x - 120, y1: y - 120, x2: x + 120, y2: y - 120 }],
    dipole: [{ kind: "dipole", color: "#639bf2", x, y }],
    "two-bodies": [{ kind: "block", color: "#639bf2", label: "m₁", x: x - 120, y, w: 120, h: 80, mass: 1, velocity: { x: 0, y: 0 } }, { kind: "block", color: "#639bf2", label: "m₂", x: x + 120, y, w: 120, h: 80, mass: 1, velocity: { x: 0, y: 0 } }],
    atom: [{ kind: "atom", color: "#639bf2", x, y, protons: 6, neutrons: 6, electrons: 6 }],
    orbit: [{ kind: "orbit", color: "#639bf2", x, y }],
    container: [{ kind: "container", color: "#639bf2", x, y, w: 300, h: 180, temperature: 20 }],
  };
  commit(() => (presets[template] || []).forEach((preset) => objects.push({ id: createId(), color: "#ffffff", parentId: frame.id, ...preset } as BoardObject)));
  selectedId = objects.at(-1)?.id || null;
  selectedIds = new Set(selectedId ? [selectedId] : []);
}

function renderTasks() {
  if (!taskResults) return;
  const query = taskSearch?.value.trim().toLowerCase() || "";
  taskResults.innerHTML = TASKS.filter((task) => `${task.title} ${task.topic}`.toLowerCase().includes(query)).map((task) => `<button type="button" data-task-id="${task.id}"><span>${task.topic}</span><strong>${task.title}</strong><small>${task.text}</small></button>`).join("") || "<p class=\"panel-hint\">Ничего не найдено.</p>";
}

function attachTask(taskId: string) {
  const task = TASKS.find((item) => item.id === taskId), frame = selectedFrame() || objects.find((item) => item.kind === "frame");
  if (!task || !frame) { showToast("Сначала добавьте фрейм для задачи"); return; }
  commit(() => objects.push({ id: createId(), kind: "text", color: "#ffffff", text: `(${task.title})`, x: finite(frame.x) - finite(frame.w, 720) / 2 + 40, y: finite(frame.y) - finite(frame.h, 460) / 2 + 80, parentId: frame.id }));
  tasksDialog?.close(); showToast("Задача прикреплена к фрейму");
}

function toBoardPoint(event: PointerEvent | WheelEvent): Point {
  return renderer.toWorldPoint(event.clientX, event.clientY);
}

function nearestBody(point: Point, frameId: string) {
  let best: BoardObject | undefined; let distance = 95;
  for (const object of objects) {
    if (!["block", "ball"].includes(object.kind) || object.parentId !== frameId) continue;
    const next = Math.hypot(finite(object.x) - point.x, finite(object.y) - point.y);
    if (next < distance) { best = object; distance = next; }
  }
  return best;
}

function toggleSimulation(frameId = selectedFrame()?.id) {
  const frame = scene.get(frameId);
  if (!frame || frame.kind !== "frame") {
    showToast("Выберите конкретный фрейм или тело внутри него");
    return;
  }
  if (simulating && simulatingFrameId === frame.id) {
    stopSimulation(false);
    setSimulationButtonText("▷ Продолжить");
    render();
    return;
  }
  if (simulating) stopSimulation(false);
  selectedId = frame.id;
  selectedIds = new Set([frame.id]);
  simulating = true;
  simulatingFrameId = frame.id;
  simulationSnapshot = JSON.stringify(objects);
  simulationLast = performance.now();
  matterEngine = new MatterFrameEngine(frame, objects, Boolean(gravityInput?.checked));
  setSimulationButtonText("❚❚ Пауза");
  if (simulationState) simulationState.textContent = "идёт";
  simulationFrame = requestAnimationFrame(stepSimulation);
  render();
}

function stopSimulation(reset: boolean) {
  simulating = false;
  cancelAnimationFrame(simulationFrame);
  matterEngine = null;
  if (reset && simulationSnapshot) {
    objects = normalizeObjects(JSON.parse(simulationSnapshot));
    scene = new PhysicsScene(objects);
  }
  simulatingFrameId = null;
}

function resetSimulation() {
  stopSimulation(true);
  setSimulationButtonText("▷ Запустить");
  if (simulationState) simulationState.textContent = selectedFrame() ? "готов" : "выберите фрейм";
  render(); saveAndSync();
}

function setSimulationButtonText(text: string) {
  document.querySelectorAll<HTMLButtonElement>("[data-simulation='toggle']").forEach((button) => button.textContent = text);
}

function stepSimulation(now: number) {
  if (!simulating || !matterEngine || !simulatingFrameId) return;
  matterEngine.step(now - simulationLast);
  simulationLast = now;
  for (const moved of matterEngine.sync()) {
    for (const force of scene.forcesFor(moved.object.id)) scene.entity(force).translate(moved.dx, moved.dy);
  }
  render();
  simulationFrame = requestAnimationFrame(stepSimulation);
}

function updateZoom() {
  if (zoomOutput) zoomOutput.value = `${Math.round(renderer.scale * 100)}%`;
}

function saveAndSync() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(objects));
  } catch {}
  sendBoardState();
}

function loadBoard() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const migrated = migrateBoard(normalizeObjects(JSON.parse(saved)));
      return new PhysicsScene(migrated).validateForces();
    }
  } catch {}
  return demoObjects();
}

function migrateBoard(saved: BoardObject[]) {
  if (!saved.length || saved.some((object) => object.kind === "frame")) return saved;
  const frameId = createId();
  const frame: BoardObject = { id: frameId, kind: "frame", color: "#639bf2", label: "Физическая модель", x: 800, y: 450, w: 1460, h: 800 };
  const bodies = saved.filter((object) => ["block", "ball", "pulley"].includes(object.kind));
  saved.forEach((object) => {
    if (object.kind === "vector") object.parentId = nearestInList(bodies, { x: finite(object.x1), y: finite(object.y1) })?.id || frameId;
    else object.parentId = frameId;
  });
  return [frame, ...saved];
}

function nearestInList(list: BoardObject[], point: Point) {
  return list.reduce<BoardObject | undefined>((closest, item) => !closest || Math.hypot(finite(item.x) - point.x, finite(item.y) - point.y) < Math.hypot(finite(closest.x) - point.x, finite(closest.y) - point.y) ? item : closest, undefined);
}

function demoObjects(): BoardObject[] {
  const frameId = createId();
  const blockId = createId();
  return [
    { id: frameId, kind: "frame", color: "#639bf2", label: "Схема сил", x: 800, y: 470, w: 1220, h: 650 },
    { id: blockId, kind: "block", color: "#639bf2", label: "m", x: 470, y: 480, w: 190, h: 115, parentId: frameId, mass: 1, velocity: { x: 0, y: 0 } },
    { id: createId(), kind: "vector", color: "#639bf2", label: "Fтяж", x1: 470, y1: 480, x2: 470, y2: 650, parentId: blockId, force: 5.3 },
    { id: createId(), kind: "vector", color: "#639bf2", label: "N", x1: 470, y1: 480, x2: 470, y2: 320, parentId: blockId, force: 5 },
    { id: createId(), kind: "surface", color: "#ffffff", x: 470, y: 600, w: 350, friction: .2, parentId: frameId },
    { id: createId(), kind: "pulley", color: "#ff401c", x: 1030, y: 280, r: 58, parentId: frameId },
    { id: createId(), kind: "ball", color: "#639bf2", label: "m₂", x: 1030, y: 570, r: 52, parentId: frameId, mass: 1, velocity: { x: 0, y: 0 } },
    { id: createId(), kind: "rope", color: "#639bf2", x1: 1030, y1: 338, x2: 1030, y2: 518, parentId: frameId },
    { id: createId(), kind: "formula", color: "#ff401c", text: "F = ma", x: 700, y: 210, parentId: frameId },
  ];
}

function normalizeObjects(value: unknown): BoardObject[] {
  if (!Array.isArray(value)) return [];
  const kinds = new Set<ObjectKind>(["frame", "block", "ball", "pulley", "vector", "rope", "path", "formula", "text", "surface", "spring", "dipole", "atom", "orbit", "container"]);
  return value.slice(0, 500).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const source = raw as Record<string, unknown>;
    if (!kinds.has(source.kind as ObjectKind)) return [];
    const object: BoardObject = {
      id: typeof source.id === "string" ? source.id.slice(0, 64) : createId(),
      kind: source.kind as ObjectKind,
      color: safeColor(typeof source.color === "string" ? source.color : "#ffffff"),
      label: typeof source.label === "string" ? source.label.slice(0, 24) : undefined,
      text: typeof source.text === "string" ? source.text.slice(0, 80) : undefined,
      x: numberOrUndefined(source.x), y: numberOrUndefined(source.y), w: numberOrUndefined(source.w), h: numberOrUndefined(source.h), r: numberOrUndefined(source.r),
      x1: numberOrUndefined(source.x1), y1: numberOrUndefined(source.y1), x2: numberOrUndefined(source.x2), y2: numberOrUndefined(source.y2),
      parentId: typeof source.parentId === "string" ? source.parentId.slice(0, 64) : undefined,
      force: numberOrUndefined(source.force), mass: numberOrUndefined(source.mass), friction: numberOrUndefined(source.friction), angle: numberOrUndefined(source.angle), stiffness: numberOrUndefined(source.stiffness), temperature: numberOrUndefined(source.temperature), protons: numberOrUndefined(source.protons), neutrons: numberOrUndefined(source.neutrons), electrons: numberOrUndefined(source.electrons),
    };
    if (source.velocity && typeof source.velocity === "object") {
      const velocity = source.velocity as Record<string, unknown>;
      if (typeof velocity.x === "number" && typeof velocity.y === "number") object.velocity = { x: finite(velocity.x), y: finite(velocity.y) };
    }
    if (Array.isArray(source.points)) {
      object.points = source.points.slice(0, 4000).flatMap((point) => {
        if (!point || typeof point !== "object") return [];
        const next = point as Record<string, unknown>;
        return typeof next.x === "number" && typeof next.y === "number" ? [{ x: finite(next.x), y: finite(next.y) }] : [];
      });
    }
    return [object];
  });
}

function connectToRoom(room: string, creating = false) {
  const signalUrl = signalInput?.value.trim() || "";
  if (!signalUrl || !/^wss?:\/\//i.test(signalUrl)) {
    setDialogStatus("Укажите адрес signaling-сервера в формате ws:// или wss://.", true);
    dialog?.showModal();
    return;
  }

  disconnect();
  setConnectionStatus("waiting", "Подключение");
  setDialogStatus("Соединяемся с signaling-сервером…");

  try {
    socket = new WebSocket(signalUrl);
  } catch {
    setDialogStatus("Не удалось открыть WebSocket. Проверьте адрес сервера.", true);
    setConnectionStatus("error", "Ошибка");
    return;
  }

  socket.addEventListener("open", () => {
    socket?.send(JSON.stringify({ type: "join", room }));
    setDialogStatus("Комната создана. Ждём второго участника…");
    if (creating) exposeShareLink(room, signalUrl);
  });

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "joined") {
      peerRole = message.role;
      setConnectionStatus("waiting", peerRole === "host" ? "Ждём ученика" : "Подключаемся");
    }
    if (message.type === "ready") {
      await preparePeer(message.role === "host");
    }
    if (message.type === "signal") await acceptSignal(message.data);
    if (message.type === "peer-left") {
      setConnectionStatus("waiting", "Ученик вышел");
      remoteCursor = null;
      renderRemoteCursor();
    }
    if (message.type === "error") {
      setDialogStatus(message.message || "Ошибка signaling-сервера", true);
      setConnectionStatus("error", "Ошибка");
    }
  });

  socket.addEventListener("error", () => {
    setDialogStatus("Signaling-сервер недоступен. Запустите npm run signal или укажите публичный WSS-адрес.", true);
    setConnectionStatus("error", "Нет сервера");
  });
}

async function preparePeer(isHost: boolean) {
  if (peer) return;
  peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) sendSignal({ candidate: event.candidate });
  });
  peer.addEventListener("connectionstatechange", () => {
    if (peer?.connectionState === "connected") {
      setConnectionStatus("online", "Ученик на доске");
      setDialogStatus("Соединение установлено. Доска синхронизируется напрямую.");
      window.setTimeout(() => dialog?.close(), 650);
    } else if (["failed", "disconnected", "closed"].includes(peer?.connectionState || "")) {
      setConnectionStatus("error", "Связь потеряна");
    }
  });
  peer.addEventListener("datachannel", (event) => setupDataChannel(event.channel));

  if (isHost) {
    setupDataChannel(peer.createDataChannel("physics-board", { ordered: true }));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendSignal({ description: peer.localDescription });
  }
}

async function acceptSignal(data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
  if (!peer) await preparePeer(false);
  if (!peer) return;
  if (data.description) {
    await peer.setRemoteDescription(data.description);
    if (data.description.type === "offer") {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendSignal({ description: peer.localDescription });
    }
  }
  if (data.candidate) {
    try { await peer.addIceCandidate(data.candidate); } catch {}
  }
}

function setupDataChannel(next: RTCDataChannel) {
  channel = next;
  channel.addEventListener("open", () => {
    setConnectionStatus("online", "Ученик на доске");
    if (peerRole === "host") sendBoardState();
  });
  channel.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.type === "state") {
      objects = new PhysicsScene(normalizeObjects(message.objects)).validateForces();
      scene = new PhysicsScene(objects);
      selectedId = null;
      selectedIds.clear();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(objects)); } catch {}
      render();
    }
    if (message.type === "cursor" && Number.isFinite(message.x) && Number.isFinite(message.y)) {
      remoteCursor = { x: message.x, y: message.y };
      renderRemoteCursor();
    }
  });
}

function sendSignal(data: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "signal", data }));
}

function sendBoardState() {
  if (channel?.readyState === "open") channel.send(JSON.stringify({ type: "state", objects }));
}

function sendCursor(point: Point) {
  if (channel?.readyState !== "open") return;
  const now = performance.now();
  if (now - lastCursorSent < 45) return;
  lastCursorSent = now;
  channel.send(JSON.stringify({ type: "cursor", x: point.x, y: point.y }));
}

function renderRemoteCursor() {
  renderPointer();
}

function exposeShareLink(room: string, signalUrl: string) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", room);
  url.searchParams.set("signal", signalUrl);
  if (shareInput) shareInput.value = url.toString();
  if (shareResult) shareResult.hidden = false;
  window.history.replaceState({}, "", url);
}

async function copyShareLink() {
  if (!shareInput?.value) return;
  try {
    await navigator.clipboard.writeText(shareInput.value);
  } catch {
    shareInput.select();
    showToast("Ссылка выделена — скопируйте её вручную");
    return;
  }
  showToast("Ссылка скопирована");
}

function disconnect() {
  channel?.close();
  peer?.close();
  socket?.close();
  channel = null;
  peer = null;
  socket = null;
}

function setConnectionStatus(state: "offline" | "waiting" | "online" | "error", text: string) {
  if (!statusPill) return;
  statusPill.dataset.state = state;
  statusPill.innerHTML = `<span></span>${escapeHtml(text)}`;
}

function setDialogStatus(text: string, isError = false) {
  if (!dialogStatus) return;
  dialogStatus.textContent = text;
  dialogStatus.style.color = isError ? "var(--orange-text)" : "";
}

function showToast(message: string) {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function createId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createRoomId() {
  return (crypto.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 10);
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

function safeColor(value: string) {
  return COLORS.has(value.toLowerCase()) ? value.toLowerCase() : "#ffffff";
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, -5000, 5000) : fallback;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? finite(value) : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
