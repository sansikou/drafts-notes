/**
 * Drafts iOS — 与桌面版功能对齐，直连同一 Supabase
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Heading from '@tiptap/extension-heading';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import TurndownService from 'turndown';
import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase.js';
import { storeGet, storeSet } from './storage.js';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';

const SYNC_DEBOUNCE_MS = 2000;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const EMPTY_HTML = '<p></p>';

let notes = [];
let activeNoteId = null;
let editor = null;
let isSourceMode = false;
let sidebarView = 'all';
let isSelectMode = false;
let selectedNoteIds = new Set();
let syncTimer = null;
let currentView = 'list';

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
turndown.addRule('taskList', {
  filter: (node) => node.nodeName === 'UL' && node.getAttribute('data-type') === 'taskList',
  replacement: (_content, node) => {
    const items = Array.from(node.querySelectorAll('li[data-type="taskItem"]'));
    return items
      .map((li) => {
        const checked = li.getAttribute('data-checked') === 'true';
        return `- [${checked ? 'x' : ' '}] ${li.textContent.trim()}`;
      })
      .join('\n') + '\n';
  },
});
marked.setOptions({ breaks: true, gfm: true });

const $viewList = document.getElementById('view-list');
const $viewEditor = document.getElementById('view-editor');
const $editor = document.getElementById('editor');
const $sourceView = document.getElementById('source-view');
const $toolbar = document.getElementById('toolbar');
const $noteList = document.getElementById('note-list');
const $searchInput = document.getElementById('search-input');
const $syncIndicator = document.getElementById('sync-indicator');
const $noteMeta = document.getElementById('note-meta');
const $btnNewNote = document.getElementById('btn-new-note');
const $btnBack = document.getElementById('btn-back');
const $btnToggleSource = document.getElementById('btn-toggle-source');
const $btnPinNote = document.getElementById('btn-pin-note');
const $btnDeleteNote = document.getElementById('btn-delete-note');
const $tabAll = document.getElementById('tab-all');
const $tabTrash = document.getElementById('tab-trash');
const $sidebarToolbar = document.getElementById('sidebar-toolbar');
const $btnSelectMode = document.getElementById('btn-select-mode');
const $btnSelectAll = document.getElementById('btn-select-all');
const $btnDeleteSelected = document.getElementById('btn-delete-selected');
const $btnCancelSelect = document.getElementById('btn-cancel-select');

function extractTextLines(html) {
  const div = document.createElement('div');
  div.innerHTML = html || EMPTY_HTML;
  const lines = [];
  div.querySelectorAll('p, h1, h2, h3, h4, li, blockquote').forEach((el) => {
    const t = (el.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (t) lines.push(t);
  });
  if (!lines.length) {
    const t = (div.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (t) lines.push(...t.split(/\n+/).map((l) => l.trim()).filter(Boolean));
  }
  return lines;
}

function deriveFirstLine(html) {
  return extractTextLines(html)[0] || '无标题';
}

function derivePreview(html) {
  const lines = extractTextLines(html);
  if (lines.length <= 1) return '';
  return lines.slice(1).join('\n');
}

function htmlToPlainText(html) {
  return extractTextLines(html).join('\n');
}

function htmlToMarkdown(html) {
  if (!html || html === EMPTY_HTML) return '';
  return turndown.turndown(html);
}

function markdownToHtml(md) {
  if (!md || !md.trim()) return EMPTY_HTML;
  return marked.parse(md);
}

function getActiveNote() {
  return notes.find((n) => n.id === activeNoteId) ?? null;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatListModified(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `Modified: ${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}, ${h12}:${pad(d.getMinutes())} ${ampm}`;
}

function getActiveNotes() {
  return notes.filter((n) => !n.deletedAt);
}

function getTrashedNotes() {
  return notes.filter((n) => n.deletedAt);
}

function sortNotes(list) {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

/** 与桌面兼容：content 可为 HTML，或带 pinned/deletedAt 的 JSON */
function noteToDbRow(note) {
  return {
    id: note.id,
    content: JSON.stringify({
      contentHtml: note.contentHtml,
      pinned: !!note.pinned,
      deletedAt: note.deletedAt ?? null,
    }),
    plain_text: htmlToPlainText(note.contentHtml),
    created_at: new Date(note.createdAt).toISOString(),
    updated_at: new Date(note.updatedAt).toISOString(),
  };
}

function dbRowToNote(row) {
  let contentHtml = row.content || EMPTY_HTML;
  let pinned = false;
  let deletedAt = null;

  if (typeof contentHtml === 'string' && contentHtml.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(contentHtml);
      contentHtml = parsed.contentHtml || EMPTY_HTML;
      pinned = !!parsed.pinned;
      deletedAt = parsed.deletedAt ?? null;
    } catch {
      /* 旧数据兼容 */
    }
  }

  return {
    id: row.id,
    contentHtml,
    pinned,
    deletedAt,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

function normalizeNote(n) {
  return {
    id: n.id,
    contentHtml: n.contentHtml || EMPTY_HTML,
    createdAt: n.createdAt ?? Date.now(),
    updatedAt: n.updatedAt ?? Date.now(),
    deletedAt: n.deletedAt ?? null,
    pinned: !!n.pinned,
  };
}

async function persistNotes() {
  await storeSet('notes', notes);
  await storeSet('activeNoteId', activeNoteId);
  scheduleSyncDebounced();
}

async function loadNotes() {
  const storedNotes = await storeGet('notes');
  const storedActiveId = await storeGet('activeNoteId');

  if (Array.isArray(storedNotes) && storedNotes.length > 0) {
    notes = storedNotes.map(normalizeNote);
    activeNoteId = storedActiveId ?? notes.find((n) => !n.deletedAt)?.id ?? notes[0]?.id;
  } else {
    const id = uuidv4();
    const now = Date.now();
    notes = [{ id, contentHtml: EMPTY_HTML, createdAt: now, updatedAt: now, deletedAt: null, pinned: false }];
    activeNoteId = id;
    await persistNotes();
  }

  await pullFromSupabase();
  purgeExpiredTrash();
}

function setSyncStatus(status) {
  $syncIndicator.className = 'sync-indicator';
  if (status) $syncIndicator.classList.add(status);
}

function scheduleSyncDebounced() {
  clearTimeout(syncTimer);
  setSyncStatus('');
  syncTimer = setTimeout(syncToSupabase, SYNC_DEBOUNCE_MS);
}

async function pullFromSupabase() {
  try {
    const { data, error } = await supabase.from('notes').select('*');
    if (error) throw error;
    if (!data?.length) return;

    const merged = new Map(notes.map((n) => [n.id, n]));
    data.map(dbRowToNote).forEach((remote) => {
      const local = merged.get(remote.id);
      if (!local || remote.updatedAt >= local.updatedAt) merged.set(remote.id, remote);
    });

    notes = Array.from(merged.values());
    if (!getActiveNote() || getActiveNote()?.deletedAt) {
      activeNoteId = getActiveNotes()[0]?.id ?? notes[0]?.id ?? null;
    }
    await storeSet('notes', notes);
    await storeSet('activeNoteId', activeNoteId);
  } catch (err) {
    console.error('[supabase pull]', err);
  }
}

async function syncToSupabase() {
  const note = getActiveNote();
  if (!note) return;
  setSyncStatus('syncing');
  try {
    const { error } = await supabase.from('notes').upsert(noteToDbRow(note), { onConflict: 'id' });
    if (error) throw error;
    setSyncStatus('synced');
  } catch (err) {
    console.error('[supabase sync]', err);
    setSyncStatus('error');
  }
}

async function deleteFromSupabase(id) {
  try {
    await supabase.from('notes').delete().eq('id', id);
  } catch (err) {
    console.error('[supabase delete]', err);
  }
}

function purgeExpiredTrash() {
  const now = Date.now();
  const expired = notes.filter((n) => n.deletedAt && now - n.deletedAt > TRASH_RETENTION_MS);
  if (!expired.length) return;
  expired.forEach((n) => deleteFromSupabase(n.id));
  notes = notes.filter((n) => !expired.some((e) => e.id === n.id));
  if (getActiveNote()?.deletedAt && !getActiveNotes().find((n) => n.id === activeNoteId)) {
    activeNoteId = getActiveNotes()[0]?.id ?? null;
  }
  persistNotes();
  renderNoteList($searchInput.value);
  if (activeNoteId && currentView === 'editor') loadActiveNoteIntoEditor();
}

function serializeClipboardText(slice) {
  return slice.content.textBetween(0, slice.content.size, '\n', '\n');
}

function createEditor(initialHtml) {
  return new Editor({
    element: $editor,
    extensions: [
      StarterKit.configure({ heading: false }),
      Heading.configure({ levels: [1, 2, 3, 4] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: '开始书写…' }),
    ],
    content: initialHtml || EMPTY_HTML,
    editorProps: {
      clipboardTextSerializer: serializeClipboardText,
    },
    onUpdate: ({ editor: ed }) => {
      if (isSourceMode) return;
      saveCurrentNoteContent(ed.getHTML());
    },
    onSelectionUpdate: () => updateToolbarActiveStates(),
  });
}

function saveCurrentNoteContent(html) {
  const note = getActiveNote();
  if (!note || note.deletedAt) return;
  note.contentHtml = html;
  note.updatedAt = Date.now();
  persistNotes();
  renderNoteList($searchInput.value);
  renderNoteMeta();
}

function updateToolbarActiveStates() {
  if (!editor) return;
  $toolbar.querySelectorAll('.toolbar-btn').forEach((btn) => {
    const action = btn.dataset.action;
    let active = false;
    switch (action) {
      case 'h1': active = editor.isActive('heading', { level: 1 }); break;
      case 'h2': active = editor.isActive('heading', { level: 2 }); break;
      case 'h3': active = editor.isActive('heading', { level: 3 }); break;
      case 'h4': active = editor.isActive('heading', { level: 4 }); break;
      case 'bold': active = editor.isActive('bold'); break;
      case 'italic': active = editor.isActive('italic'); break;
      case 'blockquote': active = editor.isActive('blockquote'); break;
      case 'bulletList': active = editor.isActive('bulletList'); break;
      case 'taskList': active = editor.isActive('taskList'); break;
    }
    btn.classList.toggle('is-active', active);
  });
  $btnPinNote?.classList.toggle('is-active', !!getActiveNote()?.pinned);
  const note = getActiveNote();
  $btnPinNote && ($btnPinNote.disabled = !note || !!note.deletedAt);
  if ($btnDeleteNote) $btnDeleteNote.disabled = !note;
}

function handleToolbarAction(action) {
  if (!editor) return;
  const chain = editor.chain().focus();
  switch (action) {
    case 'h1': chain.toggleHeading({ level: 1 }).run(); break;
    case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
    case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
    case 'h4': chain.toggleHeading({ level: 4 }).run(); break;
    case 'bold': chain.toggleBold().run(); break;
    case 'italic': chain.toggleItalic().run(); break;
    case 'blockquote': chain.toggleBlockquote().run(); break;
    case 'bulletList': chain.toggleBulletList().run(); break;
    case 'taskList': chain.toggleTaskList().run(); break;
  }
  updateToolbarActiveStates();
}

function switchToSourceMode() {
  if (isSourceMode || !editor) return;
  isSourceMode = true;
  $sourceView.value = htmlToMarkdown(editor.getHTML());
  $editor.classList.add('hidden');
  $sourceView.classList.remove('hidden');
  $btnToggleSource.classList.add('active');
  $btnToggleSource.textContent = '预览';
  $sourceView.focus();
}

function switchToWysiwygMode() {
  if (!isSourceMode || !editor) return;
  isSourceMode = false;
  const html = markdownToHtml($sourceView.value);
  editor.commands.setContent(html, false);
  saveCurrentNoteContent(html);
  $sourceView.classList.add('hidden');
  $editor.classList.remove('hidden');
  $btnToggleSource.classList.remove('active');
  $btnToggleSource.textContent = 'MD';
  editor.commands.focus('end');
}

function toggleSourceMode() {
  if (isSourceMode) switchToWysiwygMode();
  else switchToSourceMode();
}

function showListView() {
  flushCurrentEditor();
  currentView = 'list';
  $viewEditor.classList.add('hidden');
  $viewList.classList.remove('hidden');
  renderNoteList($searchInput.value);
}

function showEditorView() {
  currentView = 'editor';
  $viewList.classList.add('hidden');
  $viewEditor.classList.remove('hidden');
}

function flushCurrentEditor() {
  if (editor && !isSourceMode) saveCurrentNoteContent(editor.getHTML());
  else if (isSourceMode) {
    const html = markdownToHtml($sourceView.value);
    const note = getActiveNote();
    if (note && !note.deletedAt) {
      note.contentHtml = html;
      note.updatedAt = Date.now();
    }
  }
}

function loadActiveNoteIntoEditor() {
  const note = getActiveNote();
  if (!note || !editor) return;
  if (isSourceMode) {
    isSourceMode = false;
    $sourceView.classList.add('hidden');
    $editor.classList.remove('hidden');
    $btnToggleSource.classList.remove('active');
    $btnToggleSource.textContent = 'MD';
  }
  editor.commands.setContent(note.contentHtml || EMPTY_HTML, false);
  editor.setEditable(!note.deletedAt);
  renderNoteMeta();
  updateToolbarActiveStates();
}

function switchToNote(noteId) {
  if (isSelectMode) return;
  flushCurrentEditor();
  activeNoteId = noteId;
  loadActiveNoteIntoEditor();
  persistNotes();
  showEditorView();
  editor?.commands.focus('end');
}

function createNewNote() {
  flushCurrentEditor();
  exitSelectMode();
  const now = Date.now();
  const id = uuidv4();
  notes.unshift({ id, contentHtml: EMPTY_HTML, createdAt: now, updatedAt: now, deletedAt: null, pinned: false });
  switchToNote(id);
}

function togglePinNote() {
  const note = getActiveNote();
  if (!note || note.deletedAt) return;
  note.pinned = !note.pinned;
  note.updatedAt = Date.now();
  persistNotes();
  renderNoteList($searchInput.value);
  updateToolbarActiveStates();
}

function moveNoteToTrash(noteId) {
  const note = notes.find((n) => n.id === noteId);
  if (!note || note.deletedAt) return;
  note.deletedAt = Date.now();
  note.updatedAt = Date.now();
  note.pinned = false;
}

function permanentlyDeleteNote(noteId) {
  deleteFromSupabase(noteId);
  notes = notes.filter((n) => n.id !== noteId);
}

function afterNotesRemoved() {
  if (!getActiveNotes().find((n) => n.id === activeNoteId)) {
    activeNoteId = getActiveNotes()[0]?.id ?? null;
    if (activeNoteId && currentView === 'editor') loadActiveNoteIntoEditor();
    else if (currentView === 'editor') {
      showListView();
      editor?.commands.setContent(EMPTY_HTML);
      renderNoteMeta();
    }
  }
  persistNotes();
  renderNoteList($searchInput.value);
  updateToolbarActiveStates();
}

function deleteNoteQuick(noteId) {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;
  if (note.deletedAt || sidebarView === 'trash') {
    if (!confirm('确定永久删除这条笔记吗？')) return;
    permanentlyDeleteNote(noteId);
  } else {
    moveNoteToTrash(noteId);
  }
  afterNotesRemoved();
}

function deleteActiveNote() {
  const note = getActiveNote();
  if (!note) return;
  deleteNoteQuick(note.id);
  if (!getActiveNote() || getActiveNote()?.deletedAt) showListView();
}

function deleteSelectedNotes() {
  if (!selectedNoteIds.size) return;
  const count = selectedNoteIds.size;
  const msg = sidebarView === 'trash'
    ? `确定永久删除选中的 ${count} 条笔记吗？`
    : `确定将选中的 ${count} 条笔记移入回收站吗？`;
  if (!confirm(msg)) return;
  if (sidebarView === 'trash') selectedNoteIds.forEach((id) => permanentlyDeleteNote(id));
  else selectedNoteIds.forEach((id) => moveNoteToTrash(id));
  exitSelectMode();
  afterNotesRemoved();
}

function restoreNote(noteId) {
  const note = notes.find((n) => n.id === noteId);
  if (!note?.deletedAt) return;
  note.deletedAt = null;
  note.updatedAt = Date.now();
  persistNotes();
  renderNoteList($searchInput.value);
}

function renderNoteMeta() {
  const note = getActiveNote();
  if (!note) {
    $noteMeta.innerHTML = '';
    return;
  }
  const trashHint = note.deletedAt
    ? `<span class="note-meta-trash">回收站 · ${Math.max(0, 30 - Math.floor((Date.now() - note.deletedAt) / 86400000))} 天后永久删除</span>`
    : '';
  $noteMeta.innerHTML = `
    <span>创建 ${formatDateTime(note.createdAt)}</span>
    <span class="note-meta-sep">·</span>
    <span>更新 ${formatDateTime(note.updatedAt)}</span>
    ${trashHint}
  `;
}

function enterSelectMode() {
  isSelectMode = true;
  selectedNoteIds.clear();
  $sidebarToolbar.classList.remove('hidden');
  $btnSelectMode.classList.add('hidden');
  updateDeleteSelectedLabel();
  renderNoteList($searchInput.value);
}

function exitSelectMode() {
  isSelectMode = false;
  selectedNoteIds.clear();
  $sidebarToolbar.classList.add('hidden');
  $btnSelectMode.classList.remove('hidden');
  renderNoteList($searchInput.value);
}

function updateDeleteSelectedLabel() {
  const n = selectedNoteIds.size;
  $btnDeleteSelected.textContent = n ? `删除 (${n})` : '删除';
  $btnDeleteSelected.disabled = n === 0;
}

function toggleNoteSelection(noteId) {
  if (selectedNoteIds.has(noteId)) selectedNoteIds.delete(noteId);
  else selectedNoteIds.add(noteId);
  updateDeleteSelectedLabel();
  renderNoteList($searchInput.value);
}

function selectAllVisible() {
  const q = $searchInput.value.trim().toLowerCase();
  const source = sidebarView === 'trash' ? getTrashedNotes() : getActiveNotes();
  const filtered = q
    ? source.filter((n) => htmlToPlainText(n.contentHtml).toLowerCase().includes(q))
    : source;
  filtered.forEach((n) => selectedNoteIds.add(n.id));
  updateDeleteSelectedLabel();
  renderNoteList($searchInput.value);
}

function setSidebarView(view) {
  sidebarView = view;
  exitSelectMode();
  $tabAll.classList.toggle('active', view === 'all');
  $tabTrash.classList.toggle('active', view === 'trash');
  $searchInput.placeholder = view === 'trash' ? '搜索回收站…' : '搜索笔记…';
  renderNoteList($searchInput.value);
}

function renderNoteList(query = '') {
  const q = query.trim().toLowerCase();
  const source = sidebarView === 'trash' ? getTrashedNotes() : getActiveNotes();
  const filtered = q
    ? source.filter((n) => htmlToPlainText(n.contentHtml).toLowerCase().includes(q))
    : source;
  const sorted = sortNotes(filtered);
  $noteList.innerHTML = '';

  if (!sorted.length) {
    const empty = document.createElement('li');
    empty.className = 'note-list-empty';
    empty.textContent = q ? '没有匹配的笔记' : sidebarView === 'trash' ? '回收站为空' : '暂无笔记';
    $noteList.appendChild(empty);
    return;
  }

  sorted.forEach((note) => {
    const li = document.createElement('li');
    li.className = 'note-item';
    if (note.id === activeNoteId && !isSelectMode) li.classList.add('active');
    if (note.pinned && sidebarView === 'all') li.classList.add('pinned');
    if (isSelectMode && selectedNoteIds.has(note.id)) li.classList.add('selected');

    if (isSelectMode) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'note-item-checkbox';
      checkbox.checked = selectedNoteIds.has(note.id);
      checkbox.addEventListener('click', (e) => e.stopPropagation());
      checkbox.addEventListener('change', () => toggleNoteSelection(note.id));
      li.appendChild(checkbox);
    }

    const body = document.createElement('div');
    body.className = 'note-item-body';
    const content = document.createElement('div');
    content.className = 'note-item-content';

    const title = document.createElement('div');
    title.className = 'note-item-title';
    title.textContent = deriveFirstLine(note.contentHtml);

    const preview = document.createElement('div');
    preview.className = 'note-item-preview';
    preview.textContent = derivePreview(note.contentHtml) || ' ';

    const modified = document.createElement('div');
    modified.className = 'note-item-modified';
    modified.textContent = formatListModified(note.updatedAt);

    content.append(title, preview, modified);
    body.appendChild(content);
    li.appendChild(body);

    if (!isSelectMode) {
      const actions = document.createElement('div');
      actions.className = 'note-item-actions';
      if (sidebarView === 'trash') {
        const btnRestore = document.createElement('button');
        btnRestore.className = 'note-action-btn';
        btnRestore.type = 'button';
        btnRestore.textContent = '恢复';
        btnRestore.addEventListener('click', (e) => { e.stopPropagation(); restoreNote(note.id); });
        actions.appendChild(btnRestore);
      }
      const btnDelete = document.createElement('button');
      btnDelete.className = 'note-action-btn note-action-danger';
      btnDelete.type = 'button';
      btnDelete.textContent = '删除';
      btnDelete.addEventListener('click', (e) => { e.stopPropagation(); deleteNoteQuick(note.id); });
      actions.appendChild(btnDelete);
      li.appendChild(actions);
    }

    li.addEventListener('click', () => {
      if (isSelectMode) toggleNoteSelection(note.id);
      else switchToNote(note.id);
    });

    $noteList.appendChild(li);
  });
}

function bindEvents() {
  $toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.toolbar-btn');
    if (btn) handleToolbarAction(btn.dataset.action);
  });

  $btnNewNote.addEventListener('click', createNewNote);
  $btnBack.addEventListener('click', showListView);
  $btnToggleSource.addEventListener('click', toggleSourceMode);
  $btnPinNote.addEventListener('click', togglePinNote);
  $btnDeleteNote.addEventListener('click', deleteActiveNote);
  $tabAll.addEventListener('click', () => setSidebarView('all'));
  $tabTrash.addEventListener('click', () => setSidebarView('trash'));
  $btnSelectMode.addEventListener('click', enterSelectMode);
  $btnCancelSelect.addEventListener('click', exitSelectMode);
  $btnSelectAll.addEventListener('click', selectAllVisible);
  $btnDeleteSelected.addEventListener('click', deleteSelectedNotes);

  $sourceView.addEventListener('input', () => {
    if (!isSourceMode) return;
    const html = markdownToHtml($sourceView.value);
    const note = getActiveNote();
    if (note && !note.deletedAt) {
      note.contentHtml = html;
      note.updatedAt = Date.now();
      persistNotes();
      renderNoteList($searchInput.value);
      renderNoteMeta();
    }
  });

  $searchInput.addEventListener('input', (e) => renderNoteList(e.target.value));
  setInterval(purgeExpiredTrash, 60 * 60 * 1000);
}

async function setupNative() {
  try {
    await StatusBar.setStyle({ style: Style.Light });
  } catch { /* web */ }
  try {
    Keyboard.setAccessoryBarVisible({ isVisible: true });
  } catch { /* web */ }
  try {
    App.addListener('backButton', ({ canGoBack }) => {
      if (currentView === 'editor') {
        showListView();
      } else if (!canGoBack) {
        App.exitApp();
      }
    });
  } catch { /* web */ }
}

async function init() {
  await setupNative();
  await loadNotes();
  const activeNote = getActiveNote();
  editor = createEditor(activeNote?.contentHtml || EMPTY_HTML);
  editor.setEditable(!activeNote?.deletedAt);
  bindEvents();
  renderNoteList();
  renderNoteMeta();
  updateToolbarActiveStates();
  showListView();
}

init().catch(console.error);
