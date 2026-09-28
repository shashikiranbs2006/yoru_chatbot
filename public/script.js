/* ============================================================
   RAG Learning Assistant — script.js
   Full frontend logic: auth, chat, upload, animations
   ============================================================ */

'use strict';

// ── CONFIG ──────────────────────────────────────────────────
// Automatically use same-origin (empty string) whenever loaded over HTTP/HTTPS (e.g. Vercel, localhost).
// Falls back to http://localhost:4000 only if opened directly from local filesystem (file://).
const API_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ? '' 
  : 'http://localhost:4000';

// ── STATE ───────────────────────────────────────────────────
let isWaiting          = false;
let uploadedCollection = null;
let uploadedFileName   = null;
let currentUser        = null;   // { displayName, email, photo }
let chatHistory        = [];     // local in-memory history
let currentSessionId   = null;
let pdfZoomLevel       = 100;
let isDarkTheme        = true;

// Orb parallax state
let orbTargetX = 0, orbTargetY = 0;
let orbCurrentX = 0, orbCurrentY = 0;
let orbRafId = null;

// ── DOM REFS ─────────────────────────────────────────────────
const loginPage          = document.getElementById('loginPage');
const chatPage           = document.getElementById('chatPage');
const animatedOrb        = document.getElementById('animatedOrb');
const particlesContainer = document.getElementById('particles');

// Login
const btnLoginGoogle = document.getElementById('btnLoginGoogle');
const btnContinue    = document.getElementById('btnContinue');
const loginSpinner   = document.getElementById('loginSpinner');

// Header
const themeToggleBtn  = document.getElementById('themeToggleBtn');
const themeIconMoon   = document.getElementById('themeIconMoon');
const themeIconSun    = document.getElementById('themeIconSun');
const profileBtn      = document.getElementById('profileBtn');
const profileDropdown = document.getElementById('profileDropdown');
const dropdownName    = document.getElementById('dropdownName');
const dropdownEmail   = document.getElementById('dropdownEmail');
const dropdownThemeToggle = document.getElementById('dropdownThemeToggle');
const logoutBtn       = document.getElementById('logoutBtn');

// Layout
const appLayout    = document.getElementById('appLayout');
const leftPanel    = document.getElementById('leftPanel');
const middlePanel  = document.getElementById('middlePanel');

// Sidebar
const newChatBtn              = document.getElementById('newChatBtn');
const sidebarSearch           = document.getElementById('sidebarSearch');
const chatHistoryList         = document.getElementById('chatHistoryList');
const chatHistoryEmpty        = document.getElementById('chatHistoryEmpty');
const relatedQuestionsSection = document.getElementById('relatedQuestionsSection');
const relatedQuestionsList    = document.getElementById('relatedQuestionsList');
const loadMoreQuestionsBtn    = document.getElementById('loadMoreQuestionsBtn');

// PDF viewer
const pdfFilename  = document.getElementById('pdfFilename');
const pdfIframe    = document.getElementById('pdfIframe');
const pdfBackBtn   = document.getElementById('pdfBackBtn');
const pdfCloseBtn  = document.getElementById('pdfCloseBtn');
const pdfPageInfo  = document.getElementById('pdfPageInfo');
const pdfZoomVal   = document.getElementById('pdfZoomVal');
const pdfZoomIn    = document.getElementById('pdfZoomIn');
const pdfZoomOut   = document.getElementById('pdfZoomOut');

// Chat
const chatBox        = document.getElementById('chatBox');
const chatWelcome    = document.getElementById('chatWelcome');
const scrollBottomBtn = document.getElementById('scrollBottomBtn');

// Input
const chatInput       = document.getElementById('q');
const sendBtn         = document.getElementById('sendBtn');
const attachBtn       = document.getElementById('attachBtn');
const hiddenUpload    = document.getElementById('hiddenUploadInput');
const inputWrapper    = document.getElementById('inputWrapper');
const dragOverlay     = document.getElementById('dragOverlay');
const uploadProgress  = document.getElementById('uploadProgress');
const uploadProgressBar   = document.getElementById('uploadProgressBar');
const uploadProgressLabel = document.getElementById('uploadProgressLabel');
const inputFileBadge  = document.getElementById('inputFileBadge');
const inputFileLabel  = document.getElementById('inputFileLabel');
const removePdfBtn    = document.getElementById('removePdfBtn');


// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
(async function init() {
  // Restore theme first (prevents flash)
  loadTheme();

  // Kick off login page animations
  createParticles();
  initOrbMouseTracking();

  // If redirected with ?guest=true, auto-transition to chat
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('guest') === 'true') {
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    await transitionToChatPage();
    return;
  }

  // Check if user is already authenticated
  const alreadyAuthed = await checkAuth();

  if (alreadyAuthed) {
    // User is logged in — skip login page, go straight to chat
    await transitionToChatPage();
  }
  // Otherwise, login page stays visible and user clicks login
})();


// ═══════════════════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════════════════
function loadTheme() {
  const saved = localStorage.getItem('yoru-theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  isDarkTheme = theme === 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  // Swap icons
  if (themeIconMoon && themeIconSun) {
    themeIconMoon.classList.toggle('hidden', !isDarkTheme);
    themeIconSun.classList.toggle('hidden', isDarkTheme);
  }
  localStorage.setItem('yoru-theme', theme);
}

function toggleTheme() {
  applyTheme(isDarkTheme ? 'light' : 'dark');
}

themeToggleBtn?.addEventListener('click', toggleTheme);
dropdownThemeToggle?.addEventListener('click', () => { toggleTheme(); closeProfileDropdown(); });


// ═══════════════════════════════════════════════════════════
//  AUTHENTICATION
// ═══════════════════════════════════════════════════════════
async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/user`, { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.authenticated && data.user) {
      currentUser = data.user;
      updateProfileUI(data.user);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function updateProfileUI(user) {
  if (!user) return;
  const name  = user.displayName || 'User';
  const email = user.email || '';
  const photo = user.photo || '';

  if (dropdownName)  dropdownName.textContent  = name;
  if (dropdownEmail) dropdownEmail.textContent = email;

  // Update avatar elements with photo if available
  if (photo) {
    ['dropdownAvatar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = `<img src="${photo}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      }
    });
    const profileAvatar = document.getElementById('profileAvatar');
    if (profileAvatar) {
      profileAvatar.innerHTML = `<img src="${photo}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    }
  } else {
    // Show initials
    const initials = name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
    const profileAvatar = document.getElementById('profileAvatar');
    if (profileAvatar) profileAvatar.innerHTML = `<span style="font-size:12px;font-weight:700;color:white;">${initials}</span>`;
  }
}

// Login with Google
function loginWithGoogle() {
  btnLoginGoogle.classList.add('loading');
  setTimeout(() => {
    window.location.href = `${API_BASE}/auth/google`;
  }, 600);
}

// Continue without login
async function continueWithoutLogin() {
  btnLoginGoogle?.classList.add('loading');
  btnContinue?.classList.add('loading');
  await transitionToChatPage();
}

async function logout() {
  try {
    await fetch(`${API_BASE}/auth/logout`);
  } catch {}
  currentUser = null;
  // Return to login page
  chatPage.classList.remove('visible');
  chatPage.classList.add('hidden');
  loginPage.classList.remove('exiting');
  loginPage.style.display = '';
  btnLoginGoogle?.classList.remove('loading');
  btnContinue?.classList.remove('loading');
}

logoutBtn?.addEventListener('click', logout);


// ═══════════════════════════════════════════════════════════
//  PAGE TRANSITIONS
// ═══════════════════════════════════════════════════════════
async function transitionToChatPage() {
  // Fade out login page
  loginPage.classList.add('exiting');

  await sleep(500);
  loginPage.style.display = 'none';

  // Show chat page
  chatPage.classList.remove('hidden');

  // Trigger visible with slight delay for animation
  await sleep(20);
  chatPage.classList.add('visible');

  // Animate sidebar in
  await sleep(150);
  leftPanel.classList.add('visible');
  appLayout.classList.add('has-sidebar');

  // Load chat history from server
  await loadChatHistory();

  // Focus input
  chatInput?.focus();
}


// ═══════════════════════════════════════════════════════════
//  PROFILE DROPDOWN
// ═══════════════════════════════════════════════════════════
profileBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = profileDropdown.classList.contains('open');
  if (isOpen) {
    closeProfileDropdown();
  } else {
    openProfileDropdown();
  }
});

document.addEventListener('click', () => closeProfileDropdown());

function openProfileDropdown() {
  profileDropdown.classList.remove('hidden');
  requestAnimationFrame(() => profileDropdown.classList.add('open'));
  profileBtn.setAttribute('aria-expanded', 'true');
}

function closeProfileDropdown() {
  profileDropdown.classList.remove('open');
  profileBtn.setAttribute('aria-expanded', 'false');
  setTimeout(() => {
    if (!profileDropdown.classList.contains('open')) {
      profileDropdown.classList.add('hidden');
    }
  }, 200);
}

profileDropdown?.addEventListener('click', e => e.stopPropagation());


// ═══════════════════════════════════════════════════════════
//  ORB MOUSE PARALLAX
// ═══════════════════════════════════════════════════════════
function initOrbMouseTracking() {
  if (!animatedOrb) return;

  document.addEventListener('mousemove', (e) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    orbTargetX = ((e.clientX - cx) / cx) * -80;
    orbTargetY = ((e.clientY - cy) / cy) * -50;
  });

  function animateOrb() {
    orbCurrentX += (orbTargetX - orbCurrentX) * 0.08;
    orbCurrentY += (orbTargetY - orbCurrentY) * 0.08;
    // We use a wrapper approach to not conflict with CSS keyframe transforms
    animatedOrb.style.marginLeft  = `${orbCurrentX}px`;
    animatedOrb.style.marginTop   = `${orbCurrentY}px`;
    orbRafId = requestAnimationFrame(animateOrb);
  }

  animateOrb();
}


// ═══════════════════════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════════════════════
function createParticles() {
  if (!particlesContainer) return;
  const count = 28;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const duration = 15 + Math.random() * 14;
    const delay    = -duration * Math.random();
    const xOffset  = (Math.random() - 0.5) * 180;
    const size     = 4 + Math.random() * 6;
    const leftPct  = Math.random() * 85 + 5;
    const opacity  = 0.3 + Math.random() * 0.5;

    p.style.setProperty('--px', `${xOffset}px`);
    p.style.left              = `${leftPct}%`;
    p.style.bottom            = '0';
    p.style.width             = `${size}px`;
    p.style.height            = `${size}px`;
    p.style.opacity           = opacity;
    p.style.animationDuration = `${duration}s`;
    p.style.animationDelay    = `${delay}s`;

    particlesContainer.appendChild(p);
  }
}


// ═══════════════════════════════════════════════════════════
//  CHAT HISTORY (server)
// ═══════════════════════════════════════════════════════════
async function loadChatHistory() {
  try {
    const res = await fetch(`${API_BASE}/chatHistory?limit=20`);
    if (!res.ok) throw new Error('No history');
    const data = await res.json();

    currentSessionId = `session_${Date.now()}`;

    if (data.messages && data.messages.length > 0) {
      // Render last 5 messages in chat
      const recent = data.messages.slice(-5);
      hideWelcome();
      for (const msg of recent) {
        appendUserMessage(msg.question);
        appendBotMessage(formatMarkdown(msg.answer), null, false);
      }
      scrollToBottom();

      // Populate sidebar history
      renderSidebarHistory(data.messages);
    } else {
      renderSidebarHistory([]);
    }
  } catch {
    currentSessionId = `session_${Date.now()}`;
    renderSidebarHistory([]);
  }
}

function renderSidebarHistory(messages) {
  if (!chatHistoryList) return;
  chatHistoryList.innerHTML = '';

  // Group by sessionId or just show each message
  if (!messages || messages.length === 0) {
    chatHistoryList.appendChild(createEl('div', { className: 'sidebar-empty' }, 'No chats yet. Start a conversation!'));
    return;
  }

  // Show unique previews (by first question in group)
  const seen = new Set();
  messages.slice().reverse().forEach(msg => {
    if (seen.has(msg.question.slice(0, 40))) return;
    seen.add(msg.question.slice(0, 40));

    const item = createEl('div', { className: 'chat-history-item', title: msg.question });
    const icon = createEl('div', { className: 'chat-history-icon' }, '💬');
    const info = createEl('div', { className: 'chat-history-info' });
    const preview = createEl('div', { className: 'chat-history-preview' },
      msg.question.length > 48 ? msg.question.slice(0, 48) + '…' : msg.question
    );
    const time = createEl('div', { className: 'chat-history-time' },
      msg.createdAt ? formatTime(new Date(msg.createdAt)) : ''
    );

    info.append(preview, time);
    item.append(icon, info);
    item.addEventListener('click', () => {
      chatInput.value = msg.question;
      chatInput.focus();
    });

    chatHistoryList.appendChild(item);
  });
}

async function saveChatMessage(question, answer, sourceLabel, sourceFrom, collectionName) {
  try {
    await fetch(`${API_BASE}/saveChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer, sourceLabel, sourceFrom, collectionName, sessionId: currentSessionId })
    });
  } catch {}
}

async function clearAllHistory() {
  if (!confirm('Delete ALL chat history? This cannot be undone.')) return;
  try {
    await fetch(`${API_BASE}/chatHistory`, { method: 'DELETE' });
    startNewChat();
  } catch {
    showError('Failed to clear history.');
  }
}


// ═══════════════════════════════════════════════════════════
//  NEW CHAT
// ═══════════════════════════════════════════════════════════
newChatBtn?.addEventListener('click', startNewChat);

function startNewChat() {
  chatBox.innerHTML = '';
  chatHistory = [];
  uploadedCollection = null;
  uploadedFileName   = null;
  currentSessionId   = `session_${Date.now()}`;

  // Hide file badge
  inputFileBadge?.classList.add('hidden');
  if (inputFileLabel) inputFileLabel.textContent = '';

  // Close PDF viewer
  hidePDFViewer();

  // Show welcome
  showWelcome();

  chatInput?.focus();
}


// ═══════════════════════════════════════════════════════════
//  FILE UPLOAD
// ═══════════════════════════════════════════════════════════
attachBtn?.addEventListener('click', () => hiddenUpload?.click());
hiddenUpload?.addEventListener('change', handleFileUpload);
removePdfBtn?.addEventListener('click', () => {
  uploadedCollection = null;
  uploadedFileName   = null;
  inputFileBadge?.classList.add('hidden');
  if (hiddenUpload) hiddenUpload.value = '';
  hidePDFViewer();
});

// Drag & drop
const rightPanel = document.getElementById('rightPanel');
rightPanel?.addEventListener('dragenter', (e) => { e.preventDefault(); dragOverlay?.classList.remove('hidden'); });
rightPanel?.addEventListener('dragover',  (e) => { e.preventDefault(); });
rightPanel?.addEventListener('dragleave', (e) => {
  if (!rightPanel.contains(e.relatedTarget)) dragOverlay?.classList.add('hidden');
});
rightPanel?.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragOverlay?.classList.add('hidden');
  const file = e.dataTransfer?.files?.[0];
  if (file) await uploadFile(file);
});

async function handleFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  await uploadFile(file);
  if (hiddenUpload) hiddenUpload.value = '';
}

async function uploadFile(file) {
  // Validate
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    showError(`File too large (max 50MB). Yours is ${(file.size/1024/1024).toFixed(1)}MB.`);
    return;
  }
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf','txt','docx'].includes(ext)) {
    showError('Only PDF, TXT, and DOCX files are supported.');
    return;
  }

  // Show progress
  uploadProgress?.classList.remove('hidden');
  setUploadProgress(0, `Uploading ${file.name}…`);
  attachBtn.disabled = true;

  // Fake progress animation (real progress not available from fetch)
  let fakeProgress = 0;
  const fakeInterval = setInterval(() => {
    fakeProgress = Math.min(fakeProgress + 4, 88);
    setUploadProgress(fakeProgress, 'Processing…');
  }, 150);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData
    });

    clearInterval(fakeInterval);

    if (!res.ok) {
      let msg = 'Upload failed';
      try { const d = await res.json(); msg = d.error || msg; } catch {}
      throw new Error(msg);
    }

    const data = await res.json();

    // Animate to 100%
    setUploadProgress(100, '✓ Done!');
    await sleep(800);
    uploadProgress?.classList.add('hidden');
    setUploadProgress(0, '');

    uploadedCollection = data.collectionName;
    uploadedFileName   = data.fileName || file.name;

    // Show badge
    if (inputFileLabel) inputFileLabel.textContent = uploadedFileName;
    inputFileBadge?.classList.remove('hidden');

    // Show PDF in viewer
    if (ext === 'pdf') showPDFViewer(file, uploadedFileName);

    // Append success message
    hideWelcome();
    const msgHtml = `
      <p>✅ <strong>${uploadedFileName}</strong> uploaded successfully!</p>
      ${data.embeddedCount ? `<p style="margin-top:6px;font-size:13px;opacity:0.8;">📊 Processed <strong>${data.embeddedCount} chunks</strong> — ready for questions.</p>` : ''}
      <p style="margin-top:6px;">Ask me anything about this file!</p>
    `;
    appendBotMessage(msgHtml);
    scrollToBottom();

    // Fetch related questions if returned
    if (data.questions && data.questions.length > 0) {
      renderRelatedQuestions(data.questions);
    }

  } catch (err) {
    clearInterval(fakeInterval);
    uploadProgress?.classList.add('hidden');
    attachBtn.disabled = false;
    showError(err.message || 'Upload failed. Please try again.');
  }

  attachBtn.disabled = false;
}

function setUploadProgress(pct, label) {
  if (uploadProgressBar)   uploadProgressBar.style.width = pct + '%';
  if (uploadProgressLabel) uploadProgressLabel.textContent = label;
}


// ═══════════════════════════════════════════════════════════
//  PDF VIEWER
// ═══════════════════════════════════════════════════════════
function showPDFViewer(file, name) {
  // Create object URL for the file
  const url = URL.createObjectURL(file);
  if (pdfIframe)   pdfIframe.src = url;
  if (pdfFilename) pdfFilename.textContent = name || 'document.pdf';
  if (pdfPageInfo) pdfPageInfo.textContent = 'Page 1';
  pdfZoomLevel = 100;
  if (pdfZoomVal) pdfZoomVal.textContent = '100%';

  middlePanel?.classList.remove('hidden');
  appLayout?.classList.add('has-pdf');
}

function hidePDFViewer() {
  middlePanel?.classList.add('hidden');
  appLayout?.classList.remove('has-pdf');
  if (pdfIframe) pdfIframe.src = '';
}

pdfBackBtn?.addEventListener('click',  hidePDFViewer);
pdfCloseBtn?.addEventListener('click', hidePDFViewer);

pdfZoomIn?.addEventListener('click', () => {
  pdfZoomLevel = Math.min(200, pdfZoomLevel + 20);
  if (pdfZoomVal) pdfZoomVal.textContent = pdfZoomLevel + '%';
  if (pdfIframe)  pdfIframe.style.transform = `scale(${pdfZoomLevel/100})`;
  if (pdfIframe)  pdfIframe.style.transformOrigin = 'top left';
});

pdfZoomOut?.addEventListener('click', () => {
  pdfZoomLevel = Math.max(50, pdfZoomLevel - 20);
  if (pdfZoomVal) pdfZoomVal.textContent = pdfZoomLevel + '%';
  if (pdfIframe)  pdfIframe.style.transform = `scale(${pdfZoomLevel/100})`;
  if (pdfIframe)  pdfIframe.style.transformOrigin = 'top left';
});


// ═══════════════════════════════════════════════════════════
//  RELATED QUESTIONS
// ═══════════════════════════════════════════════════════════
function renderRelatedQuestions(questions) {
  if (!relatedQuestionsList || !relatedQuestionsSection) return;
  relatedQuestionsList.innerHTML = '';
  relatedQuestionsSection.style.display = 'flex';

  questions.slice(0, 10).forEach(q => {
    const item = createEl('button', { className: 'related-question-item' });
    item.innerHTML = `<span class="rq-icon">❓</span><span>${q}</span>`;
    item.addEventListener('click', () => askChatPrefill(q));
    relatedQuestionsList.appendChild(item);
  });
}


// ═══════════════════════════════════════════════════════════
//  SIDEBAR SEARCH
// ═══════════════════════════════════════════════════════════
sidebarSearch?.addEventListener('input', debounce(() => {
  const q = sidebarSearch.value.toLowerCase().trim();
  document.querySelectorAll('.chat-history-item').forEach(item => {
    const text = item.querySelector('.chat-history-preview')?.textContent?.toLowerCase() || '';
    item.style.display = text.includes(q) ? '' : 'none';
  });
  document.querySelectorAll('.related-question-item').forEach(item => {
    const text = item.textContent?.toLowerCase() || '';
    item.style.display = text.includes(q) ? '' : 'none';
  });
}, 200));


// ═══════════════════════════════════════════════════════════
//  MAIN CHAT FUNCTION
// ═══════════════════════════════════════════════════════════
async function askChat(prefill) {
  if (isWaiting) return;

  const q = (prefill ?? chatInput?.value ?? '').trim();
  if (!q) {
    inputWrapper?.classList.add('shake');
    setTimeout(() => inputWrapper?.classList.remove('shake'), 400);
    return;
  }

  if (!prefill && chatInput) chatInput.value = '';

  hideWelcome();
  appendUserMessage(q);
  chatHistory.push(q);
  scrollToBottom();

  isWaiting = true;
  if (sendBtn) sendBtn.disabled = true;

  const typingEl = showTypingIndicator();

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, collectionName: uploadedCollection })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} — ${text}`);
    }

    const data = await res.json();
    removeTypingIndicator(typingEl);

    const formatted = formatMarkdown(data.answer || 'No answer provided.');
    // Use sources array if available, otherwise fall back to single source
    await appendBotMessageStreamed(formatted, data.source_link, data.source_label, data.sources || null);

    // Save
    if (data.answer) {
      saveChatMessage(q, data.answer, data.source_label, data.source_from, uploadedCollection);
    }

    // Render question list
    if (data.questions && data.questions.length > 0) {
      renderQuestionListInChat(data.questions);
      renderRelatedQuestions(data.questions);
    }

    scrollToBottom();

  } catch (err) {
    removeTypingIndicator(typingEl);
    showError(err.message || 'Something went wrong. Please try again.');
  } finally {
    isWaiting = false;
    if (sendBtn) sendBtn.disabled = false;
    resizeTextarea();
  }
}

function askChatPrefill(q) {
  askChat(q);
}


// ═══════════════════════════════════════════════════════════
//  MESSAGE RENDERING
// ═══════════════════════════════════════════════════════════
function hideWelcome() {
  if (chatWelcome) chatWelcome.style.display = 'none';
}

function showWelcome() {
  chatBox.innerHTML = '';
  if (chatWelcome) {
    chatBox.appendChild(chatWelcome);
    chatWelcome.style.display = '';
  }
}

function appendUserMessage(text) {
  const row = createEl('div', { className: 'message-row user-row' });

  const avatarEl = createEl('div', { className: 'message-avatar user-avatar' });
  if (currentUser?.displayName) {
    avatarEl.textContent = currentUser.displayName.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  } else {
    avatarEl.textContent = 'U';
  }

  const group  = createEl('div', { className: 'message-bubble-group' });
  const bubble = createEl('div', { className: 'message-bubble user-bubble' });
  bubble.textContent = text;

  const time = createEl('div', { className: 'message-time' });
  time.textContent = formatTime(new Date());

  group.append(bubble, time);
  row.append(group, avatarEl);
  chatBox.appendChild(row);
}

function appendBotMessage(html, sourceLink, animate = true) {
  const row = createEl('div', { className: 'message-row' });

  const avatarEl = createEl('div', { className: 'message-avatar bot-avatar' });
  avatarEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const group  = createEl('div', { className: 'message-bubble-group' });
  const bubble = createEl('div', { className: 'message-bubble bot-bubble' });
  bubble.innerHTML = html;

  // Source link
  if (sourceLink) {
    const chip = createEl('a', {
      className: 'msg-source-chip',
      href: sourceLink,
      target: '_blank',
      rel: 'noopener noreferrer'
    });
    chip.innerHTML = `<svg viewBox="0 0 16 16" fill="none" style="width:12px;height:12px"><path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg> View Source PDF`;
    bubble.appendChild(chip);
  }

  const time = createEl('div', { className: 'message-time' });
  time.textContent = formatTime(new Date());

  group.append(bubble, time);
  row.append(avatarEl, group);

  if (animate) {
    row.style.opacity = '0';
    chatBox.appendChild(row);
    requestAnimationFrame(() => { row.style.opacity = ''; });
  } else {
    chatBox.appendChild(row);
  }

  return bubble;
}

async function appendBotMessageStreamed(html, sourceLink, sourceLabel, sources) {
  // Create the row structure
  const row = createEl('div', { className: 'message-row' });

  const avatarEl = createEl('div', { className: 'message-avatar bot-avatar' });
  avatarEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const group  = createEl('div', { className: 'message-bubble-group' });
  const bubble = createEl('div', { className: 'message-bubble bot-bubble' });
  const time   = createEl('div', { className: 'message-time' });
  time.textContent = formatTime(new Date());

  group.append(bubble, time);
  row.append(avatarEl, group);
  chatBox.appendChild(row);

  // Stream the HTML content character by character into the bubble
  await streamHTMLContent(bubble, html);

  // Add source links after streaming
  // If sources array is provided and has items, show all sources
  if (sources && Array.isArray(sources) && sources.length > 0) {
    const sourcesContainer = createEl('div', { className: 'sources-container' });
    
    sources.forEach((source, index) => {
      if (source && source.drive_link) {
        const chip = createEl('a', {
          className: 'msg-source-chip',
          href: source.drive_link,
          target: '_blank',
          rel: 'noopener noreferrer'
        });
        // Extract a shorter filename from the label
        const shortLabel = source.label ? source.label.split('/').pop().replace('.pdf', '') : `Source ${index + 1}`;
        chip.innerHTML = `<svg viewBox="0 0 16 16" fill="none" style="width:12px;height:12px"><path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg> ${shortLabel}`;
        chip.title = source.label || ''; // Show full path on hover
        sourcesContainer.appendChild(chip);
      }
    });
    
    if (sourcesContainer.children.length > 0) {
      bubble.appendChild(sourcesContainer);
    }
  } 
  // Fallback to single source link (backward compatibility)
  else if (sourceLink) {
    const chip = createEl('a', {
      className: 'msg-source-chip',
      href: sourceLink,
      target: '_blank',
      rel: 'noopener noreferrer'
    });
    chip.innerHTML = `<svg viewBox="0 0 16 16" fill="none" style="width:12px;height:12px"><path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg> ${sourceLabel || 'View Source PDF'}`;
    bubble.appendChild(chip);
  }
}

/**
 * Stream HTML content into an element, character-by-character for plain text
 * but renders HTML tags instantly (so formatting works).
 */
async function streamHTMLContent(el, html) {
  // Use a temporary container to parse the HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Stream all text nodes, render block tags normally
  await streamNode(el, temp);
}

async function streamNode(target, source) {
  for (const node of Array.from(source.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Stream text characters
      await streamText(target, node.textContent);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Clone the element (without children) and append
      const clone = document.createElement(node.tagName);
      // Copy attributes
      for (const attr of node.attributes) {
        clone.setAttribute(attr.name, attr.value);
      }
      target.appendChild(clone);
      // Recurse into children
      await streamNode(clone, node);
    }
  }
}

async function streamText(el, text) {
  const CHAR_DELAY = 18; // ms per character
  for (const char of text) {
    const span = document.createElement('span');
    span.className = 'streamed-char';
    span.textContent = char;
    el.appendChild(span);
    scrollToBottom();
    await sleep(CHAR_DELAY);
  }
}

function showTypingIndicator() {
  const row = createEl('div', { className: 'message-row', id: 'typingRow' });
  const avatarEl = createEl('div', { className: 'message-avatar bot-avatar' });
  avatarEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const group = createEl('div', { className: 'message-bubble-group' });
  const indicator = createEl('div', { className: 'typing-indicator' });
  indicator.innerHTML = `
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  `;
  group.appendChild(indicator);
  row.append(avatarEl, group);
  chatBox.appendChild(row);
  scrollToBottom();
  return row;
}

function removeTypingIndicator(el) {
  el?.remove();
}

function renderQuestionListInChat(questions) {
  const row = createEl('div', { className: 'message-row' });

  const avatarEl = createEl('div', { className: 'message-avatar bot-avatar' });
  avatarEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const group = createEl('div', { className: 'message-bubble-group' });
  const list  = createEl('div', { className: 'question-list-bubble' });

  const label = createEl('div', { style: 'font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:600;' });
  label.textContent = '💡 Related questions:';
  list.appendChild(label);

  questions.slice(0, 5).forEach((q, i) => {
    const btn = createEl('button', { className: 'question-item' });
    btn.textContent = `${i+1}. ${q}`;
    btn.addEventListener('click', () => askChat(q));
    list.appendChild(btn);
  });

  group.appendChild(list);
  row.append(avatarEl, group);
  chatBox.appendChild(row);
  scrollToBottom();
}

function showError(msg) {
  const row = createEl('div', { className: 'message-row' });
  const avatarEl = createEl('div', { className: 'message-avatar bot-avatar' });
  avatarEl.style.background = 'linear-gradient(135deg,#ef4444,#dc2626)';
  avatarEl.innerHTML = `<span style="font-size:14px;">!</span>`;

  const group = createEl('div', { className: 'message-bubble-group' });
  const bubble = createEl('div', { className: 'message-bubble bot-bubble' });
  bubble.style.borderColor = 'rgba(239,68,68,0.3)';
  bubble.innerHTML = `<strong style="color:#ef4444;">Error:</strong> ${escapeHtml(msg)}`;

  group.appendChild(bubble);
  row.append(avatarEl, group);
  chatBox.appendChild(row);
  scrollToBottom();
}


// ═══════════════════════════════════════════════════════════
//  SCROLL
// ═══════════════════════════════════════════════════════════
function scrollToBottom(smooth = true) {
  chatBox?.scrollTo({ top: chatBox.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

chatBox?.addEventListener('scroll', () => {
  if (!scrollBottomBtn) return;
  const distFromBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight;
  scrollBottomBtn.style.display = distFromBottom > 120 ? 'flex' : 'none';
});

scrollBottomBtn?.addEventListener('click', () => scrollToBottom(true));


// ═══════════════════════════════════════════════════════════
//  MARKDOWN FORMATTER
// ═══════════════════════════════════════════════════════════
function formatMarkdown(text) {
  if (!text) return '';
  let out = text;

  // Code blocks (``` ... ```)
  out = out.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang || 'text'}">${escapeHtml(code.trim())}</code></pre>`
  );

  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold **text**
  out = out.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Bold *text*
  out = out.replace(/\*(.*?)\*/g, '<strong>$1</strong>');

  // Bullet list lines  → li
  out = out.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');

  // Numbered list
  out = out.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive li tags
  out = out.replace(/(<li>[\s\S]*?<\/li>)(\n<li>|$)/g, (m) => m);
  out = out.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Double newlines → paragraphs
  out = out.replace(/\n{2,}/g, '<br><br>');
  out = out.replace(/\n/g, '<br>');

  return out.trim();
}


// ═══════════════════════════════════════════════════════════
//  INPUT EVENTS
// ═══════════════════════════════════════════════════════════
chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    askChat();
  }
});

chatInput?.addEventListener('input', resizeTextarea);

sendBtn?.addEventListener('click', () => askChat());

function resizeTextarea() {
  if (!chatInput) return;
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
}


// ═══════════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════════
function createEl(tag, props = {}, textContent = '') {
  const el = document.createElement(tag);
  Object.assign(el, props);
  if (props.style && typeof props.style === 'string') el.setAttribute('style', props.style);
  if (textContent) el.textContent = textContent;
  return el;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(date) {
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m} ${ampm}`;
}

// Expose global for inline onclick handlers
window.loginWithGoogle    = loginWithGoogle;
window.continueWithoutLogin = continueWithoutLogin;
window.askChatPrefill     = askChatPrefill;
