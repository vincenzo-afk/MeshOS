/**
 * Code Snippet
 * A lightweight shared code editor: line numbers, a language tag, instant
 * copy, and live sync to everyone in the workspace (debounced).
 */
import { getIcon } from '../utils/icons.js';
import { escapeHtml, debounce } from '../utils/helpers.js';

const state = { code: '// Shared code snippet — anyone in this workspace can edit it.\n', language: 'javascript', updatedAt: 0 };
let wired = false;
const renderers = new Set();

function wire(ctx) {
  if (wired) return;
  wired = true;
  ctx.peerManager.on('message', (peerId, label, msg) => {
    if (label !== 'main' || msg.type !== 'code:sync') return;
    if (msg.updatedAt > state.updatedAt) {
      state.code = msg.code;
      state.language = msg.language;
      state.updatedAt = msg.updatedAt;
      renderers.forEach((r) => r(true));
    }
  });

  // Catch up anyone who joins after the snippet has already been edited.
  ctx.peerManager.on('channel-open', (peerId, label) => {
    if (label !== 'main' || state.updatedAt === 0) return;
    ctx.peerManager.sendJSON(peerId, { type: 'code:sync', code: state.code, language: state.language, updatedAt: state.updatedAt });
  });
}

export function mount(body, win, ctx) {
  wire(ctx);
  body.innerHTML = `
    <div class="code-editor-shell">
      <div class="app-toolbar">
        <select id="code-lang">
          ${['javascript', 'python', 'html', 'css', 'json', 'bash', 'plaintext'].map((l) => `<option value="${l}" ${l === state.language ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="icon-mini-btn" id="code-copy" title="Copy">${getIcon('copy', 15)}</button>
      </div>
      <div class="code-editor-body">
        <div class="code-lines" id="code-lines"></div>
        <textarea id="code-textarea" spellcheck="false"></textarea>
      </div>
    </div>`;

  const textarea = body.querySelector('#code-textarea');
  const linesEl = body.querySelector('#code-lines');
  const langSelect = body.querySelector('#code-lang');

  function renderLines() {
    const count = (textarea.value.match(/\n/g) || []).length + 1;
    linesEl.innerHTML = Array.from({ length: count }, (_, i) => i + 1).join('<br/>');
  }

  function render(fromRemote = false) {
    if (!fromRemote || document.activeElement !== textarea) {
      textarea.value = state.code;
      langSelect.value = state.language;
    }
    renderLines();
  }

  const broadcast = debounce(() => {
    state.code = textarea.value;
    state.language = langSelect.value;
    state.updatedAt = Date.now();
    ctx.peerManager.broadcastJSON({ type: 'code:sync', code: state.code, language: state.language, updatedAt: state.updatedAt });
  }, 300);

  textarea.addEventListener('input', () => { renderLines(); broadcast(); });
  textarea.addEventListener('scroll', () => { linesEl.scrollTop = textarea.scrollTop; });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
  });
  langSelect.addEventListener('change', broadcast);
  body.querySelector('#code-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(textarea.value); ctx.notifications.toast('success', 'Copied', 'Snippet copied to your clipboard.'); } catch (_err) { /* denied */ }
  });

  renderers.add(render);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) renderers.delete(render); });
  render();
}
