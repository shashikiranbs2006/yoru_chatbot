const backendURL = "https://subpeltated-luculently-lucienne.ngrok-free.dev/chat";

// MARKDOWN FORMATTER
function formatAnswer(text) {

    let formatted = text;

    // Escape HTML
    formatted = formatted.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Bold: **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    // Bullet list: * item
    formatted = formatted.replace(/^\* (.*)$/gm, "<li>$1</li>");

    // Numbered list: 1. item
    formatted = formatted.replace(/^\d+\. (.*)$/gm, "<li>$1</li>");

    // Wrap <li> tags in <ul>
    formatted = formatted.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");

    // Multiple newlines → spacing
    formatted = formatted.replace(/\n\n+/g, "<br><br>");

    // Single newline
    formatted = formatted.replace(/\n/g, "<br>");

    return formatted;
}

async function askChat() {
    const chatBox = document.getElementById("chatBox");
    const question = document.getElementById("q").value.trim();

    if (!question) return;

    // USER MESSAGE
    chatBox.innerHTML += `
        <div class="msg user">
            ${question}
        </div>
    `;
    chatBox.scrollTop = chatBox.scrollHeight;

    document.getElementById("q").value = "";

    // BOT: thinking
    const thinking = document.createElement("div");
    thinking.className = "msg bot";
    thinking.innerText = "Thinking…";
    chatBox.appendChild(thinking);
    chatBox.scrollTop = chatBox.scrollHeight;

    // CALL BACKEND
    const res = await fetch(backendURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
    });

    const data = await res.json();
    thinking.remove();

    // FORMAT ANSWER
    const formattedAnswer = formatAnswer(data.answer);

    // PDF SOURCE LINK (ONLY IF AVAILABLE)
    let sourceHTML = "";
    if (data.source && data.source !== "No source found") {
        sourceHTML = `
            <br><br>
            <div>
                <strong>Source PDF:</strong>
                <a href="http://localhost:4000${data.source}" 
                   target="_blank"
                   style="color:#0b57d0;">
                   ${data.source}
                </a>
            </div>
        `;
    }

    // SHOW BOT MESSAGE
    chatBox.innerHTML += `
        <div class="msg bot">${formattedAnswer}${sourceHTML}</div>
    `;

    chatBox.scrollTop = chatBox.scrollHeight;
}
