// Fuzzy Systems — front-end logic
// - CNPJ formatting + validation
// - Fetch company data from open.cnpja.com
// - AI chat via Fuzzy backend (SSE)

const API_BASE = "https://hellgov.com.br"; // backend lives alongside Radar
const CHAT_ENDPOINT = `${API_BASE}/api/v1/fuzzy-chat`;
const CNPJ_API = "https://open.cnpja.com/office";

// --- DOM ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const landing = $("stageLanding");
const workspace = $("stageWorkspace");
const cnpjForm = $("cnpjForm");
const cnpjInput = $("cnpj");
const cnpjHint = $("cnpjHint");
const submitBtn = $("cnpjSubmit");
const companyPanel = $("companyPanel");
const chatMessages = $("chatMessages");
const chatForm = $("chatForm");
const chatInput = $("chatInput");
const chatSend = $("chatSend");
const resetBtn = $("resetBtn");
const chatSub = $("chatSub");
const brand = $("brand");

// --- State ----------------------------------------------------------------
let companyData = null;
let messages = []; // {role, content}

// --- CNPJ helpers ---------------------------------------------------------
function formatCNPJ(v) {
  const digits = v.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}
function onlyDigits(v) { return v.replace(/\D/g, ""); }
function validCNPJ(cnpj) {
  const c = onlyDigits(cnpj);
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  // checksum
  const calc = (len) => {
    const weights = len === 12
      ? [5,4,3,2,9,8,7,6,5,4,3,2]
      : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(c[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(c[12]) && calc(13) === parseInt(c[13]);
}

cnpjInput.addEventListener("input", (e) => {
  e.target.value = formatCNPJ(e.target.value);
  cnpjInput.classList.remove("error");
  cnpjHint.classList.remove("error");
  cnpjHint.textContent = "Dados públicos via Receita Federal. Não armazenamos.";
});

// --- Submit ---------------------------------------------------------------
cnpjForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = cnpjInput.value;
  if (!validCNPJ(raw)) {
    cnpjInput.classList.add("error");
    cnpjHint.classList.add("error");
    cnpjHint.textContent = "CNPJ inválido. Confira os números.";
    return;
  }
  submitBtn.disabled = true;
  submitBtn.querySelector(".btn-text").textContent = "Buscando...";
  try {
    const cnpj = onlyDigits(raw);
    const resp = await fetch(`${CNPJ_API}/${cnpj}`);
    if (!resp.ok) {
      throw new Error("Não foi possível consultar o CNPJ.");
    }
    const data = await resp.json();
    companyData = data;
    enterWorkspace(data);
    // Kick off initial analysis
    await sendMessage(null, true);
  } catch (err) {
    cnpjInput.classList.add("error");
    cnpjHint.classList.add("error");
    cnpjHint.textContent = err.message || "Erro na consulta. Tente novamente.";
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector(".btn-text").textContent = "Analisar";
  }
});

// --- Workspace ------------------------------------------------------------
function enterWorkspace(data) {
  landing.hidden = true;
  workspace.hidden = false;
  renderCompany(data);
  messages = [];
  chatMessages.innerHTML = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCompany(d) {
  const name = d.company?.name || d.alias || "—";
  const alias = d.alias && d.alias !== name ? d.alias : null;
  const status = d.status?.text || "—";
  const main = d.mainActivity;
  const sides = d.sideActivities || [];
  const size = d.company?.size?.text || "";
  const nature = d.company?.nature?.text || "";
  const city = d.address?.city || "";
  const state = d.address?.state || "";
  const founded = d.founded || "";

  companyPanel.classList.remove("loading");
  companyPanel.innerHTML = `
    <div class="company-header">
      <div class="company-name">${escapeHTML(name)}</div>
      ${alias ? `<div class="company-alias">${escapeHTML(alias)}</div>` : ""}
      <div class="company-status"><span class="status-dot"></span>${escapeHTML(status)}</div>
    </div>

    <div class="field-group">
      <div class="field-label">Atividade principal</div>
      <div class="field-value">
        ${main ? `<div class="cnae-list"><li><span class="cnae-code">${main.id}</span><span>${escapeHTML(main.text)}</span></li></div>` : "—"}
      </div>
    </div>

    ${sides.length > 0 ? `
    <div class="field-group">
      <div class="field-label">Atividades secundárias</div>
      <ul class="cnae-list">
        ${sides.slice(0, 8).map(s => `
          <li><span class="cnae-code">${s.id}</span><span>${escapeHTML(s.text)}</span></li>
        `).join("")}
        ${sides.length > 8 ? `<li><span class="cnae-code">···</span><span>+${sides.length - 8} outras</span></li>` : ""}
      </ul>
    </div>` : ""}

    <div class="field-group">
      <div class="field-label">Localização</div>
      <div class="field-value">${escapeHTML([city, state].filter(Boolean).join(" / ") || "—")}</div>
    </div>

    ${size ? `<div class="field-group">
      <div class="field-label">Porte</div>
      <div class="field-value">${escapeHTML(size)}</div>
    </div>` : ""}

    ${nature ? `<div class="field-group">
      <div class="field-label">Natureza jurídica</div>
      <div class="field-value">${escapeHTML(nature)}</div>
    </div>` : ""}
  `;

  chatSub.textContent = `Oportunidades para ${truncate(name, 40)}`;
}

// --- Chat -----------------------------------------------------------------
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  chatInput.style.height = "auto";
  await sendMessage(text, false);
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + "px";
});

async function sendMessage(userText, isInitial) {
  if (userText) {
    messages.push({ role: "user", content: userText });
    appendMessage("user", userText);
  }
  chatSend.disabled = true;

  const assistantEl = appendMessage("assistant", "", true);
  const body = {
    company: companyData,
    messages,
    initial: !!isInitial,
  };

  try {
    const resp = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let full = "";
    let buffer = "";
    assistantEl.innerHTML = `<div class="msg-label">Fuzzy</div><div class="msg-body"></div><span class="cursor"></span>`;
    const bodyEl = assistantEl.querySelector(".msg-body");
    const cursorEl = assistantEl.querySelector(".cursor");
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content || chunk.delta || "";
          if (delta) {
            full += delta;
            bodyEl.innerHTML = renderMarkdown(full);
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        } catch { /* ignore malformed chunks */ }
      }
    }
    cursorEl?.remove();
    messages.push({ role: "assistant", content: full });
  } catch (err) {
    assistantEl.classList.remove("thinking");
    assistantEl.innerHTML = `<div class="msg-label">Erro</div><div>Falha na comunicação com o servidor: ${escapeHTML(err.message)}. Tente novamente.</div>`;
  } finally {
    chatSend.disabled = false;
    chatInput.focus();
  }
}

function appendMessage(role, text, thinking = false) {
  const el = document.createElement("div");
  el.className = "msg " + role + (thinking ? " thinking" : "");
  if (role === "assistant") {
    el.innerHTML = thinking
      ? `<div class="msg-label">Fuzzy</div><div>Analisando...</div>`
      : `<div class="msg-label">Fuzzy</div><div class="msg-body">${renderMarkdown(text)}</div>`;
  } else {
    el.textContent = text;
  }
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

// --- Reset ----------------------------------------------------------------
resetBtn.addEventListener("click", resetToLanding);
brand.addEventListener("click", (e) => { e.preventDefault(); resetToLanding(); });

function resetToLanding() {
  landing.hidden = false;
  workspace.hidden = true;
  cnpjInput.value = "";
  companyData = null;
  messages = [];
  chatMessages.innerHTML = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
  cnpjInput.focus();
}

// --- Utils ----------------------------------------------------------------
function escapeHTML(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
// Minimal markdown: bold, bullets, paragraphs, code
function renderMarkdown(md) {
  let html = escapeHTML(md);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // split by newlines, build paragraphs and lists
  const lines = html.split("\n");
  const out = [];
  let list = null;
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = /^[-*]\s+(.+)/.exec(line);
    const numbered = /^\d+\.\s+(.+)/.exec(line);
    if (bullet) {
      if (list !== "ul") { if (list) out.push(list === "ul" ? "</ul>" : "</ol>"); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${bullet[1]}</li>`);
    } else if (numbered) {
      if (list !== "ol") { if (list) out.push(list === "ul" ? "</ul>" : "</ol>"); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${numbered[1]}</li>`);
    } else if (line === "") {
      if (list) { out.push(list === "ul" ? "</ul>" : "</ol>"); list = null; }
    } else {
      if (list) { out.push(list === "ul" ? "</ul>" : "</ol>"); list = null; }
      out.push(`<p>${line}</p>`);
    }
  }
  if (list) out.push(list === "ul" ? "</ul>" : "</ol>");
  return out.join("");
}
