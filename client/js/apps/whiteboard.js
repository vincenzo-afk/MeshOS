/**
 * Whiteboard
 * Shared drawing surface synced over the "main" data channel. Every
 * completed stroke/shape/note is stored as a small op object; the canvas
 * is fully redrawn from the ops list, which keeps every peer trivially
 * consistent and makes undo/redo just a matter of add/remove-and-redraw.
 * Anyone who already has a non-empty board pushes it to a peer the moment
 * that peer's data channel opens, so joining mid-session shows the
 * current board instead of a blank one.
 */
import { getIcon } from '../utils/icons.js';
import { clamp, uid, downloadBlob } from '../utils/helpers.js';

const COLORS = ['#FFFFFF', '#FF5C5C', '#FFD93D', '#4FD1C5', '#6C8CFF', '#B892FF', '#000000'];
const TOOLS = [
  { id: 'pen', icon: 'pen' }, { id: 'eraser', icon: 'eraser' }, { id: 'rect', icon: 'shape' },
  { id: 'circle', icon: 'zoomIn' }, { id: 'arrow', icon: 'arrow' }, { id: 'sticky', icon: 'sticky' },
  { id: 'text', icon: 'text' }, { id: 'image', icon: 'image' },
];
const MAX_IMAGE_DIMENSION = 900; // downscaled before ever becoming a dataURL, keeps synced payloads small

let ops = [];
const myUndoStack = [];
let wired = false;
const renderers = new Set(); // canvas redraw functions per open window

function sanitizeOpForWire(op) {
  const sanitized = {};
  for (const k of Object.keys(op)) {
    if (k !== '_img') sanitized[k] = op[k];
  }
  return sanitized;
}

function hydrateImageOp(op, onLoaded) {
  if (op.tool !== 'image' || !op.dataUrl || op._img) return;
  const img = new Image();
  img.onload = onLoaded;
  img.src = op.dataUrl;
  op._img = img;
}

function wire(ctx) {
  if (wired) return;
  wired = true;
  ctx.peerManager.on('message', (peerId, label, msg) => {
    if (label !== 'main' || !String(msg.type || '').startsWith('wb:')) return;
    if (msg.type === 'wb:add') {
      const op = msg.op;
      hydrateImageOp(op, redrawAll);
      ops.push(op);
      redrawAll();
    } else if (msg.type === 'wb:remove') {
      ops = ops.filter((o) => o.id !== msg.opId);
      redrawAll();
    } else if (msg.type === 'wb:clear') {
      ops = [];
      redrawAll();
    } else if (msg.type === 'wb:sync') {
      // Only adopt a sync if we don't already have a board of our own —
      // otherwise two peers who both drew something before connecting
      // could wipe each other's work depending on message arrival order.
      if (ops.length === 0 && Array.isArray(msg.ops) && msg.ops.length > 0) {
        ops = msg.ops;
        ops.forEach((op) => hydrateImageOp(op, redrawAll));
        redrawAll();
      }
    }
  });

  // Catch up anyone who joins after the board already has content.
  ctx.peerManager.on('channel-open', (peerId, label) => {
    if (label !== 'main' || ops.length === 0) return;
    ctx.peerManager.sendJSON(peerId, { type: 'wb:sync', ops: ops.map(sanitizeOpForWire) });
  });
}

function redrawAll() { renderers.forEach((r) => r()); }

/** Downscales an image file to at most MAX_IMAGE_DIMENSION per side before
 *  it's ever turned into a dataURL, so a full-resolution photo doesn't
 *  blow up the synced message size (and every other peer's memory). */
function loadAndDownscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        off.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = off.toDataURL('image/jpeg', 0.82);
        const finalImg = new Image();
        finalImg.onload = () => resolve({ dataUrl, img: finalImg, w, h });
        finalImg.src = dataUrl;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function mount(body, win, ctx) {
  wire(ctx);
  body.innerHTML = `
    <div class="wb-shell">
      <div class="wb-toolbar-v" id="wb-tools">
        ${TOOLS.map((t) => `<button class="wb-tool" data-tool="${t.id}" title="${t.id}">${getIcon(t.icon, 17)}</button>`).join('')}
        <div class="wb-colors" id="wb-colors">${COLORS.map((c) => `<div class="wb-color" data-color="${c}" style="background:${c};"></div>`).join('')}</div>
        <div style="flex:1;"></div>
        <button class="wb-tool" id="wb-undo" title="Undo">${getIcon('undo', 16)}</button>
        <button class="wb-tool" id="wb-clear" title="Clear board">${getIcon('trash', 16)}</button>
        <button class="wb-tool" id="wb-export" title="Export PNG">${getIcon('download', 16)}</button>
      </div>
      <div class="wb-canvas-wrap" id="wb-wrap">
        <canvas id="wb-canvas"></canvas>
        <div class="wb-zoom-hud glass" id="wb-zoom">100%</div>
      </div>
      <input type="file" id="wb-image-input" accept="image/*" style="display:none;" />
    </div>`;

  const wrap = body.querySelector('#wb-wrap');
  const canvas = body.querySelector('#wb-canvas');
  const cctx = canvas.getContext('2d');
  const zoomHud = body.querySelector('#wb-zoom');
  const imageInput = body.querySelector('#wb-image-input');

  let tool = 'pen';
  let color = COLORS[0];
  let width = 3;
  let view = { scale: 1, ox: 0, oy: 0 };
  let drawing = false;
  let currentOp = null;
  let spacePan = false;

  function resize() {
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    draw();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(wrap);

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - view.ox) / view.scale, y: (clientY - rect.top - view.oy) / view.scale };
  }

  function draw() {
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    cctx.fillStyle = '#12141c';
    cctx.fillRect(0, 0, canvas.width, canvas.height);
    cctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    for (const op of ops) drawOp(op);
    if (currentOp) drawOp(currentOp);
    zoomHud.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function drawOp(op) {
    cctx.lineJoin = 'round';
    cctx.lineCap = 'round';
    if (op.tool === 'pen' || op.tool === 'eraser') {
      cctx.strokeStyle = op.tool === 'eraser' ? '#12141c' : op.color;
      cctx.lineWidth = op.tool === 'eraser' ? op.width * 4 : op.width;
      cctx.beginPath();
      op.points.forEach((p, i) => (i === 0 ? cctx.moveTo(p.x, p.y) : cctx.lineTo(p.x, p.y)));
      cctx.stroke();
    } else if (op.tool === 'rect') {
      cctx.strokeStyle = op.color; cctx.lineWidth = op.width;
      cctx.strokeRect(Math.min(op.x1, op.x2), Math.min(op.y1, op.y2), Math.abs(op.x2 - op.x1), Math.abs(op.y2 - op.y1));
    } else if (op.tool === 'circle') {
      cctx.strokeStyle = op.color; cctx.lineWidth = op.width;
      const rx = Math.abs(op.x2 - op.x1) / 2, ry = Math.abs(op.y2 - op.y1) / 2;
      cctx.beginPath();
      cctx.ellipse((op.x1 + op.x2) / 2, (op.y1 + op.y2) / 2, rx, ry, 0, 0, Math.PI * 2);
      cctx.stroke();
    } else if (op.tool === 'arrow') {
      cctx.strokeStyle = op.color; cctx.fillStyle = op.color; cctx.lineWidth = op.width;
      cctx.beginPath(); cctx.moveTo(op.x1, op.y1); cctx.lineTo(op.x2, op.y2); cctx.stroke();
      const angle = Math.atan2(op.y2 - op.y1, op.x2 - op.x1);
      cctx.beginPath();
      cctx.moveTo(op.x2, op.y2);
      cctx.lineTo(op.x2 - 12 * Math.cos(angle - 0.4), op.y2 - 12 * Math.sin(angle - 0.4));
      cctx.lineTo(op.x2 - 12 * Math.cos(angle + 0.4), op.y2 - 12 * Math.sin(angle + 0.4));
      cctx.closePath(); cctx.fill();
    } else if (op.tool === 'sticky') {
      cctx.fillStyle = op.color || '#FFF176';
      cctx.fillRect(op.x, op.y, 160, 120);
      cctx.fillStyle = '#2b2b16'; cctx.font = '13px sans-serif';
      wrapText(op.text || '', op.x + 10, op.y + 20, 140, 16);
    } else if (op.tool === 'text') {
      cctx.fillStyle = op.color; cctx.font = `${op.size || 18}px sans-serif`;
      cctx.fillText(op.text || '', op.x, op.y);
    } else if (op.tool === 'image' && op._img) {
      cctx.drawImage(op._img, op.x, op.y, op.w, op.h);
    }
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '', yy = y;
    for (const word of words) {
      const test = line + word + ' ';
      if (cctx.measureText(test).width > maxWidth && line) { cctx.fillText(line, x, yy); line = word + ' '; yy += lineHeight; }
      else line = test;
    }
    cctx.fillText(line, x, yy);
  }

  function commitOp(op) {
    ops.push(op);
    myUndoStack.push(op.id);
    ctx.peerManager.broadcastJSON({ type: 'wb:add', op: sanitizeOpForWire(op) });
    draw();
  }

  // ---- pointer interactions ----
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || spacePan) { startPan(e); return; }
    const { x, y } = toWorld(e.clientX, e.clientY);
    drawing = true;
    if (tool === 'pen' || tool === 'eraser') {
      currentOp = { id: uid('op'), tool, color, width, points: [{ x, y }] };
    } else if (['rect', 'circle', 'arrow'].includes(tool)) {
      currentOp = { id: uid('op'), tool, color, width, x1: x, y1: y, x2: x, y2: y };
    } else if (tool === 'sticky') {
      commitOp({ id: uid('op'), tool: 'sticky', x, y, color: '#FFF176', text: prompt('Sticky note text:', '') || '' });
      drawing = false;
    } else if (tool === 'text') {
      const text = prompt('Text:', '');
      if (text) commitOp({ id: uid('op'), tool: 'text', color, size: 18, x, y, text });
      drawing = false;
    } else if (tool === 'image') {
      imageInput.dataset.x = x; imageInput.dataset.y = y;
      imageInput.click();
      drawing = false;
    }
  });
  function onWindowMouseMove(e) {
    if (!drawing || !currentOp) return;
    const { x, y } = toWorld(e.clientX, e.clientY);
    if (currentOp.points) currentOp.points.push({ x, y });
    else { currentOp.x2 = x; currentOp.y2 = y; }
    draw();
  }
  function onWindowMouseUp() {
    if (drawing && currentOp) { commitOp(currentOp); currentOp = null; }
    drawing = false;
  }
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);

  function startPan(e) {
    const startX = e.clientX, startY = e.clientY, startOx = view.ox, startOy = view.oy;
    const onMove = (ev) => { view.ox = startOx + (ev.clientX - startX); view.oy = startOy + (ev.clientY - startY); draw(); };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function onWindowKeyDown(e) { if (e.code === 'Space') spacePan = true; }
  function onWindowKeyUp(e) { if (e.code === 'Space') spacePan = false; }
  window.addEventListener('keydown', onWindowKeyDown);
  window.addEventListener('keyup', onWindowKeyUp);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    view.scale = clamp(view.scale * factor, 0.2, 4);
    draw();
  }, { passive: false });

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    const x = Number(imageInput.dataset.x);
    const y = Number(imageInput.dataset.y);
    loadAndDownscaleImage(file).then(({ dataUrl, img, w, h }) => {
      const displayW = Math.min(280, w);
      const displayH = displayW * (h / w);
      commitOp({ id: uid('op'), tool: 'image', x, y, w: displayW, h: displayH, dataUrl, _img: img });
    }).catch(() => ctx.notifications.toast('error', 'Could not add image', 'That file could not be read as an image.'));
    imageInput.value = '';
  });

  body.querySelector('#wb-tools').querySelectorAll('.wb-tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tool = btn.dataset.tool;
      body.querySelectorAll('.wb-tool[data-tool]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
  body.querySelector('.wb-tool[data-tool="pen"]').classList.add('active');
  body.querySelectorAll('.wb-color').forEach((el) => {
    el.classList.toggle('active', el.dataset.color === color);
    el.addEventListener('click', () => { color = el.dataset.color; body.querySelectorAll('.wb-color').forEach((c) => c.classList.toggle('active', c === el)); });
  });
  body.querySelector('#wb-undo').addEventListener('click', () => {
    const lastId = myUndoStack.pop();
    if (!lastId) return;
    ops = ops.filter((o) => o.id !== lastId);
    ctx.peerManager.broadcastJSON({ type: 'wb:remove', opId: lastId });
    draw();
  });
  body.querySelector('#wb-clear').addEventListener('click', async () => {
    const ok = await ctx.modal.confirmDialog({ title: 'Clear whiteboard?', message: 'This clears the board for everyone in the workspace.', confirmLabel: 'Clear', danger: true });
    if (ok) { ops = []; ctx.peerManager.broadcastJSON({ type: 'wb:clear' }); draw(); }
  });
  body.querySelector('#wb-export').addEventListener('click', () => {
    canvas.toBlob((blob) => downloadBlob(blob, `meshos-whiteboard-${Date.now()}.png`));
  });

  renderers.add(draw);
  ctx.windowManager.on('close', (w) => {
    if (w.id !== win.id) return;
    renderers.delete(draw);
    resizeObserver.disconnect();
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
    window.removeEventListener('keydown', onWindowKeyDown);
    window.removeEventListener('keyup', onWindowKeyUp);
  });
  resize();
}
