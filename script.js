"use strict";

/**
 * Auto-carrega ./filmes.csv (mesmo diretório).
 * Mantém fallback DEMO_CSV caso o fetch falhe (ex: rodando via file://).
 *
 * Colunas aceitas (títulos equivalentes):
 * - Título do filme / titulo do filme / filme / título / titulo
 * - Ano
 * - Diretor
 * - Plotwords / Plotword
 * - Gênero / Genero
 */

const CSV_URL = "./filmes.csv";

const DEMO_CSV = `Título do filme,Ano,Diretor,Plotwords,Gênero
"Viagem à Lua",1902,"Georges Méliès","lua|foguete|cientistas|fantasia|efeitos","Fantasia, Aventura"
"O Grande Roubo do Trem",1903,"Edwin S. Porter","assalto|trem|bandidos|perseguição|tiroteio","Faroeste, Crime"
"Cabíria",1914,"Giovanni Pastrone","cartago|roma|escravidão|aníbal|espetáculo","Épico, Histórico"
"O Nascimento de uma Nação",1915,"D. W. Griffith","guerra-civil|reconstrução|propaganda|conflito|épico","Drama, Guerra"
"Intolerância",1916,"D. W. Griffith","fanatismo|quatro-histórias|montagem|tragédia|moral","Drama, Épico"
"O Imigrante",1917,"Charles Chaplin","navio|pobreza|amor|humilhação|superação","Comédia, Curta"
"Eu Acuso!",1919,"Abel Gance","guerra|trauma|culpa|paz|fantasmas","Drama, Guerra"
`;

// ---------- Utils ----------
function normalizeStr(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// CSV parser (aspas e vírgulas)
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      cur = "";
      const nonEmpty = row.some(v => String(v).trim().length > 0);
      if (nonEmpty) rows.push(row);
      row = [];
      continue;
    }

    cur += ch;
  }

  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    const nonEmpty = row.some(v => String(v).trim().length > 0);
    if (nonEmpty) rows.push(row);
  }

  return rows;
}

function mapHeaders(headers) {
  const h = headers.map(x => normalizeStr(x));

  function idx(...names) {
    for (const n of names) {
      const k = normalizeStr(n);
      const i = h.indexOf(k);
      if (i >= 0) return i;
    }
    return -1;
  }

  const titleIdx = idx("filme", "titulo do filme", "título do filme", "titulo", "título", "title");
  const yearIdx = idx("ano", "year");
  const directorIdx = idx("diretor", "director");
  const plotIdx = idx("plotwords", "plotword", "plot words", "palavras do plot", "palavras");
  const genreIdx = idx("gênero", "genero", "genre", "gêneros", "generos");

  return { titleIdx, yearIdx, directorIdx, plotIdx, genreIdx };
}

function buildDBFromCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0];
  const m = mapHeaders(headers);

  if (m.titleIdx < 0) {
    throw new Error("CSV sem coluna de título (ex: 'Título do filme' ou 'filme').");
  }

  const db = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const title = String(row[m.titleIdx] ?? "").trim();
    if (!title) continue;

    const year = String(row[m.yearIdx] ?? "").trim();
    const director = String(row[m.directorIdx] ?? "").trim();

    const plotRaw = String(row[m.plotIdx] ?? "").trim();
    const plotwords = plotRaw
      .split("|")
      .map(s => s.trim())
      .filter(Boolean);

    const genreRaw = String(row[m.genreIdx] ?? "").trim();
    const genres = genreRaw
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    db.push({
      title,
      year,
      director,
      plotwords,
      genres,
      _nTitle: normalizeStr(title),
    });
  }

  return db;
}

// ---------- UI refs ----------
const genresChips = document.getElementById("genresChips");
const plotChips = document.getElementById("plotChips");
const yearChip = document.getElementById("yearChip");
const directorChip = document.getElementById("directorChip");
const statusLine = document.getElementById("statusLine");

const guessInput = document.getElementById("guessInput");
const suggestions = document.getElementById("suggestions");
const btnConfirm = document.getElementById("btnConfirm");
const btnNew = document.getElementById("btnNew");
const csvInput = document.getElementById("csvInput");
const dbInfo = document.getElementById("dbInfo");

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const modalOk = document.getElementById("modalOk");

const confettiCanvas = document.getElementById("confettiCanvas");
const ctx = confettiCanvas.getContext("2d");

// ---------- Game state ----------
let DB = [];
let current = null;

let shownPlotCount = 0;
let yearRevealed = false;
let directorRevealed = false;
let directorJustRevealed = false;
let isGameOver = false;

let selectedTitle = null;
let activeSuggestionIndex = -1;

// ---------- Canvas ----------
function resizeCanvas() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  confettiCanvas.width = Math.floor(window.innerWidth * dpr);
  confettiCanvas.height = Math.floor(window.innerHeight * dpr);
  confettiCanvas.style.width = window.innerWidth + "px";
  confettiCanvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ---------- Confetti ----------
let confetti = [];
let confettiRunning = false;

function burstConfetti() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const originX = w * 0.5;
  const originY = h * 0.22;

  confetti = [];
  for (let i = 0; i < 160; i++) {
    confetti.push({
      x: originX,
      y: originY,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() * -9) - 6,
      g: 0.25 + Math.random() * 0.18,
      r: 2 + Math.random() * 3,
      a: 1,
      spin: (Math.random() - 0.5) * 0.2,
      rot: Math.random() * Math.PI,
    });
  }
  confettiRunning = true;
  requestAnimationFrame(tickConfetti);
}

function tickConfetti() {
  if (!confettiRunning) return;

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  let alive = 0;
  for (const p of confetti) {
    p.vy += p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.spin;

    if (p.y > window.innerHeight + 40) p.a -= 0.05;
    if (p.a <= 0) continue;
    alive++;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.a));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);

    const hue = Math.floor(Math.random() * 360);
    ctx.fillStyle = `hsl(${hue} 85% 65%)`;
    ctx.fillRect(-p.r * 1.6, -p.r * 0.6, p.r * 3.2, p.r * 1.2);
    ctx.restore();
  }

  if (alive > 0) requestAnimationFrame(tickConfetti);
  else {
    confettiRunning = false;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

// ---------- Modal ----------
function openModal(title, text) {
  modalTitle.textContent = title;
  modalText.textContent = text;
  modal.setAttribute("aria-hidden", "false");
}
function closeModal() {
  modal.setAttribute("aria-hidden", "true");
}
modalOk.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target.classList.contains("modalBackdrop")) closeModal();
});

// ---------- Rendering ----------
function clearHints() {
  genresChips.innerHTML = "";
  plotChips.innerHTML = "";
  yearChip.innerHTML = "";
  directorChip.innerHTML = "";
  statusLine.textContent = "";
}

function chip(container, text) {
  container.appendChild(el("span", "chip", text));
}

function renderHints() {
  clearHints();
  if (!current) return;

  if (current.genres.length) {
    for (const g of current.genres) chip(genresChips, g);
  } else {
    chip(genresChips, "—");
  }

  const shown = current.plotwords.slice(0, shownPlotCount);
  if (shown.length) {
    for (const w of shown) chip(plotChips, w);
  } else {
    chip(plotChips, "—");
  }

  if (yearRevealed && current.year) chip(yearChip, current.year);
  if (directorRevealed && current.director) chip(directorChip, current.director);

  if (isGameOver) return;

  if (!yearRevealed && !directorRevealed) {
    const remainingWords = Math.max(0, current.plotwords.length - shownPlotCount);
    statusLine.textContent =
      remainingWords > 0
        ? `Errou? Você revela mais ${remainingWords} plotword(s).`
        : `Plotwords esgotadas. Próximo erro revela o ANO.`;
  } else if (yearRevealed && !directorRevealed) {
    statusLine.textContent = `Próximo erro revela o DIRETOR.`;
  } else if (directorRevealed) {
    statusLine.textContent = `Diretor revelado. Agora você tem a ÚLTIMA chance.`;
  }
}

function setStatusPulse(type) {
  const cls = type === "good" ? "pulseGood" : "pulseBad";
  statusLine.classList.remove("pulseGood", "pulseBad");
  void statusLine.offsetWidth;
  statusLine.classList.add(cls);
}

// ---------- Autocomplete obrigatório ----------
function openSuggestions() {
  suggestions.style.display = "block";
  suggestions.parentElement?.setAttribute("aria-expanded", "true");
}

function closeSuggestions() {
  suggestions.style.display = "none";
  suggestions.parentElement?.setAttribute("aria-expanded", "false");
  activeSuggestionIndex = -1;
}

function updateConfirmState() {
  const ok = !isGameOver && selectedTitle && DB.some(m => normalizeStr(m.title) === normalizeStr(selectedTitle));
  btnConfirm.disabled = !ok;
}

function buildSuggestions(query) {
  suggestions.innerHTML = "";

  const q = normalizeStr(query);
  if (!q) {
    closeSuggestions();
    return;
  }

  const list = DB
    .filter(m => m._nTitle.includes(q))
    .slice(0, 24);

  if (!list.length) {
    closeSuggestions();
    return;
  }

  list.forEach((m, idx) => {
    const item = el("div", "suggestion", null);
    item.setAttribute("role", "option");
    item.dataset.value = m.title;

    const left = el("span", "", m.title);
    const right = el("small", "", m.year ? m.year : "");
    item.appendChild(left);
    item.appendChild(right);

    item.addEventListener("click", () => selectSuggestion(m.title));
    suggestions.appendChild(item);

    if (selectedTitle && normalizeStr(selectedTitle) === normalizeStr(m.title)) {
      item.classList.add("selected");
      activeSuggestionIndex = idx;
    }
  });

  openSuggestions();
}

function selectSuggestion(title) {
  selectedTitle = title;
  guessInput.value = title;
  updateConfirmState();
  closeSuggestions();
}

function moveSuggestion(delta) {
  const items = Array.from(suggestions.querySelectorAll(".suggestion"));
  if (!items.length) return;

  activeSuggestionIndex = Math.max(0, Math.min(items.length - 1, activeSuggestionIndex + delta));
  items.forEach((it, i) => it.classList.toggle("selected", i === activeSuggestionIndex));
  items[activeSuggestionIndex].scrollIntoView({ block: "nearest" });
}

guessInput.addEventListener("input", () => {
  selectedTitle = null;
  updateConfirmState();
  buildSuggestions(guessInput.value);
});

guessInput.addEventListener("focus", () => buildSuggestions(guessInput.value));

guessInput.addEventListener("keydown", (e) => {
  if (suggestions.style.display !== "block") return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveSuggestion(+1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    moveSuggestion(-1);
  } else if (e.key === "Enter") {
    const items = Array.from(suggestions.querySelectorAll(".suggestion"));
    if (items.length && activeSuggestionIndex >= 0) {
      e.preventDefault();
      selectSuggestion(items[activeSuggestionIndex].dataset.value);
    }
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
});

document.addEventListener("click", (e) => {
  const within = e.target.closest(".combo");
  if (!within) closeSuggestions();
});

// ---------- Game flow ----------
function resetInput() {
  guessInput.value = "";
  selectedTitle = null;
  updateConfirmState();
  closeSuggestions();
}

function startNewGame() {
  if (!DB.length) return;

  current = pickRandom(DB);

  shownPlotCount = Math.min(1, current.plotwords.length);
  yearRevealed = false;
  directorRevealed = false;
  directorJustRevealed = false;
  isGameOver = false;

  resetInput();
  renderHints();
}

function winGame() {
  isGameOver = true;
  updateConfirmState();
  burstConfetti();
  openModal("🎉 Parabéns!", "Você acertou!");
}

function loseGame() {
  isGameOver = true;
  updateConfirmState();
  openModal("😕 Que pena…", "Você perdeu.");
}

function revealNextHintOnWrong() {
  if (!current) return;

  if (shownPlotCount < current.plotwords.length) {
    shownPlotCount++;
    renderHints();
    return;
  }

  if (!yearRevealed) {
    yearRevealed = true;
    renderHints();
    return;
  }

  if (!directorRevealed) {
    directorRevealed = true;
    directorJustRevealed = true; // o erro que revela diretor ainda não é a "última chance"
    renderHints();
    return;
  }

  loseGame();
}

function confirmGuess() {
  if (isGameOver || !current) return;

  const normalizedSelection = normalizeStr(selectedTitle || "");
  const exists = DB.some(m => normalizeStr(m.title) === normalizedSelection);
  if (!exists) {
    openModal("Selecione da lista", "Digite e escolha um filme sugerido (não pode confirmar texto livre).");
    return;
  }

  const guessNorm = normalizeStr(selectedTitle);
  const answerNorm = normalizeStr(current.title);

  if (guessNorm === answerNorm) {
    statusLine.textContent = `✅ Era: ${current.title}`;
    setStatusPulse("good");
    winGame();
    return;
  }

  setStatusPulse("bad");

  // Se diretor já revelado e NÃO é o chute logo após revelar,
  // então este chute é a última chance -> perdeu.
  if (directorRevealed && !directorJustRevealed) {
    statusLine.textContent = `❌ Última chance usada. O filme era: ${current.title}`;
    loseGame();
    return;
  }

  statusLine.textContent = `❌ Não é esse. Revelando mais uma dica…`;
  revealNextHintOnWrong();

  // Se o erro anterior revelou o diretor, agora libera a "última chance"
  if (directorJustRevealed) {
    directorJustRevealed = false;
  }

  resetInput();
}

btnConfirm.addEventListener("click", confirmGuess);
btnNew.addEventListener("click", startNewGame);

guessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !btnConfirm.disabled) confirmGuess();
});

// ---------- CSV load (auto + manual opcional) ----------
async function fetchCSV(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar ${url} (HTTP ${res.status})`);
  return await res.text();
}

async function initDB() {
  // 1) tenta carregar automaticamente filmes.csv
  try {
    const csvText = await fetchCSV(CSV_URL);
    DB = buildDBFromCSV(csvText);
    if (!DB.length) throw new Error("CSV carregado, mas não encontrei filmes válidos.");
    dbInfo.textContent = `Banco: ${DB.length} filme(s) carregado(s) de ${CSV_URL}.`;
    startNewGame();
    return;
  } catch (err) {
    // 2) fallback demo (útil para testar localmente via file://)
    try {
      DB = buildDBFromCSV(DEMO_CSV);
      dbInfo.textContent = `Não consegui carregar ${CSV_URL}. Usando demo embutida (${DB.length} filmes). Dica: rode via GitHub Pages/servidor.`;
      startNewGame();
      return;
    } catch (e2) {
      openModal("Erro", `Falha ao iniciar banco.\n${String(err?.message || err)}`);
    }
  }
}

// Upload manual opcional (continua funcionando)
async function loadCSVFromFile(file) {
  const text = await file.text();
  const db = buildDBFromCSV(text);
  if (!db.length) throw new Error("CSV carregado, mas não encontrei filmes válidos.");
  return db;
}

csvInput.addEventListener("change", async () => {
  const file = csvInput.files?.[0];
  if (!file) return;

  try {
    DB = await loadCSVFromFile(file);
    dbInfo.textContent = `Banco: ${DB.length} filme(s) carregado(s) do CSV manual.`;
    startNewGame();
  } catch (err) {
    openModal("Erro no CSV", String(err?.message || err));
  } finally {
    csvInput.value = "";
  }
});

// ---------- Init ----------
initDB();
