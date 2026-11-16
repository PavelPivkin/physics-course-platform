type Point = { x: number; y: number };
type ObjectKind = "frame" | "block" | "ball" | "pulley" | "vector" | "rope" | "path" | "formula" | "text" | "surface" | "spring" | "dipole" | "atom" | "orbit" | "container";

type BoardObject = {
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

const app = document.querySelector<HTMLElement>("[data-board-app]")!;
const svg = document.querySelector<SVGSVGElement>("[data-physics-canvas]")!;
const boardLayer = document.querySelector<SVGGElement>("[data-board-layer]")!;
const previewLayer = document.querySelector<SVGGElement>("[data-preview-layer]")!;
const cursorLayer = document.querySelector<SVGGElement>("[data-cursor-layer]")!;

if (!app || !svg || !boardLayer || !previewLayer || !cursorLayer) {
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
let selectedId: string | null = null;
let activeTool = "select";
let activeForce = "Fтяж";
let pointerStart: Point | null = null;
let draftObject: BoardObject | null = null;
let dragOriginal: BoardObject | null = null;
let dragMoved = false;
let undoStack: string[] = [];
let future: string[] = [];
let toastTimer = 0;
let remoteCursor: Point | null = null;
let lastCursorSent = 0;
let viewBox = { x: 0, y: 0, width: 1600, height: 900 };
let sharedPointer: Point | null = null;
let simulating = false;
let simulationFrame = 0;
let simulationLast = 0;
let simulationSnapshot = "";
let selectedHandle: "end" | "resize" | null = null;
let forceUnit = 1;

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
    const text = button.dataset.formula || "F = ma";
    commit(() => {
      objects.push({
        id: createId(),
        kind: "formula",
        x: 690 + (index % 2) * 80,
        y: 260 + (index % 4) * 70,
        color: index % 2 ? "#639bf2" : "#ff401c",
        text,
      });
    });
    selectedId = objects.at(-1)?.id || null;
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
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-object-color]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!selectedId) return;
    const color = button.dataset.objectColor || "#ff401c";
    commit(() => {
      const object = objects.find((item) => item.id === selectedId);
      if (object) object.color = safeColor(color);
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

svg.addEventListener("pointerdown", handlePointerDown);
svg.addEventListener("pointermove", handlePointerMove);
svg.addEventListener("pointerup", handlePointerUp);
svg.addEventListener("pointercancel", handlePointerUp);
svg.addEventListener("wheel", handleWheel, { passive: false });

document.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.zoom;
    if (action === "fit") viewBox = { x: 0, y: 0, width: 1600, height: 900 };
    else zoomAt({ x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 }, action === "in" ? 0.82 : 1.22);
    updateZoom();
  });
});

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.matches("input, textarea, [contenteditable='true']")) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") removeSelected();
  if (key === "v") setTool("select");
  if (key === "p") setTool("pen");
  if (key === "f") setTool("vector");
  if (key === "r") setTool("rope");
  if (key === "t") setTool("text");
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
  if (event.button !== 0) return;
  const point = toBoardPoint(event);
  pointerStart = point;
  svg.setPointerCapture(event.pointerId);

  const target = (event.target as Element).closest<SVGGElement>("[data-object-id]");
  const targetId = target?.dataset.objectId || null;
  const handle = (event.target as Element).closest<SVGElement>("[data-handle]")?.dataset.handle as "end" | "resize" | undefined;

  if (activeTool === "select") {
    selectedId = targetId;
    selectedHandle = handle || null;
    dragOriginal = targetId ? structuredClone(objects.find((item) => item.id === targetId) || null) : null;
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
    draftObject = { id: createId(), kind: "path", color: "#ffffff", points: [point] };
    objects.push(draftObject);
    selectedId = draftObject.id;
    render();
    return;
  }

  if (activeTool === "vector" || activeTool === "rope") {
    const start = activeTool === "vector" ? snapToBody(point) : point;
    draftObject = {
      id: createId(),
      kind: activeTool,
      color: "#639bf2",
      label: activeTool === "vector" ? activeForce : undefined,
      x1: start.x,
      y1: start.y,
      x2: point.x,
      y2: point.y,
      parentId: activeTool === "vector" ? nearestBody(start)?.id || frame.id : frame.id,
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
    setTool("select");
    render();
  }
}

function handlePointerMove(event: PointerEvent) {
  const point = toBoardPoint(event);
  sendCursor(point);
  if (activeTool === "pointer" && pointerStart) {
    sharedPointer = point;
    renderPointer();
    return;
  }
  if (!pointerStart) return;

  if (activeTool === "select" && selectedId && dragOriginal) {
    const dx = point.x - pointerStart.x;
    const dy = point.y - pointerStart.y;
    if (!dragMoved && Math.hypot(dx, dy) > 2) {
      pushHistory();
      dragMoved = true;
    }
    if (dragMoved) {
      const object = objects.find((item) => item.id === selectedId);
      if (object && selectedHandle === "end" && object.kind === "vector") {
        object.x2 = snap(point.x); object.y2 = snap(point.y); object.force = vectorForce({ x: finite(object.x1), y: finite(object.y1) }, { x: finite(object.x2), y: finite(object.y2) });
      } else if (object && selectedHandle === "resize" && ["block", "ball", "frame"].includes(object.kind)) {
        resizeObject(object, dragOriginal, point, event.shiftKey);
      } else if (object) moveObjectFrom(object, dragOriginal, dx, dy);
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
  if (!pointerStart) return;
  const point = toBoardPoint(event);

  if ((activeTool === "vector" || activeTool === "rope") && draftObject) {
    draftObject.x2 = point.x;
    draftObject.y2 = point.y;
    const length = Math.hypot((draftObject.x2 || 0) - (draftObject.x1 || 0), (draftObject.y2 || 0) - (draftObject.y1 || 0));
    if (length > 12) {
      pushHistory();
      objects.push(draftObject);
      selectedId = draftObject.id;
      saveAndSync();
    }
    draftObject = null;
    previewLayer.innerHTML = "";
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
  dragMoved = false;
  render();
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
}

function render() {
  boardLayer.innerHTML = objects.map((object) => renderObject(object)).join("");
  svg.dataset.tool = activeTool;
  updateInspector();
  renderPointer();
}

function renderPreview() {
  previewLayer.innerHTML = draftObject ? renderObject(draftObject, true) : "";
}

function renderObject(object: BoardObject, preview = false) {
  const selected = object.id === selectedId && !preview ? " is-selected" : "";
  const color = safeColor(object.color);
  const label = escapeHtml(object.label || "");
  const text = escapeHtml(object.text || "");
  const groupStart = `<g class="board-object${selected}" data-object-id="${escapeHtml(object.id)}">`;

  if (object.kind === "frame") {
    const x = finite(object.x), y = finite(object.y), w = finite(object.w, 720), h = finite(object.h, 460);
    return `${groupStart}<rect class="physics-frame" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="18"></rect><text class="frame-label" x="${x - w / 2 + 24}" y="${y - h / 2 + 38}">${label || "Физическая модель"}</text><rect class="selection-ring" x="${x - w / 2 - 8}" y="${y - h / 2 - 8}" width="${w + 16}" height="${h + 16}" rx="22"></rect>${selected ? `<circle class="resize-handle" data-handle="resize" cx="${x + w / 2}" cy="${y + h / 2}" r="10"></circle>` : ""}</g>`;
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
  if (selectionEmpty) selectionEmpty.hidden = Boolean(selected);
  if (selectionFields) selectionFields.hidden = !selected;
  if (labelInput && selected) labelInput.value = selected.kind === "formula" || selected.kind === "text" ? selected.text || "" : selected.label || "";
  if (properties) properties.innerHTML = selected ? inspectorFields(selected) : "";
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
}

function setTool(tool: string) {
  activeTool = tool;
  toolButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.tool === tool));
  svg.dataset.tool = tool;
}

function commit(change: () => void) {
  pushHistory();
  change();
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
  selectedId = null;
  saveAndSync();
  render();
}

function redo() {
  const state = future.pop();
  if (!state) return;
  undoStack.push(JSON.stringify(objects));
  objects = normalizeObjects(JSON.parse(state));
  selectedId = null;
  saveAndSync();
  render();
}

function removeSelected() {
  if (!selectedId) return;
  commit(() => {
    objects = objects.filter((item) => item.id !== selectedId);
    selectedId = null;
  });
}

function moveObjectFrom(object: BoardObject, original: BoardObject, dx: number, dy: number) {
  if (["frame", "block", "ball", "pulley", "formula", "text", "surface", "dipole", "atom", "orbit", "container"].includes(object.kind)) {
    const next = object.kind === "block" || object.kind === "ball" ? snapBodyToSurface(object, keepInFrame(object, { x: finite(original.x) + dx, y: finite(original.y) + dy })) : keepInFrame(object, { x: finite(original.x) + dx, y: finite(original.y) + dy });
    object.x = next.x; object.y = next.y;
    if (object.kind === "frame") moveFrameContents(object.id, next.x - finite(original.x), next.y - finite(original.y));
    if (["block", "ball", "pulley"].includes(object.kind)) {
      const actualDx = next.x - finite(original.x), actualDy = next.y - finite(original.y);
      objects.filter((item) => item.kind === "vector" && item.parentId === object.id).forEach((vector) => {
        vector.x1 = finite(vector.x1) + actualDx; vector.y1 = finite(vector.y1) + actualDy; vector.x2 = finite(vector.x2) + actualDx; vector.y2 = finite(vector.y2) + actualDy;
      });
    }
  } else if (["vector", "rope"].includes(object.kind)) {
    object.x1 = finite(original.x1) + dx;
    object.y1 = finite(original.y1) + dy;
    object.x2 = finite(original.x2) + dx;
    object.y2 = finite(original.y2) + dy;
  } else if (object.kind === "path") {
    object.points = (original.points || []).map((point) => ({ x: point.x + dx, y: point.y + dy }));
  }
}

function moveFrameContents(frameId: string, dx: number, dy: number) {
  for (const child of objects) {
    if (child.id === frameId || !belongsToFrame(child, frameId)) continue;
    if (["vector", "rope", "spring"].includes(child.kind)) {
      child.x1 = finite(child.x1) + dx; child.y1 = finite(child.y1) + dy;
      child.x2 = finite(child.x2) + dx; child.y2 = finite(child.y2) + dy;
    } else if (child.kind === "path") {
      child.points = (child.points || []).map((point) => ({ x: point.x + dx, y: point.y + dy }));
    } else {
      child.x = finite(child.x) + dx; child.y = finite(child.y) + dy;
    }
  }
}

function belongsToFrame(object: BoardObject, frameId: string) {
  let parentId = object.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    if (parentId === frameId) return true;
    seen.add(parentId);
    parentId = objects.find((item) => item.id === parentId)?.parentId;
  }
  return false;
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

function keepInFrame(object: BoardObject, point: Point) {
  const frame = objects.find((item) => item.id === object.parentId && item.kind === "frame");
  if (!frame) return point;
  const padding = object.kind === "ball" ? finite(object.r, 58) : Math.max(finite(object.w, 100), finite(object.h, 80)) / 2;
  return { x: clamp(point.x, finite(frame.x) - finite(frame.w, 720) / 2 + padding, finite(frame.x) + finite(frame.w, 720) / 2 - padding), y: clamp(point.y, finite(frame.y) - finite(frame.h, 460) / 2 + padding, finite(frame.y) + finite(frame.h, 460) / 2 - padding) };
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
  const local = activeTool === "pointer" && sharedPointer ? `<g class="shared-pointer" transform="translate(${sharedPointer.x} ${sharedPointer.y})"><path d="M0 0L5 26L12 17L22 16Z"></path><text x="20" y="34">указка</text></g>` : "";
  cursorLayer.innerHTML = `${local}${remoteCursor ? `<g class="remote-cursor" transform="translate(${remoteCursor.x} ${remoteCursor.y})"><path d="M0 0L4 22L10 15L18 14Z"></path><text x="16" y="30">ученик</text></g>` : ""}`;
}

function insertTemplate(template: string) {
  const frame = objects.find((item) => item.kind === "frame");
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
}

function renderTasks() {
  if (!taskResults) return;
  const query = taskSearch?.value.trim().toLowerCase() || "";
  taskResults.innerHTML = TASKS.filter((task) => `${task.title} ${task.topic}`.toLowerCase().includes(query)).map((task) => `<button type="button" data-task-id="${task.id}"><span>${task.topic}</span><strong>${task.title}</strong><small>${task.text}</small></button>`).join("") || "<p class=\"panel-hint\">Ничего не найдено.</p>";
}

function attachTask(taskId: string) {
  const task = TASKS.find((item) => item.id === taskId), frame = objects.find((item) => item.kind === "frame");
  if (!task || !frame) { showToast("Сначала добавьте фрейм для задачи"); return; }
  commit(() => objects.push({ id: createId(), kind: "text", color: "#ffffff", text: `(${task.title})`, x: finite(frame.x) - finite(frame.w, 720) / 2 + 40, y: finite(frame.y) - finite(frame.h, 460) / 2 + 80, parentId: frame.id }));
  tasksDialog?.close(); showToast("Задача прикреплена к фрейму");
}

function toBoardPoint(event: PointerEvent | WheelEvent): Point {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM()?.inverse();
  const transformed = matrix ? point.matrixTransform(matrix) : point;
  return { x: transformed.x, y: transformed.y };
}

function snapToBody(point: Point) {
  const body = nearestBody(point);
  return body ? { x: finite(body.x), y: finite(body.y) } : point;
}

function nearestBody(point: Point) {
  let best: BoardObject | undefined; let distance = 95;
  for (const object of objects) {
    if (!["block", "ball", "pulley"].includes(object.kind)) continue;
    const next = Math.hypot(finite(object.x) - point.x, finite(object.y) - point.y);
    if (next < distance) { best = object; distance = next; }
  }
  return best;
}

function toggleSimulation() {
  simulating = !simulating;
  if (simulating) {
    simulationSnapshot = JSON.stringify(objects);
    simulationLast = performance.now();
    setSimulationButtonText("❚❚ Пауза");
    if (simulationState) simulationState.textContent = "идёт";
    simulationFrame = requestAnimationFrame(stepSimulation);
  } else {
    cancelAnimationFrame(simulationFrame); setSimulationButtonText("▷ Продолжить");
    if (simulationState) simulationState.textContent = "пауза";
  }
}

function resetSimulation() {
  simulating = false; cancelAnimationFrame(simulationFrame);
  if (simulationSnapshot) objects = normalizeObjects(JSON.parse(simulationSnapshot));
  setSimulationButtonText("▷ Запустить");
  if (simulationState) simulationState.textContent = "пауза";
  render(); saveAndSync();
}

function setSimulationButtonText(text: string) {
  document.querySelectorAll<HTMLButtonElement>("[data-simulation='toggle']").forEach((button) => button.textContent = text);
}

function stepSimulation(now: number) {
  if (!simulating) return;
  const dt = Math.min((now - simulationLast) / 1000, .035); simulationLast = now;
  const activeFrame = objects.find((item) => item.id === selectedId && item.kind === "frame") || objects.find((item) => item.kind === "frame");
  if (!activeFrame) { resetSimulation(); return; }
  const bodies = objects.filter((item) => ["block", "ball"].includes(item.kind) && item.parentId === activeFrame.id);
  for (const body of bodies) {
    const mass = Math.max(finite(body.mass, 1), .1); let fx = 0, fy = gravityInput?.checked ? mass * 9.81 * 14 : 0;
    for (const vector of objects.filter((item) => item.kind === "vector" && item.parentId === body.id)) {
      const dx = finite(vector.x2) - finite(vector.x1), dy = finite(vector.y2) - finite(vector.y1), length = Math.hypot(dx, dy) || 1, force = finite(vector.force, vectorForce({ x: finite(vector.x1), y: finite(vector.y1) }, { x: finite(vector.x2), y: finite(vector.y2) }));
      fx += (dx / length) * force * 24; fy += (dy / length) * force * 24;
    }
    for (const spring of objects.filter((item) => item.kind === "spring" && item.parentId === activeFrame.id)) {
      const anchor = { x: finite(spring.x1), y: finite(spring.y1) }, end = { x: finite(spring.x2), y: finite(spring.y2) };
      if (Math.hypot(finite(body.x) - end.x, finite(body.y) - end.y) < 90) {
        const dx = finite(body.x) - anchor.x, dy = finite(body.y) - anchor.y, length = Math.hypot(dx, dy) || 1, rest = Math.hypot(end.x - anchor.x, end.y - anchor.y);
        const force = -finite(spring.stiffness, 20) * ((length - rest) / 32);
        fx += (dx / length) * force; fy += (dy / length) * force;
      }
    }
    const velocity = body.velocity || { x: 0, y: 0 }; velocity.x += (fx / mass) * dt; velocity.y += (fy / mass) * dt;
    const old = { x: finite(body.x), y: finite(body.y) }; const next = keepInFrame(body, { x: old.x + velocity.x * dt, y: old.y + velocity.y * dt });
    if (next.x !== old.x + velocity.x * dt) velocity.x *= -.35;
    if (next.y !== old.y + velocity.y * dt) velocity.y *= -.35;
    body.velocity = velocity; moveObjectFrom(body, body, next.x - old.x, next.y - old.y);
  }
  render();
  simulationFrame = requestAnimationFrame(stepSimulation);
}

function handleWheel(event: WheelEvent) {
  event.preventDefault();
  zoomAt(toBoardPoint(event), event.deltaY > 0 ? 1.1 : 0.9);
  updateZoom();
}

function zoomAt(center: Point, factor: number) {
  const nextWidth = clamp(viewBox.width * factor, 520, 2400);
  const nextHeight = nextWidth * 0.5625;
  const rx = (center.x - viewBox.x) / viewBox.width;
  const ry = (center.y - viewBox.y) / viewBox.height;
  viewBox = {
    x: center.x - nextWidth * rx,
    y: center.y - nextHeight * ry,
    width: nextWidth,
    height: nextHeight,
  };
}

function updateZoom() {
  svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  if (zoomOutput) zoomOutput.value = `${Math.round((1600 / viewBox.width) * 100)}%`;
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
    if (saved) return migrateBoard(normalizeObjects(JSON.parse(saved)));
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
    { id: createId(), kind: "vector", color: "#ff401c", label: "Fтяж", x1: 470, y1: 480, x2: 470, y2: 650, parentId: blockId, force: 5.3 },
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
      objects = normalizeObjects(message.objects);
      selectedId = null;
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
