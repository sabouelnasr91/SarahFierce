/* ─── STATE ──────────────────────────────────────────────── */
const state = {
  currentView: 'dashboard',
  generatedText: '',
  parsedSections: {},
  activeSection: 'A',
  ftText: '',
  ftParsed: {},
  ftActiveSection: 'summary',
  timer: { total: 3600, remaining: 3600, running: false, interval: null },
  chat: { messages: [], streaming: false, streamingEl: null },
  segments: [],
  currentSegment: 0,
  parkingLot: [],
  history: [],
};

/* ─── INIT ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadHistory();
  renderHistoryPreview();
  setDateHeader();
  wireNav();
  wireGenerate();
  wireFacilitation();
  wireFollowThrough();
  wireSettings();
  wireOutputActions();
  wireChat();
});

/* ─── NAVIGATION ─────────────────────────────────────────── */
function wireNav() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.view));
  });
  document.getElementById('nav-settings').addEventListener('click', openSettings);
}

function navigate(view) {
  if (view === 'output' && !state.generatedText) {
    showToast('Generate a plan first.', 'error');
    return navigate('generate');
  }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById('view-' + view);
  if (!el) return;
  el.classList.add('active');

  const navBtn = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navBtn) navBtn.classList.add('active');

  state.currentView = view;

  if (view === 'history') renderHistoryFull();
  if (view === 'facilitation') renderFacilitationView();
}

/* ─── GENERATE FORM ──────────────────────────────────────── */
function wireGenerate() {
  document.getElementById('generate-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('btn-generate');
    const fd  = new FormData(e.target);
    const formData = Object.fromEntries(fd.entries());

    if (hasPII(formData.evidence + ' ' + formData.realProblem)) {
      showToast('Possible student PII detected. Please anonymize before generating.', 'error');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Generating…';

    state.generatedText = '';
    state.parsedSections = {};

    navigate('output');

    const outputTitle = document.getElementById('output-title');
    const outputSub   = document.getElementById('output-subtitle');
    outputTitle.textContent = `${formData.department || 'PLC'} Package`;
    outputSub.textContent   = `${formData.duration} min · ${formData.primaryFocus} · Generated ${new Date().toLocaleDateString()}`;

    document.getElementById('output-tabs').style.display = 'none';
    document.getElementById('section-copy-bar').style.display = 'none';
    document.getElementById('output-content').innerHTML = '<div id="stream-raw" class="stream-raw"></div>';
    document.getElementById('streaming-indicator').style.display = 'flex';

    try {
      await streamRequest({ mode: 'generate', formData }, onGenerateChunk, onGenerateDone);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Generate Full PLC Package';
    }
  });

  document.getElementById('btn-continue-last').addEventListener('click', () => {
    const last = state.history[0];
    if (!last) { showToast('No previous PLC found.', 'error'); return; }
    loadHistoryItem(last.id);
  });
}

function onGenerateChunk(text) {
  state.generatedText += text;
  const raw = document.getElementById('stream-raw');
  if (raw) raw.textContent = state.generatedText;
}

function onGenerateDone() {
  document.getElementById('streaming-indicator').style.display = 'none';
  state.parsedSections = parseSections(state.generatedText);

  const tabs = document.getElementById('output-tabs');
  tabs.style.display = 'flex';
  document.getElementById('section-copy-bar').style.display = 'flex';

  activateSection('A');

  saveToHistory({
    id: Date.now(),
    title: document.getElementById('output-title').textContent,
    subtitle: document.getElementById('output-subtitle').textContent,
    date: new Date().toISOString(),
    text: state.generatedText,
    sections: state.parsedSections,
  });
  renderHistoryPreview();
  updateLastPLCLabel();
}

/* ─── OUTPUT TABS ────────────────────────────────────────── */
function wireOutputActions() {
  document.getElementById('output-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn) activateSection(btn.dataset.section);
  });

  document.getElementById('btn-copy-section').addEventListener('click', () => {
    const text = state.parsedSections[state.activeSection] || state.generatedText;
    copyText(text);
  });

  document.getElementById('btn-copy-all').addEventListener('click', () => {
    copyText(state.generatedText);
  });

  document.getElementById('btn-start-live').addEventListener('click', () => {
    navigate('facilitation');
  });
}

function activateSection(key) {
  state.activeSection = key;

  document.querySelectorAll('#output-tabs .tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.section === key);
  });

  const content = document.getElementById('output-content');
  const text = state.parsedSections[key];

  if (!text && key !== 'DOC') {
    content.innerHTML = `<p class="empty-state" style="padding:20px 0">Section not yet available. Generate a plan first.</p>`;
    return;
  }

  if (key === 'DOC') {
    const docText = state.parsedSections['DOC'] || state.generatedText;
    content.innerHTML = `<div class="markdown-body">${marked.parse(docText)}</div>`;
    return;
  }

  content.innerHTML = `<div class="markdown-body">${marked.parse(text)}</div>`;
}

/* ─── SECTION PARSER ─────────────────────────────────────── */
function parseSections(raw) {
  const sections = {};
  const sectionRegex = /##\s+([A-F]\)[\s\S]*?)(?=\n##\s+[A-F\n]|##\s+Next PLC|##\s+Google Doc|$)/g;
  let match;
  while ((match = sectionRegex.exec(raw)) !== null) {
    const content = match[1].trim();
    const letter  = content[0];
    sections[letter] = '## ' + content;
  }

  const docMatch = raw.match(/##\s+Google Doc Ready([\s\S]*?)(?=\n##\s+[A-Z]|$)/);
  if (docMatch) sections['DOC'] = '## Google Doc Ready\n' + docMatch[1].trim();

  const nextMatch = raw.match(/##\s+Next PLC Preview([\s\S]*?)(?=\n##\s+[A-Z]|$)/);
  if (nextMatch && !sections['F']) sections['F'] = '## F) Next PLC Preview\n' + nextMatch[1].trim();

  if (!Object.keys(sections).length) {
    sections['A'] = raw;
  }
  return sections;
}

/* ─── STREAMING ENGINE ───────────────────────────────────── */
async function streamRequest(payload, onChunk, onDone) {
  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      showToast('Server error: ' + (err.error || resp.statusText), 'error');
      onDone();
      return;
    }

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { onDone(); return; }
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { showToast('API error: ' + parsed.error, 'error'); onDone(); return; }
          if (parsed.text)  onChunk(parsed.text);
        } catch (_) {}
      }
    }
    onDone();
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
    onDone();
  }
}

/* ─── FACILITATION MODE ──────────────────────────────────── */
function wireFacilitation() {
  document.getElementById('btn-timer-start').addEventListener('click', startTimer);
  document.getElementById('btn-timer-pause').addEventListener('click', pauseTimer);
  document.getElementById('btn-timer-reset').addEventListener('click', resetTimer);
  document.getElementById('btn-next-seg').addEventListener('click', nextSegment);
  document.getElementById('btn-prev-seg').addEventListener('click', prevSegment);

  const parkInput = document.getElementById('parking-input');
  document.getElementById('btn-add-parking').addEventListener('click', () => addParkingItem());
  parkInput.addEventListener('keydown', e => { if (e.key === 'Enter') addParkingItem(); });
}

function renderFacilitationView() {
  const meetingTitle = document.getElementById('fac-meeting-title');
  meetingTitle.textContent = document.getElementById('output-title')?.textContent || 'Live Facilitation';

  if (!state.generatedText) return;

  parseSegments();
  renderSegmentList();
  if (state.segments.length) showSegment(0);
}

function parseSegments() {
  const scriptSection = state.parsedSections['B'] || state.generatedText;
  const timeRegex     = /\*{0,2}(\d+:\d+)\s*[—\-–]\s*([^\n*]+)\*{0,2}/g;
  const raw           = scriptSection;
  const found         = [];
  let match;

  while ((match = timeRegex.exec(raw)) !== null) {
    found.push({ time: match[1], title: match[2].trim(), index: match.index });
  }

  state.segments = found.map((seg, i) => {
    const end   = found[i + 1] ? found[i + 1].index : raw.length;
    const body  = raw.slice(seg.index + match[0]?.length || seg.index, end).trim();
    return { time: seg.time, title: seg.title, body };
  });

  if (!state.segments.length) {
    state.segments = [{ time: '0:00', title: 'Full Script', body: scriptSection }];
  }

  document.getElementById('btn-next-seg').disabled = state.segments.length < 2;
  document.getElementById('btn-prev-seg').disabled = true;

  const durationMinutes = parseInt(document.querySelector('[name="duration"]')?.value || '60', 10);
  state.timer.total     = durationMinutes * 60;
  state.timer.remaining = durationMinutes * 60;
  updateTimerDisplay();
}

function renderSegmentList() {
  const list    = document.getElementById('segment-list');
  const counter = document.getElementById('segment-counter');
  list.innerHTML = '';
  counter.textContent = `0 / ${state.segments.length}`;

  state.segments.forEach((seg, i) => {
    const item = document.createElement('button');
    item.className = 'segment-item' + (i === 0 ? ' active' : '');
    item.innerHTML = `<span class="seg-time">${seg.time}</span><span>${seg.title}</span>`;
    item.addEventListener('click', () => showSegment(i));
    list.appendChild(item);
  });
}

function showSegment(index) {
  state.currentSegment = index;
  const seg = state.segments[index];
  if (!seg) return;

  document.querySelectorAll('.segment-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
    el.classList.toggle('done',   i < index);
  });

  const counter = document.getElementById('segment-counter');
  counter.textContent = `${index + 1} / ${state.segments.length}`;

  const scriptEl = document.getElementById('current-script');
  scriptEl.innerHTML = marked.parse(seg.body || `**${seg.time} — ${seg.title}**\n\nNo script text parsed for this segment.`);

  document.getElementById('btn-prev-seg').disabled = index === 0;
  document.getElementById('btn-next-seg').disabled = index >= state.segments.length - 1;
}

function nextSegment() { showSegment(Math.min(state.currentSegment + 1, state.segments.length - 1)); }
function prevSegment() { showSegment(Math.max(state.currentSegment - 1, 0)); }

/* ─── TIMER ──────────────────────────────────────────────── */
function startTimer() {
  if (state.timer.running) return;
  state.timer.running = true;
  document.getElementById('btn-timer-start').style.display = 'none';
  document.getElementById('btn-timer-pause').style.display = 'inline-block';
  state.timer.interval = setInterval(() => {
    state.timer.remaining = Math.max(0, state.timer.remaining - 1);
    updateTimerDisplay();
    if (state.timer.remaining === 0) pauseTimer();
  }, 1000);
}

function pauseTimer() {
  state.timer.running = false;
  clearInterval(state.timer.interval);
  document.getElementById('btn-timer-start').style.display = 'inline-block';
  document.getElementById('btn-timer-pause').style.display = 'none';
}

function resetTimer() {
  pauseTimer();
  state.timer.remaining = state.timer.total;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const m   = Math.floor(state.timer.remaining / 60);
  const s   = state.timer.remaining % 60;
  const str = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const el  = document.getElementById('timer-display');
  el.textContent = str;
  el.classList.toggle('warning', state.timer.remaining < 300 && state.timer.remaining > 0);
}

/* ─── PARKING LOT ────────────────────────────────────────── */
function addParkingItem() {
  const input = document.getElementById('parking-input');
  const text  = input.value.trim();
  if (!text) return;

  state.parkingLot.push(text);
  input.value = '';

  const container = document.getElementById('parking-lot-items');
  const item = document.createElement('div');
  item.className = 'parking-item';
  const idx = state.parkingLot.length - 1;
  item.innerHTML = `<span>${escapeHtml(text)}</span><button class="remove-btn" title="Remove">✕</button>`;
  item.querySelector('.remove-btn').addEventListener('click', () => {
    state.parkingLot.splice(idx, 1);
    item.remove();
  });
  container.appendChild(item);
}

/* ─── FOLLOW-THROUGH ─────────────────────────────────────── */
function wireFollowThrough() {
  document.getElementById('btn-clean-notes').addEventListener('click', async () => {
    const notes = document.getElementById('ft-notes').value.trim();
    if (!notes) { showToast('Paste your notes first.', 'error'); return; }

    const btn = document.getElementById('btn-clean-notes');
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Cleaning…';

    state.ftText = '';
    state.ftParsed = {};

    document.getElementById('ft-tabs').style.display = 'none';
    document.getElementById('ft-copy-bar').style.display = 'none';
    document.getElementById('ft-content').innerHTML = '<div id="ft-stream" class="stream-raw"></div>';
    document.getElementById('ft-streaming-bar').style.display = 'flex';

    await streamRequest(
      { mode: 'followthrough', notes },
      text => {
        state.ftText += text;
        const el = document.getElementById('ft-stream');
        if (el) el.textContent = state.ftText;
      },
      () => {
        document.getElementById('ft-streaming-bar').style.display = 'none';
        document.getElementById('ft-tabs').style.display = 'flex';
        document.getElementById('ft-copy-bar').style.display = 'flex';
        state.ftParsed = parseFtSections(state.ftText);
        activateFtSection('summary');
        btn.disabled = false;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Clean Up Notes';
      }
    );
  });

  document.getElementById('ft-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn) activateFtSection(btn.dataset.ftSection);
  });

  document.getElementById('btn-copy-ft-section').addEventListener('click', () => {
    copyText(state.ftParsed[state.ftActiveSection] || state.ftText);
  });
}

function parseFtSections(raw) {
  const map = {
    summary:   extractSection(raw, ['Clean Meeting Summary', 'Meeting Summary', 'Summary']),
    decisions: extractSection(raw, ['Final Decisions', 'Decisions']),
    actions:   extractSection(raw, ['Action Tracker', 'Actions']),
    email:     extractSection(raw, ['Follow-Up Email', 'Email Draft', 'Email']),
  };
  if (!map.summary && !map.decisions) map.summary = raw;
  return map;
}

function extractSection(raw, titles) {
  for (const title of titles) {
    const regex = new RegExp(`\\*{0,3}${title}\\*{0,3}[\\s\\S]*?(?=\\n\\*{0,3}(?:${['Clean Meeting Summary','Final Decisions','Action Tracker','Follow-Up Email','Email Draft'].join('|')})\\*{0,3}|$)`, 'i');
    const m = raw.match(regex);
    if (m) return m[0].trim();
  }
  return null;
}

function activateFtSection(key) {
  state.ftActiveSection = key;
  document.querySelectorAll('#ft-tabs .tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ftSection === key);
  });
  const content = document.getElementById('ft-content');
  const text    = state.ftParsed[key];
  if (!text) {
    content.innerHTML = `<p class="empty-state" style="padding:20px 0">Section not available.</p>`;
    return;
  }
  content.innerHTML = `<div class="markdown-body">${marked.parse(text)}</div>`;
}

/* ─── HISTORY ────────────────────────────────────────────── */
function saveToHistory(item) {
  state.history.unshift(item);
  if (state.history.length > 20) state.history = state.history.slice(0, 20);
  localStorage.setItem('adminHub_history', JSON.stringify(state.history));
}

function loadHistory() {
  try {
    const saved = localStorage.getItem('adminHub_history');
    state.history = saved ? JSON.parse(saved) : [];
  } catch { state.history = []; }
}

function renderHistoryPreview() {
  const container = document.getElementById('history-preview');
  if (!container) return;
  if (!state.history.length) {
    container.innerHTML = '<p class="empty-state">No PLCs yet. Generate your first one above.</p>';
    return;
  }
  container.innerHTML = state.history.slice(0, 3).map(item => historyItemHTML(item)).join('');
  container.querySelectorAll('.history-open-btn').forEach(btn => {
    btn.addEventListener('click', () => loadHistoryItem(+btn.dataset.id));
  });
}

function renderHistoryFull() {
  const container = document.getElementById('history-full-list');
  if (!state.history.length) {
    container.innerHTML = '<p class="empty-state">No saved PLCs.</p>';
    return;
  }
  container.innerHTML = state.history.map(item => historyItemHTML(item)).join('');
  container.querySelectorAll('.history-open-btn').forEach(btn => {
    btn.addEventListener('click', () => loadHistoryItem(+btn.dataset.id));
  });

  document.getElementById('btn-clear-history').addEventListener('click', () => {
    if (!confirm('Clear all saved PLCs?')) return;
    state.history = [];
    localStorage.removeItem('adminHub_history');
    renderHistoryFull();
    renderHistoryPreview();
    showToast('History cleared.');
  });
}

function historyItemHTML(item) {
  const d = new Date(item.date);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `
    <div class="history-item">
      <div class="history-item-info">
        <span class="history-item-title">${escapeHtml(item.title)}</span>
        <span class="history-item-meta">${escapeHtml(item.subtitle || '')} · ${dateStr}</span>
      </div>
      <div class="history-item-actions">
        <button class="btn-secondary history-open-btn" data-id="${item.id}">Open</button>
      </div>
    </div>`;
}

function loadHistoryItem(id) {
  const item = state.history.find(h => h.id === id);
  if (!item) return;

  state.generatedText  = item.text;
  state.parsedSections = item.sections || parseSections(item.text);

  document.getElementById('output-title').textContent   = item.title;
  document.getElementById('output-subtitle').textContent = item.subtitle || '';

  navigate('output');

  document.getElementById('output-tabs').style.display = 'flex';
  document.getElementById('section-copy-bar').style.display = 'flex';
  document.getElementById('streaming-indicator').style.display = 'none';

  activateSection('A');
  showToast('PLC loaded.');
}

function updateLastPLCLabel() {
  const last = state.history[0];
  const el   = document.getElementById('last-plc-label');
  if (last && el) {
    el.textContent = last.title + ' · ' + new Date(last.date).toLocaleDateString();
  }
}

/* ─── SETTINGS ───────────────────────────────────────────── */
function wireSettings() {
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
  document.getElementById('modal-close').addEventListener('click', closeSettings);
  document.getElementById('modal-settings').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettings();
  });
}
function openSettings() {
  document.getElementById('modal-settings').style.display = 'flex';
}
function closeSettings() {
  document.getElementById('modal-settings').style.display = 'none';
}
function saveSettings() {
  const prefs = {
    schoolLevel: document.getElementById('setting-school-level').value,
    department:  document.getElementById('setting-department').value,
    tone:        document.getElementById('setting-tone').value,
  };
  localStorage.setItem('adminHub_settings', JSON.stringify(prefs));
  closeSettings();
  showToast('Settings saved.', 'success');
}
function loadSettings() {
  try {
    const saved = localStorage.getItem('adminHub_settings');
    if (!saved) return;
    const prefs = JSON.parse(saved);
    if (prefs.schoolLevel) document.getElementById('setting-school-level').value = prefs.schoolLevel;
    if (prefs.department)  document.getElementById('setting-department').value  = prefs.department;
    if (prefs.tone)        document.getElementById('setting-tone').value        = prefs.tone;

    const form = document.getElementById('generate-form');
    if (prefs.schoolLevel && form) form.elements.schoolLevel.value = prefs.schoolLevel;
    if (prefs.department  && form) form.elements.department.value  = prefs.department;
    if (prefs.tone        && form) form.elements.leadershipTone.value = prefs.tone;
  } catch {}
}

/* ─── HELPERS ────────────────────────────────────────────── */
function setDateHeader() {
  const el = document.getElementById('header-date');
  if (el) {
    el.textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  }
}

function hasPII(text) {
  const patterns = [
    /\bstudent\s+(?:id|number|#)\s*:?\s*\d{3,}/i,
    /\b\d{3}-\d{2}-\d{4}\b/,
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+\s+(?:scored|earned|received|got)\b/,
  ];
  return patterns.some(p => p.test(text));
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard.', 'success'));
}

function copyChip(el) {
  navigator.clipboard.writeText(el.textContent.replace(/["""]/g, '')).then(() => {
    showToast('Phrase copied.', 'success');
  });
}

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.className = 'toast'; }, 2800);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ─── SPIN ANIMATION ─────────────────────────────────────── */
const style = document.createElement('style');
style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);

/* ─── CHAT ───────────────────────────────────────────────── */
function wireChat() {
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    sendBtn.disabled = !input.value.trim();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });

  sendBtn.addEventListener('click', sendChatMessage);

  document.getElementById('btn-clear-chat').addEventListener('click', clearChat);

  document.querySelectorAll('.prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.textContent;
      input.dispatchEvent(new Event('input'));
      sendChatMessage();
    });
  });
}

async function sendChatMessage() {
  if (state.chat.streaming) return;

  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  if (hasPII(text)) {
    showToast('Possible student PII detected. Please anonymize first.', 'error');
    return;
  }

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('chat-send').disabled = true;

  document.getElementById('chat-welcome')?.remove();

  state.chat.messages.push({ role: 'user', content: text });
  appendChatMessage('user', text);

  const typingEl = appendTypingIndicator();
  state.chat.streaming = true;
  state.chat.streamingEl = null;
  let aiText = '';

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.chat.messages }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || resp.statusText);
    }

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          finalizeChatMessage(aiText);
          state.chat.messages.push({ role: 'assistant', content: aiText });
          state.chat.streaming = false;
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) {
            if (firstChunk) { typingEl.remove(); firstChunk = false; }
            aiText += parsed.text;
            updateStreamingBubble(aiText);
          }
        } catch (parseErr) {
          if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr;
        }
      }
    }
  } catch (err) {
    typingEl?.remove();
    appendChatMessage('ai', `Sorry, something went wrong: ${err.message}`);
    showToast('Error: ' + err.message, 'error');
  } finally {
    state.chat.streaming = false;
    state.chat.streamingEl = null;
    document.getElementById('chat-send').disabled = false;
    scrollChatToBottom();
  }
}

function appendChatMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const initials = role === 'user' ? 'AP' : 'AI';

  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  msg.innerHTML = `
    <div class="msg-avatar">${initials}</div>
    <div class="msg-body">
      <div class="msg-bubble">${role === 'ai' ? `<div class="markdown-body">${marked.parse(text)}</div>` : escapeHtml(text)}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="msg-time">${time}</span>
        ${role === 'ai' ? `<div class="msg-actions"><button class="msg-copy-btn" onclick="copyText(${JSON.stringify(text)})"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button></div>` : ''}
      </div>
    </div>`;
  container.appendChild(msg);
  scrollChatToBottom();
  return msg;
}

function appendTypingIndicator() {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'typing-indicator';
  el.innerHTML = `
    <div class="msg-avatar" style="background:var(--navy);color:var(--gold);width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;flex-shrink:0;">AI</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>`;
  container.appendChild(el);
  scrollChatToBottom();
  return el;
}

function updateStreamingBubble(text) {
  if (!state.chat.streamingEl) {
    const container = document.getElementById('chat-messages');
    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const msg = document.createElement('div');
    msg.className = 'chat-msg ai';
    msg.innerHTML = `
      <div class="msg-avatar">AI</div>
      <div class="msg-body">
        <div class="msg-bubble streaming-cursor"><span class="stream-text"></span></div>
        <span class="msg-time">${time}</span>
      </div>`;
    container.appendChild(msg);
    state.chat.streamingEl = msg;
  }
  const span = state.chat.streamingEl.querySelector('.stream-text');
  if (span) span.textContent = text;
  scrollChatToBottom();
}

function finalizeChatMessage(text) {
  if (!state.chat.streamingEl) { appendChatMessage('ai', text); return; }
  const bubble = state.chat.streamingEl.querySelector('.msg-bubble');
  bubble.classList.remove('streaming-cursor');
  bubble.innerHTML = `<div class="markdown-body">${marked.parse(text)}</div>`;

  const time = state.chat.streamingEl.querySelector('.msg-time');
  const body = state.chat.streamingEl.querySelector('.msg-body');
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.innerHTML = `<button class="msg-copy-btn" onclick="copyText(${JSON.stringify(text)})"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>`;
  const timeWrap = document.createElement('div');
  timeWrap.style.cssText = 'display:flex;align-items:center;gap:6px';
  timeWrap.appendChild(time.cloneNode(true));
  timeWrap.appendChild(actions);
  time.replaceWith(timeWrap);
}

function clearChat() {
  state.chat.messages = [];
  state.chat.streamingEl = null;
  const container = document.getElementById('chat-messages');
  container.innerHTML = `
    <div class="chat-welcome" id="chat-welcome">
      <div class="welcome-avatar">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      </div>
      <h3>Admin AI Hub</h3>
      <p>Your PLC planning partner. Ask me anything — I'll build agendas, write scripts, clean up notes, and help you lead better meetings.</p>
      <div class="suggested-prompts">
        <button class="prompt-chip">Generate this week's PLC for English 9</button>
        <button class="prompt-chip">Write a follow-up email from today's meeting</button>
        <button class="prompt-chip">My teachers disagree on what "proficient" means — help</button>
        <button class="prompt-chip">Give me a 60-min reteach planning agenda</button>
        <button class="prompt-chip">What equity questions should I ask in my PLC?</button>
        <button class="prompt-chip">How do I handle a teacher who dominates discussion?</button>
      </div>
    </div>`;
  document.querySelectorAll('.prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('chat-input');
      input.value = chip.textContent;
      input.dispatchEvent(new Event('input'));
      sendChatMessage();
    });
  });
  document.getElementById('chat-send').disabled = true;
  showToast('Chat cleared.');
}

function scrollChatToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}
