const state = {
  books: [],
  activeBookId: null,
};

const els = {
  healthBadge: document.getElementById('health-badge'),
  dropzone: document.getElementById('dropzone'),
  dropzoneText: document.getElementById('dropzone-text'),
  fileInput: document.getElementById('file-input'),
  uploadBtn: document.getElementById('upload-btn'),
  uploadStatus: document.getElementById('upload-status'),
  bookList: document.getElementById('book-list'),
  messages: document.getElementById('messages'),
  emptyState: document.getElementById('empty-state'),
  composer: document.getElementById('composer'),
  questionInput: document.getElementById('question-input'),
  sendBtn: document.getElementById('send-btn'),
};

let pendingFile = null;

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
    li.innerHTML = `
      <span class="book-chip__name">${escapeHtml(book.filename)}</span>
      <span class="book-chip__count">${book.chunks_count}</span>
    `;
    li.addEventListener('click', () => selectBook(book.book_id));
    els.bookList.appendChild(li);
  }
}

function selectBook(bookId) {
  state.activeBookId = bookId;
  renderBooks();
  const enabled = Boolean(bookId);
  els.questionInput.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
  if (enabled) {
    els.questionInput.placeholder = 'Ask a question about this book…';
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
  els.emptyState.remove();
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

  let html = `<span class="confidence-badge ${tier}">${pct}% confidence</span><div>${escapeHtml(answerText)}</div>`;

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

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Init ----------

checkHealth();
loadBooks();
