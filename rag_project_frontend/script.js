// ==========================================
// CONFIG
// ==========================================
const backendURL = "http://localhost:4000/chat";

// ==========================================
// UI REFERENCES
// ==========================================
const chatBox = document.getElementById("chatBox");
const inputEl = document.getElementById("q");
const sendBtn = document.getElementById("sendBtn");
const clearChatBtn = document.getElementById("clearChatBtn");
const suggestedPromptsEl = document.getElementById("suggestedPrompts");
const historyListEl = document.getElementById("historyList");
const scrollBottomBtn = document.getElementById("scrollBottomBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const plusBtn = document.getElementById("plusBtn");

let chatHistory = [];
let isWaiting = false;

// ==========================================
// THEME
// ==========================================
if (localStorage.getItem("theme") === "light") {
  document.documentElement.classList.add("light");
  themeToggleBtn.textContent = "☀️";
} else {
  themeToggleBtn.textContent = "🌙";
}

// ==========================================
// FORMAT ANSWER (NO HTML ESCAPE)
// ==========================================
function formatAnswer(text) {
  if (!text) return "";

  let out = text;

  // Bold
  out = out.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Bullet list
  out = out.replace(/^\* (.*)$/gm, "<li>$1</li>");

  // Numbered list
  out = out.replace(/^\d+\. (.*)$/gm, "<li>$1</li>");

  // Wrap in <ul>
  out = out.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");

  // Newlines
  out = out.replace(/\n{2,}/g, "<br><br>");
  out = out.replace(/\n/g, "<br>");

  return out.trim();
}

// ==========================================
// UI HELPERS
// ==========================================
function appendUser(text) {
  const d = document.createElement("div");
  d.className = "msg msg-user";
  d.textContent = text;
  chatBox.appendChild(d);
}

function appendBot(html) {
  const d = document.createElement("div");
  d.className = "msg msg-bot";
  d.innerHTML = html;
  chatBox.appendChild(d);
}

function appendError(msg) {
  const d = document.createElement("div");
  d.className = "msg msg-bot";
  d.innerHTML = `<strong>Error:</strong> ${msg}`;
  chatBox.appendChild(d);
}

function showTyping() {
  const d = document.createElement("div");
  d.className = "msg msg-bot typing";
  d.id = "typingIndicator";
  d.innerHTML = `
        <span>AI is thinking</span>
        <span class="typing-dots">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </span>`;
  chatBox.appendChild(d);
  scrollBottom(true);
}

function hideTyping() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

function scrollBottom(smooth = false) {
  chatBox.scrollTo({
    top: chatBox.scrollHeight,
    behavior: smooth ? "smooth" : "auto"
  });
}

function updateSuggested() {
  suggestedPromptsEl.style.display =
    chatBox.children.length === 0 ? "block" : "none";
}

// ==========================================
// HISTORY
// ==========================================
function addHistory(q) {
  if (!q.trim()) return;
  if (chatHistory.at(-1) === q.trim()) return;
  chatHistory.push(q.trim());
  renderHistory();
}

function renderHistory() {
  historyListEl.innerHTML = "";

  if (!chatHistory.length) {
    historyListEl.innerHTML =
      `<div class="history-empty">No history yet. Start asking!</div>`;
    return;
  }

  chatHistory.slice(-8).reverse().forEach((q) => {
    const d = document.createElement("div");
    d.className = "history-item";
    d.textContent = q.length > 60 ? q.slice(0, 60) + "…" : q;
    d.title = q;
    d.onclick = () => {
      inputEl.value = q;
      inputEl.focus();
    };
    historyListEl.appendChild(d);
  });
}

// ==========================================
// MAIN CHAT FUNCTION
// ==========================================
async function askChat(prefill) {
  if (isWaiting) return;

  const q = (prefill ?? inputEl.value).trim();
  if (!q) return;

  if (!prefill) inputEl.value = "";

  appendUser(q);
  addHistory(q);

  updateSuggested();
  scrollBottom(true);

  isWaiting = true;
  sendBtn.disabled = true;
  showTyping();

  try {
    const res = await fetch(backendURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    hideTyping();

    let finalAnswer = formatAnswer(data.answer || "No answer provided.");

    // Add PDF link
    if (data.source_link) {
      finalAnswer += `
                <br><br>
                <div style="margin-top:6px;">
                    <strong>Source PDF:</strong>
                    <a href="${data.source_link}" 
                       target="_blank" 
                       style="color:#38bdf8;text-decoration:underline;">
                       ${data.source_label || "Open PDF"}
                    </a>
                </div>
            `;
    }

    appendBot(finalAnswer);
  } catch (e) {
    hideTyping();
    appendError("Could not reach backend.");
  } finally {
    isWaiting = false;
    sendBtn.disabled = false;
    scrollBottom(true);
    updateSuggested();
  }
}

// ==========================================
// EVENTS
// ==========================================
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    askChat();
  }
});

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
});

clearChatBtn.onclick = () => {
  chatBox.innerHTML = "";
  updateSuggested();
};

scrollBottomBtn.onclick = () => scrollBottom(true);

themeToggleBtn.onclick = () => {
  const html = document.documentElement;
  if (html.classList.contains("light")) {
    html.classList.remove("light");
    localStorage.setItem("theme", "dark");
    themeToggleBtn.textContent = "🌙";
  } else {
    html.classList.add("light");
    localStorage.setItem("theme", "light");
    themeToggleBtn.textContent = "☀️";
  }
};

// ==========================================
// INITIAL
// ==========================================
updateSuggested();
renderHistory();
