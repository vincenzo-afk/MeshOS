/**
 * Notes
 * Shared notes and checklists. Each note is a small object broadcast in
 * full on every edit (debounced); last-write-wins per note id, which is
 * simple and good enough for a small collaborating group.
 */
import { getIcon } from '../utils/icons.js';
import { escapeHtml, timeAgo, uid, debounce } from '../utils/helpers.js';

/** @type {Map<string, object>} noteId -> note */
const notes = new Map();
let wired = false;
let activeNoteId = null;
const renderers = new Set();

function wire(ctx) {
  if (wired) return;
  wired = true;
  ctx.peerManager.on('message', (peerId, label, msg) => {
    if (label !== 'main' || !String(msg.type || '').startsWith('notes:')) return;
    if (msg.type === 'notes:upsert') {
      const existing = notes.get(msg.note.id);
      if (!existing || existing.updatedAt < msg.note.updatedAt) notes.set(msg.note.id, msg.note);
      renderAll();
    } else if (msg.type === 'notes:delete') {
      notes.delete(msg.noteId);
      if (activeNoteId === msg.noteId) activeNoteId = null;
      renderAll();
    } else if (msg.type === 'notes:sync') {
      if (Array.isArray(msg.notes)) {
        let changed = false;
        for (const note of msg.notes) {
          const existing = notes.get(note.id);
          if (!existing || existing.updatedAt < note.updatedAt) { notes.set(note.id, note); changed = true; }
        }
        if (changed) renderAll();
      }
    }
  });

  // Catch up anyone who joins after notes already exist.
  ctx.peerManager.on('channel-open', (peerId, label) => {
    if (label !== 'main' || notes.size === 0) return;
    ctx.peerManager.sendJSON(peerId, { type: 'notes:sync', notes: Array.from(notes.values()) });
  });
}

function renderAll() { renderers.forEach((r) => r()); }

export function mount(body, win, ctx) {
  wire(ctx);
  body.classList.add('app-shell');
  body.innerHTML = `
    <div class="notes-layout">
      <div style="display:flex;flex-direction:column;width:200px;border-right:1px solid var(--border);flex-shrink:0;">
        <div class="app-toolbar" style="border-right:none;">
          <button class="icon-mini-btn" id="note-new-text" title="New note">${getIcon('plus', 15)}</button>
          <button class="icon-mini-btn" id="note-new-checklist" title="New checklist">${getIcon('checkCircle', 15)}</button>
        </div>
        <div class="notes-list" id="notes-list" style="flex:1;"></div>
      </div>
      <div class="note-editor" id="note-editor"></div>
    </div>`;

  const listEl = body.querySelector('#notes-list');
  const editorEl = body.querySelector('#note-editor');

  function createNote(type) {
    const note = { id: uid('note'), type, title: type === 'checklist' ? 'New checklist' : 'New note', body: '', items: [], updatedAt: Date.now(), author: ctx.me.username };
    notes.set(note.id, note);
    activeNoteId = note.id;
    broadcast(note);
    render();
  }

  const broadcast = debounce((note) => {
    note.updatedAt = Date.now();
    ctx.peerManager.broadcastJSON({ type: 'notes:upsert', note });
  }, 350);

  function renderList() {
    const all = Array.from(notes.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    listEl.innerHTML = all.map((n) => `
      <div class="note-item ${n.id === activeNoteId ? 'active' : ''}" data-id="${escapeHtml(n.id)}">
        <div class="ni-title">${getIcon(n.type === 'checklist' ? 'checkCircle' : 'notes', 12)} ${escapeHtml(n.title || 'Untitled')}</div>
        <div class="ni-sub">${escapeHtml(n.author || '')} · ${timeAgo(n.updatedAt)}</div>
      </div>`).join('') || `<div class="empty-state" style="padding:20px 10px;">${getIcon('notes', 26)}<p>No notes yet.</p></div>`;
    listEl.querySelectorAll('.note-item').forEach((el) => el.addEventListener('click', () => { activeNoteId = el.dataset.id; render(); }));
  }

  function renderEditor() {
    const note = notes.get(activeNoteId);
    if (!note) {
      editorEl.innerHTML = `<div class="empty-state">${getIcon('notes', 34)}<p>Select a note, or create a new one to start collaborating in real time.</p></div>`;
      return;
    }
    if (note.type === 'checklist') {
      editorEl.innerHTML = `
        <input class="ne-title" value="${escapeHtml(note.title)}" placeholder="Checklist title" />
        <div style="flex:1;overflow-y:auto;padding:0 16px 16px;" id="checklist-body">
          ${note.items.map((it) => `
            <div class="checklist-item ${it.done ? 'done' : ''}" data-id="${escapeHtml(it.id)}">
              <input type="checkbox" ${it.done ? 'checked' : ''} />
              <span contenteditable="true">${escapeHtml(it.text)}</span>
              <button class="icon-mini-btn cl-remove" style="margin-left:auto;">${getIcon('x', 12)}</button>
            </div>`).join('')}
          <button class="btn btn-ghost btn-sm" id="cl-add" style="margin-top:8px;">${getIcon('plus', 12)} Add item</button>
        </div>
        <div class="app-toolbar" style="border-top:1px solid var(--border);border-bottom:none;justify-content:flex-end;">
          <button class="btn btn-danger btn-sm" id="note-delete">${getIcon('trash', 12)} Delete</button>
        </div>`;
      editorEl.querySelector('.ne-title').addEventListener('input', (e) => { note.title = e.target.value; broadcast(note); renderList(); });
      editorEl.querySelectorAll('.checklist-item').forEach((row) => {
        const item = note.items.find((i) => i.id === row.dataset.id);
        row.querySelector('input[type=checkbox]').addEventListener('change', (e) => { item.done = e.target.checked; broadcast(note); renderEditor(); });
        row.querySelector('span').addEventListener('input', (e) => { item.text = e.target.textContent; broadcast(note); });
        row.querySelector('.cl-remove').addEventListener('click', () => { note.items = note.items.filter((i) => i.id !== item.id); broadcast(note); renderEditor(); });
      });
      editorEl.querySelector('#cl-add').addEventListener('click', () => {
        note.items.push({ id: uid('item'), text: '', done: false });
        broadcast(note);
        renderEditor();
        Array.from(editorEl.querySelectorAll('.checklist-item span')).at(-1)?.focus();
      });
    } else {
      editorEl.innerHTML = `
        <input class="ne-title" value="${escapeHtml(note.title)}" placeholder="Note title" />
        <textarea class="ne-body" placeholder="Start typing… synced live with everyone in the workspace.">${escapeHtml(note.body)}</textarea>
        <div class="app-toolbar" style="border-top:1px solid var(--border);border-bottom:none;justify-content:flex-end;">
          <button class="btn btn-danger btn-sm" id="note-delete">${getIcon('trash', 12)} Delete</button>
        </div>`;
      editorEl.querySelector('.ne-title').addEventListener('input', (e) => { note.title = e.target.value; broadcast(note); renderList(); });
      editorEl.querySelector('.ne-body').addEventListener('input', (e) => { note.body = e.target.value; broadcast(note); });
    }
    editorEl.querySelector('#note-delete').addEventListener('click', () => {
      notes.delete(note.id);
      activeNoteId = null;
      ctx.peerManager.broadcastJSON({ type: 'notes:delete', noteId: note.id });
      render();
    });
  }

  function render() { renderList(); renderEditor(); }

  body.querySelector('#note-new-text').addEventListener('click', () => createNote('text'));
  body.querySelector('#note-new-checklist').addEventListener('click', () => createNote('checklist'));

  renderers.add(render);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) renderers.delete(render); });
  render();
}
