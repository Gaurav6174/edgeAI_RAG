const state = {
  books: [],
  activeBookId: null,
  lastQuestion: '',
};

const els = {
  healthBadge: document.getElementById('health-badge'),
  themeToggle: document.getElementById('theme-toggle'),
  dropzone: document.getElementById('dropzone'),
  dropzoneText: document.getElementById('dropzone-text'),
  fileInput: document.getElementById('file-input'),
  uploadBtn: document.getElementById('upload-btn'),
  uploadStatus: document.getElementById('upload-status'),
  bookList: document.getElementById('book-list'),
  statsCard: document.getElementById('stats-card'),
  statsBody: document.getElementById('stats-body'),
  messages: document.getElementById('messages'),
  emptyState: document.getElementById('empty-state'),
  composer: document.getElementById('composer'),
  questionInput: document.getElementById('question-input'),
  sendBtn: document.getElementById('send-btn'),
};

let pendingFile = null;

// ---------- Theme ----------

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  els.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('theme', theme);
}

els.themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

applyTheme(localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

// ---------- Health ----------

async function checkHealth() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    els.healthBadge.textContent = `${data.books_loaded} book(s) · ${data.chunk_count} chunks`;
    els.healthBadge.className = 'global-nav__badge ok';
  } catch (e) {
    els.healthBadge.textContent = 'backend unreachable';
    els.healthBadge.className = 'global-nav__badge err';
  }
}

// ---------- Chat history (per book, localStorage-backed) ----------

function historyKey(bookId) { return `chat_history_${bookId}`; }

function loadHistory(bookId) {
  try {
    return JSON.parse(localStorage.getItem(historyKey(bookId)) || '[]');
  } catch { return []; }
}

function saveHistoryEntry(bookId, entry) {
  const history = loadHistory(bookId);
  history.push(entry);
  localStorage.setItem(historyKey(bookId), JSON.stringify(history));
}

// ---------- Books ----------

async function loadBooks(selectId) {
  const res = await fetch('/books');
  state.books = await res.json();
  renderBooks();
  if (selectId) {
    selectBook(selectId);
  } else if (!state.activeBookId && state.books.length) {
    selectBook(state.books[state.books.length - 1].book_id);
  }
}

function renderBooks() {
  els.bookList.innerHTML = '';
  if (!state.books.length) {
    els.bookList.innerHTML = '<li class="book-list__empty">No books yet</li>';
    return;
  }
  for (const book of state.books) {
    const li = document.createElement('li');
    li.className = 'book-chip' + (book.book_id === state.activeBookId ? ' selected' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'book-chip__name';
    nameSpan.textContent = book.filename;
    nameSpan.title = book.filename;

    const countSpan = document.createElement('span');
    countSpan.className = 'book-chip__count';
    countSpan.textContent = book.chunks_count;

    const actions = document.createElement('span');
    actions.className = 'book-chip__actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'book-chip__icon-btn';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); renameBookPrompt(book); });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'book-chip__icon-btn';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteBookConfirm(book); });

    actions.append(renameBtn, deleteBtn);
    li.append(nameSpan, countSpan, actions);
    li.addEventListener('click', () => selectBook(book.book_id));
    els.bookList.appendChild(li);
  }
}

function selectBook(bookId) {
  state.activeBookId = bookId;
  renderBooks();
  renderStats();
  restoreHistory(bookId);
  const enabled = Boolean(bookId);
  els.questionInput.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
  if (enabled) {
    els.questionInput.placeholder = 'Ask a question about this book…';
  }
}

function renderStats() {
  const book = state.books.find(b => b.book_id === state.activeBookId);
  if (!book) { els.statsCard.hidden = true; return; }
  els.statsCard.hidden = false;
  const ingested = book.ingested_at ? new Date(book.ingested_at).toLocaleString() : '—';
  els.statsBody.innerHTML = `
    <div><dt>File</dt><dd title="${escapeHtml(book.filename)}">${escapeHtml(book.filename)}</dd></div>
    <div><dt>Chunks</dt><dd>${book.chunks_count}</dd></div>
    <div><dt>Ingested</dt><dd>${ingested}</dd></div>
    <div><dt>Questions asked</dt><dd>${loadHistory(book.book_id).length}</dd></div>
  `;
}

function restoreHistory(bookId) {
  els.messages.innerHTML = '';
  const history = loadHistory(bookId);
  if (!history.length) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML = `<p class="empty-state__title">Select a book, then ask it anything</p>
      <p class="empty-state__hint">Answers are generated only from the book you pick — nothing else. Press <kbd>/</kbd> to focus the box, <kbd>↑</kbd> to recall your last question.</p>`;
    els.messages.appendChild(div);
    return;
  }
  for (const entry of history) {
    appendUserMessage(entry.question);
    const el = appendAssistantPlaceholder();
    renderAssistantMessage(el, entry.answer, { confidence: entry.confidence, citations: entry.citations });
  }
}

async function renameBookPrompt(book) {
  const newName = prompt('Rename book', book.filename);
  if (!newName || newName === book.filename) return;
  const res = await fetch(`/books/${encodeURIComponent(book.book_id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: newName }),
  });
  if (res.ok) await loadBooks(state.activeBookId);
}

async function deleteBookConfirm(book) {
  if (!confirm(`Delete "${book.filename}"? This removes its index permanently.`)) return;
  const res = await fetch(`/books/${encodeURIComponent(book.book_id)}`, { method: 'DELETE' });
  if (res.ok) {
    localStorage.removeItem(historyKey(book.book_id));
    if (state.activeBookId === book.book_id) state.activeBookId = null;
    await loadBooks();
    await checkHealth();
    if (!state.activeBookId) {
      els.statsCard.hidden = true;
      els.questionInput.disabled = true;
      els.sendBtn.disabled = true;
      restoreHistory(null);
    }
  }
}

// ---------- Upload ----------

els.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropzone.classList.add('dragover');
});
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) setPendingFile(file);
});
els.fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) setPendingFile(file);
});

function setPendingFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    setUploadStatus('Only PDF files are accepted', 'err');
    return;
  }
  pendingFile = file;
  els.dropzoneText.textContent = file.name;
  els.uploadBtn.disabled = false;
  setUploadStatus('');
}

els.uploadBtn.addEventListener('click', async () => {
  if (!pendingFile) return;
  els.uploadBtn.disabled = true;
  setUploadStatus('Ingesting…');

  const formData = new FormData();
  formData.append('file', pendingFile);

  try {
    const res = await fetch('/ingest', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Upload failed');
    }
    const data = await res.json();
    setUploadStatus(`Indexed ${data.chunks_indexed} chunks`, 'ok');
    pendingFile = null;
    els.dropzoneText.textContent = 'Click or drag a PDF here';
    els.fileInput.value = '';
    await loadBooks(data.book_id);
    await checkHealth();
  } catch (e) {
    setUploadStatus(e.message, 'err');
    els.uploadBtn.disabled = false;
  }
});

function setUploadStatus(text, kind) {
  els.uploadStatus.textContent = text;
  els.uploadStatus.className = 'status-line' + (kind ? ' ' + kind : '');
}

// ---------- Chat ----------

els.composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = els.questionInput.value.trim();
  if (!question || !state.activeBookId) return;

  els.questionInput.value = '';
  state.lastQuestion = question;
  document.getElementById('empty-state')?.remove();
  appendUserMessage(question);
  const assistantEl = appendAssistantPlaceholder();
  setComposerBusy(true);

  const bookId = state.activeBookId;

  try {
    const [citationsData, answerText] = await Promise.all([
      fetchCitations(question, bookId),
      streamAnswer(question, bookId, assistantEl),
    ]);
    renderAssistantMessage(assistantEl, answerText, citationsData);
    saveHistoryEntry(bookId, {
      question,
      answer: answerText,
      confidence: citationsData.confidence,
      citations: citationsData.citations,
    });
    renderStats();
  } catch (err) {
    assistantEl.innerHTML = `<span style="color:var(--color-low)">Error: ${escapeHtml(err.message)}</span>`;
  } finally {
    setComposerBusy(false);
  }
});

function setComposerBusy(busy) {
  els.questionInput.disabled = busy;
  els.sendBtn.disabled = busy;
  if (!busy) els.questionInput.focus();
}

function appendUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg msg--user';
  div.textContent = text;
  els.messages.appendChild(div);
  scrollToBottom();
}

function appendAssistantPlaceholder() {
  const div = document.createElement('div');
  div.className = 'msg msg--assistant';
  div.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  els.messages.appendChild(div);
  scrollToBottom();
  return div;
}

async function streamAnswer(question, bookId, el) {
  const res = await fetch('/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, book_id: bookId }),
  });
  if (!res.ok || !res.body) throw new Error('Query failed');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let first = true;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const token = decoder.decode(value, { stream: true });
    full += token;
    if (first) { el.textContent = ''; first = false; }
    el.textContent = full;
    scrollToBottom();
  }
  return full;
}

async function fetchCitations(question, bookId) {
  const res = await fetch(`/citations?question=${encodeURIComponent(question)}&book_id=${encodeURIComponent(bookId)}`);
  if (!res.ok) return { confidence: 0, found: false, citations: [] };
  return res.json();
}

function renderAssistantMessage(el, answerText, citationsData) {
  const { confidence, citations } = citationsData;
  const pct = Math.round((confidence || 0) * 100);
  const tier = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'mid' : 'low';

  let html = `<span class="confidence-badge ${tier}">${pct}% confidence</span><div>${renderMarkdown(answerText)}</div>`;

  if (citations && citations.length) {
    html += `<details class="citations"><summary>${citations.length} source(s)</summary>`;
    for (const c of citations) {
      html += `<div class="citation-item">${escapeHtml(c.text)}<div class="citation-item__meta">${escapeHtml(c.source)}${c.page ? ' · page ' + c.page : ''}</div></div>`;
    }
    html += `</details>`;
  }

  el.innerHTML = html;
  scrollToBottom();
}

// Minimal, dependency-free markdown: **bold**, *italic*, `code`, "- " lists, line breaks.
function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  const lines = escaped.split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    const bulletMatch = line.match(/^\s*-\s+(.*)/);
    if (bulletMatch) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineMarkdown(bulletMatch[1])}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += `<div>${inlineMarkdown(line)}</div>`;
    }
  }
  if (inList) html += '</ul>';
  return html || escaped;
}

function inlineMarkdown(line) {
  return line
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Keyboard shortcuts ----------

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

  if (e.key === '/' && !isTyping) {
    e.preventDefault();
    els.questionInput.focus();
  } else if (e.key === 'ArrowUp' && document.activeElement === els.questionInput && !els.questionInput.value) {
    e.preventDefault();
    els.questionInput.value = state.lastQuestion;
  } else if (e.key === 'Escape' && document.activeElement === els.questionInput) {
    els.questionInput.value = '';
    els.questionInput.blur();
  }
});

// ---------- Init ----------

checkHealth();
loadBooks();
