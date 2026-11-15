type Point = { x: number; y: number };
type ObjectKind = "block" | "ball" | "pulley" | "vector" | "rope" | "path" | "formula" | "text";

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

  if (activeTool === "select") {
    selectedId = targetId;
    dragOriginal = targetId ? structuredClone(objects.find((item) => item.id === targetId) || null) : null;
    dragMoved = false;
    render();
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
      color: activeTool === "vector" ? "#ff401c" : "#639bf2",
      label: activeTool === "vector" ? activeForce : undefined,
      x1: start.x,
      y1: start.y,
      x2: point.x,
      y2: point.y,
    };
    renderPreview();
    return;
  }

  if (["block", "ball", "pulley", "text"].includes(activeTool)) {
    commit(() => {
      if (activeTool === "block") {
        objects.push({ id: createId(), kind: "block", color: "#639bf2", label: "m", x: point.x, y: point.y, w: 170, h: 105 });
      } else if (activeTool === "ball") {
        objects.push({ id: createId(), kind: "ball", color: "#639bf2", label: "m", x: point.x, y: point.y, r: 58 });
      } else if (activeTool === "pulley") {
        objects.push({ id: createId(), kind: "pulley", color: "#ff401c", label: "", x: point.x, y: point.y, r: 55 });
      } else {
        objects.push({ id: createId(), kind: "text", color: "#ffffff", text: "подпись", x: point.x, y: point.y });
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
      if (object) moveObjectFrom(object, dragOriginal, dx, dy);
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
    draftObject.x2 = point.x;
    draftObject.y2 = point.y;
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
  dragOriginal = null;
  dragMoved = false;
  render();
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
}

function render() {
  boardLayer.innerHTML = objects.map((object) => renderObject(object)).join("");
  svg.dataset.tool = activeTool;
  updateInspector();
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

  if (object.kind === "block") {
    const x = finite(object.x), y = finite(object.y), w = finite(object.w, 170), h = finite(object.h, 105);
    return `${groupStart}<rect class="selection-ring" x="${x - w / 2 - 12}" y="${y - h / 2 - 12}" width="${w + 24}" height="${h + 24}" rx="8"></rect><rect class="body-fill" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="7" style="stroke:${color}"></rect><circle class="body-center" cx="${x}" cy="${y}" r="6"></circle><text class="body-label" x="${x}" y="${y - 20}">${label}</text></g>`;
  }

  if (object.kind === "ball") {
    const x = finite(object.x), y = finite(object.y), r = finite(object.r, 58);
    return `${groupStart}<circle class="selection-ring" cx="${x}" cy="${y}" r="${r + 12}"></circle><circle class="body-fill" cx="${x}" cy="${y}" r="${r}" style="stroke:${color}"></circle><circle class="body-center" cx="${x}" cy="${y}" r="6"></circle><text class="body-label" x="${x}" y="${y - 20}">${label}</text></g>`;
  }

  if (object.kind === "pulley") {
    const x = finite(object.x), y = finite(object.y), r = finite(object.r, 55);
    return `${groupStart}<circle class="selection-ring" cx="${x}" cy="${y}" r="${r + 14}"></circle><path class="pulley-mount" d="M${x} ${y - r}V${y - r - 45}M${x - 24} ${y - r - 45}H${x + 24}" style="stroke:${color}"></path><circle class="pulley-outer" cx="${x}" cy="${y}" r="${r}" style="stroke:${color}"></circle><circle class="pulley-inner" cx="${x}" cy="${y}" r="${r * 0.38}" style="stroke:${color}"></circle></g>`;
  }

  if (object.kind === "vector" || object.kind === "rope") {
    const x1 = finite(object.x1), y1 = finite(object.y1), x2 = finite(object.x2), y2 = finite(object.y2);
    const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
    if (object.kind === "vector") {
      return `${groupStart}<line class="selection-ring" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line><line class="vector-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${color}"></line><text class="vector-label" x="${midX + 12}" y="${midY - 12}" style="fill:${color}">${label}</text></g>`;
    }
    return `${groupStart}<line class="selection-ring" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line><line class="rope-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${color}"></line></g>`;
  }

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
  if (["block", "ball", "pulley", "formula", "text"].includes(object.kind)) {
    object.x = finite(original.x) + dx;
    object.y = finite(original.y) + dy;
  } else if (["vector", "rope"].includes(object.kind)) {
    object.x1 = finite(original.x1) + dx;
    object.y1 = finite(original.y1) + dy;
    object.x2 = finite(original.x2) + dx;
    object.y2 = finite(original.y2) + dy;
  } else if (object.kind === "path") {
    object.points = (original.points || []).map((point) => ({ x: point.x + dx, y: point.y + dy }));
  }
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
  let best = point;
  let distance = 95;
  for (const object of objects) {
    if (!["block", "ball", "pulley"].includes(object.kind)) continue;
    const next = Math.hypot(finite(object.x) - point.x, finite(object.y) - point.y);
    if (next < distance) {
      best = { x: finite(object.x), y: finite(object.y) };
      distance = next;
    }
  }
  return best;
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
    if (saved) return normalizeObjects(JSON.parse(saved));
  } catch {}
  return demoObjects();
}

function demoObjects(): BoardObject[] {
  return [
    { id: createId(), kind: "block", color: "#639bf2", label: "m", x: 470, y: 480, w: 190, h: 115 },
    { id: createId(), kind: "vector", color: "#ff401c", label: "Fтяж", x1: 470, y1: 480, x2: 470, y2: 650 },
    { id: createId(), kind: "vector", color: "#639bf2", label: "N", x1: 470, y1: 480, x2: 470, y2: 320 },
    { id: createId(), kind: "pulley", color: "#ff401c", x: 1030, y: 280, r: 58 },
    { id: createId(), kind: "ball", color: "#639bf2", label: "m₂", x: 1030, y: 570, r: 52 },
    { id: createId(), kind: "rope", color: "#639bf2", x1: 1030, y1: 338, x2: 1030, y2: 518 },
    { id: createId(), kind: "formula", color: "#ff401c", text: "F = ma", x: 700, y: 210 },
    { id: createId(), kind: "text", color: "#ffffff", text: "Схема сил", x: 320, y: 235 },
  ];
}

function normalizeObjects(value: unknown): BoardObject[] {
  if (!Array.isArray(value)) return [];
  const kinds = new Set<ObjectKind>(["block", "ball", "pulley", "vector", "rope", "path", "formula", "text"]);
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
  if (!remoteCursor) {
    cursorLayer.innerHTML = "";
    return;
  }
  cursorLayer.innerHTML = `<g class="remote-cursor" transform="translate(${remoteCursor.x} ${remoteCursor.y})"><path d="M0 0L4 22L10 15L18 14Z"></path><text x="16" y="30">ученик</text></g>`;
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
