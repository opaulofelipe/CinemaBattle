"use strict";

const CSV_URL = "./filmes.csv";
const POSTER_PREFIX = "https://image.tmdb.org/t/p/w500";

const DEMO_CSV = `Título do filme,Ano,Diretor,Sinopse,Gênero,poster_path
"Viagem à Lua",1902,"Georges Méliès","Um grupo de cientistas constrói um foguete e parte rumo à Lua, vivendo aventuras fantásticas.","Fantasia, Aventura","/example.jpg"
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

// CSV parser
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
  const synopsisIdx = idx("sinopse", "synopsis", "overview", "plot", "descricao", "descrição");
  const genreIdx = idx("gênero", "genero", "genre", "gêneros", "generos");
  const posterIdx = idx("poster_path", "poster path", "posterpath", "poster");

  return { titleIdx, yearIdx, directorIdx, synopsisIdx, genreIdx, posterIdx };
}

function buildDBFromCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0];
  const m = mapHeaders(headers);

  if (m.titleIdx < 0) throw new Error("CSV sem coluna de título (ex: 'Título do filme' ou 'filme').");
  if (m.synopsisIdx < 0) throw new Error("CSV sem coluna de sinopse (ex: 'Sinopse' ou 'overview').");

  const db = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];

    const title = String(row[m.titleIdx] ?? "").trim();
    if (!title) continue;

    const year = String(row[m.yearIdx] ?? "").trim();
    const director = String(row[m.directorIdx] ?? "").trim();
    const synopsis = String(row[m.synopsisIdx] ?? "").trim();

    const genreRaw = String(row[m.genreIdx] ?? "").trim();
    const genres = genreRaw.split(",").map(s => s.trim()).filter(Boolean);

    const poster_path = String(row[m.posterIdx] ?? "").trim();

    db.push({
      title,
      year,
      director,
      synopsis,
      genres,
      poster_path,
      _nTitle: normalizeStr(title),
    });
  }

  return db;
}

// ---------- UI refs ----------
const genresChips = document.getElementById("genresChips");
const synopsisBox = document.getElementById("synopsisBox");
const yearChip = document.getElementById("yearChip");
const directorChip = document.getElementById("directorChip");
const statusLine = document.getElementById("statusLine");

const posterWrap = document.getElementById("posterWrap");
const posterImg = document.getElementById("posterImg");
posterImg.addEventListener("error", () => {
  hidePoster();
});


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

const SYNOPSIS_TRIES = 3;
let triesLeft = SYNOPSIS_TRIES;

let yearRevealed = false;
let directorRevealed = false;
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
  synopsisBox.textContent = "";
  yearChip.innerHTML = "";
  directorChip.innerHTML = "";
  statusLine.textContent = "";
}

function chip(container, text) {
  container.appendChild(el("span", "chip", text));
}

function hidePoster() {
  posterWrap.hidden = true;
  posterImg.removeAttribute("src"); // ou posterImg.src = ""
  posterImg.alt = "";
}


function showPoster() {
  if (!current) return;

  const p = String(current.poster_path || "").trim();

  // Se não houver poster_path, não mostra nada (evita “erro”/imagem quebrada)
  if (!p) {
    hidePoster();
    return;
  }

  posterImg.alt = `Poster de ${current.title}`;
  posterImg.src = `${POSTER_PREFIX}${p}`;
  posterWrap.hidden = false;
}


function renderHints() {
  clearHints();
  if (!current) return;

  // Gêneros (sempre)
  if (current.genres.length) {
    for (const g of current.genres) chip(genresChips, g);
  } else {
    chip(genresChips, "—");
  }

  // Sinopse (sempre)
  synopsisBox.textContent = current.synopsis || "—";

  // Ano/Diretor (conforme revelado)
  if (yearRevealed && current.year) chip(yearChip, current.year);
  if (directorRevealed && current.director) chip(directorChip, current.director);

  if (isGameOver) return;

  if (!yearRevealed && !directorRevealed) {
    statusLine.textContent = `Tentativas restantes antes do ano: ${triesLeft}.`;
  } else if (yearRevealed && !directorRevealed) {
    statusLine.textContent = `Ano revelado. Próximo erro revela o DIRETOR.`;
  } else if (directorRevealed) {
    statusLine.textContent = `Diretor revelado. Esta é a ÚLTIMA chance.`;
  }
}

function setStatusPulse(type) {
  const cls = type === "good" ? "pulseGood" : "pulseBad";
  statusLine.classList.remove("pulseGood", "pulseBad");
  void statusLine.offsetWidth;
  statusLine.classList.add(cls);
}

// ---------- Autocomplete obrigatório (sem ano na lista) ----------
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
  if (!q) { closeSuggestions(); return; }

  const list = DB.filter(m => m._nTitle.includes(q)).slice(0, 24);
  if (!list.length) { closeSuggestions(); return; }

  list.forEach((m, idx) => {
    const item = el("div", "suggestion", null);
    item.setAttribute("role", "option");
    item.dataset.value = m.title;

    item.appendChild(el("span", "", m.title)); // só título
    item.addEventListener("click", () => selectSuggestion(m.title));

    if (selectedTitle && normalizeStr(selectedTitle) === normalizeStr(m.title)) {
      item.classList.add("selected");
      activeSuggestionIndex = idx;
    }

    suggestions.appendChild(item);
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

  if (e.key === "ArrowDown") { e.preventDefault(); moveSuggestion(+1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggestion(-1); }
  else if (e.key === "Enter") {
    const items = Array.from(suggestions.querySelectorAll(".suggestion"));
    if (items.length && activeSuggestionIndex >= 0) {
      e.preventDefault();
      selectSuggestion(items[activeSuggestionIndex].dataset.value);
    }
  } else if (e.key === "Escape") closeSuggestions();
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

  triesLeft = SYNOPSIS_TRIES;
  yearRevealed = false;
  directorRevealed = false;
  isGameOver = false;

  hidePoster();
  resetInput();
  renderHints();
}

function winGame() {
  isGameOver = true;
  updateConfirmState();
  burstConfetti();
  showPoster();
  openModal("🎉 Parabéns!", "Você acertou!");
}

function loseGame() {
  isGameOver = true;
  updateConfirmState();
  showPoster();
  openModal("😕 Que pena…", "Você perdeu.");
}

function revealNextOnWrong() {
  if (!current) return;

  // fase sinopse: 3 tentativas
  if (!yearRevealed && !directorRevealed) {
    triesLeft = Math.max(0, triesLeft - 1);

    if (triesLeft === 0) {
      yearRevealed = true;      // revela ano
    }

    renderHints();
    return;
  }

  // após revelar ano, próximo erro revela diretor
  if (yearRevealed && !directorRevealed) {
    directorRevealed = true;
    renderHints();
    return;
  }

  // diretor revelado: último erro = perde
  if (directorRevealed) {
    loseGame();
  }
}

function confirmGuess() {
  if (isGameOver || !current) return;

  // validação: só aceita se for exatamente uma opção da lista
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

  // Se diretor já foi revelado e ainda está jogando, isso era a última chance -> perde
  if (directorRevealed) {
    statusLine.textContent = `❌ Última chance usada. O filme era: ${current.title}`;
    loseGame();
    return;
  }

  statusLine.textContent = `❌ Não é esse.`;
  revealNextOnWrong();
  resetInput();
}

btnConfirm.addEventListener("click", confirmGuess);
btnNew.addEventListener("click", startNewGame);
guessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !btnConfirm.disabled) confirmGuess();
});

// ---------- CSV load ----------
async function fetchCSV(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar ${url} (HTTP ${res.status})`);
  return await res.text();
}

async function initDB() {
  try {
    const csvText = await fetchCSV(CSV_URL);
    DB = buildDBFromCSV(csvText);
    if (!DB.length) throw new Error("CSV carregado, mas não encontrei filmes válidos.");
    dbInfo.textContent = `Banco: ${DB.length} filme(s) carregado(s) de ${CSV_URL}.`;
    startNewGame();
    return;
  } catch (err) {
    // fallback demo
    DB = buildDBFromCSV(DEMO_CSV);
    dbInfo.textContent = `Não consegui carregar ${CSV_URL}. Usando demo embutida. (Rode via GitHub Pages/servidor).`;
    startNewGame();
  }
}

// Upload manual opcional
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
