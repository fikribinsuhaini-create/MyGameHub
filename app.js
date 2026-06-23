const STORAGE_KEY = "puzzlehub-v2";
const GAMES = ["sudoku", "kakuro", "sumplete"];
const DIFFICULTIES = ["easy", "medium", "hard", "expert"];
const LEVELS = 10000;
const SYNC_TABLES = {
  profiles: "puzzlehub_profiles",
  settings: "puzzlehub_user_settings",
  progress: "puzzlehub_game_progress",
  saves: "puzzlehub_save_states"
};
const meta = {
  sudoku: { title: "Sudoku" },
  kakuro: { title: "Kakuro" },
  sumplete: { title: "Sumplete" }
};
const app = document.getElementById("app-root");
const pageTitle = document.getElementById("page-title");
const toastNode = document.getElementById("toast");
const syncButton = document.getElementById("sync-button");
const state = load();
const configReady = window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase;
const supabase = configReady ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;
let persistTimer = 0;
let syncTimer = 0;
let pushInFlight = false;
let pullInFlight = false;

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (_) {}
  }
  return {
    route: "home",
    game: "sudoku",
    difficulty: "easy",
    levelPage: 1,
    selected: null,
    currentKey: null,
    noteMode: false,
    recent: [],
    completed: {},
    saves: {},
    stats: { totalCompleted: 0, streak: 0, longest: 0, hints: 0, totalPlaySeconds: 0, bestTimes: {} },
    settings: { dark: true, sound: true, animations: true, cloudSync: true },
    profile: { name: "Puzzle Collector", avatar: "PH" },
    cloud: { userId: null, enabled: false, lastSyncedAt: null, status: "Local only", debug: [] }
  };
}

function persist(triggerSync = true) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (triggerSync) queueSync();
  }, 120);
}

function persistNow(triggerSync = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (triggerSync) queueSync();
}

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastNode.classList.add("hidden"), 2200);
}

function cap(v) { return v.charAt(0).toUpperCase() + v.slice(1); }
function pushDebug(message) { state.cloud.debug = [`${new Date().toLocaleTimeString()} - ${message}`, ...(state.cloud.debug || [])].slice(0, 20); persistNow(false); }
function fmt(sec) { const m = String(Math.floor(sec / 60)).padStart(2, "0"); const s = String(sec % 60).padStart(2, "0"); return `${m}:${s}`; }
function key(game, difficulty, level) { return `${game}-${difficulty}-${String(level).padStart(4, "0")}`; }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function isOnline() { return navigator.onLine; }
function sameDay(a, b) { return a && b && a.slice(0, 10) === b.slice(0, 10); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function syncLabel() {
  if (!state.settings.cloudSync) return "Cloud sync off";
  if (!supabase) return "Local save only";
  if (!state.cloud.userId) return "Connect device for cloud sync";
  if (!isOnline()) return "Offline, local save active";
  if (state.cloud.lastSyncedAt) {
    const mins = Math.max(1, Math.floor((Date.now() - new Date(state.cloud.lastSyncedAt).getTime()) / 60000));
    return mins < 60 ? `Synced ${mins} min ago` : `Synced ${Math.floor(mins / 60)} hr ago`;
  }
  return state.cloud.status || "Cloud ready";
}

function perGameStats(game) {
  const doneEntries = Object.entries(state.completed).filter(([saveKey]) => saveKey.startsWith(`${game}-`));
  const times = doneEntries.map(([, row]) => row.time).filter((time) => typeof time === "number");
  const best = times.length ? Math.min(...times) : null;
  const avg = times.length ? Math.round(times.reduce((sum, time) => sum + time, 0) / times.length) : null;
  const play = Object.values(state.saves).filter((save) => save.game === game).reduce((sum, save) => sum + (save.timer || 0), 0);
  return { completed: doneEntries.length, best, avg, play };
}

function totalPlayTime() {
  return Object.values(state.saves).reduce((sum, save) => sum + (save.timer || 0), 0);
}

async function withTimeout(label, promise, ms = 12000) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function rand(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822519)) >>> 0) / 4294967296;
}
function shuffle(arr, r) { const a = [...arr]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function sudoku(seed, difficulty) {
  const r = rand(seed); const base = 3; const side = 9;
  const rows = shuffle([0,1,2], r).flatMap((g) => shuffle([0,1,2], r).map((x) => g * 3 + x));
  const cols = shuffle([0,1,2], r).flatMap((g) => shuffle([0,1,2], r).map((x) => g * 3 + x));
  const nums = shuffle([1,2,3,4,5,6,7,8,9], r);
  const pattern = (rr, cc) => (base * (rr % base) + Math.floor(rr / base) + cc) % side;
  const solution = rows.map((rr) => cols.map((cc) => nums[pattern(rr, cc)]));
  const visibleMap = { easy: 36, medium: 31, hard: 27, expert: 24 };
  const hidden = new Set(shuffle(Array.from({ length: 81 }, (_, i) => i), r).slice(0, 81 - visibleMap[difficulty]));
  const puzzle = solution.map((row, ri) => row.map((v, ci) => hidden.has(ri * 9 + ci) ? 0 : v));
  return { type: "sudoku", puzzle, solution };
}

function kakuro(seed, difficulty) {
  const r = rand(seed); const size = 5; const digits = shuffle([1,2,3,4,5,6,7,8,9], r);
  const solution = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => digits[(row + col * 2) % 9]));
  const rowSums = solution.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums = Array.from({ length: size }, (_, col) => solution.reduce((a, row) => a + row[col], 0));
  const visibleMap = { easy: 5, medium: 6, hard: 7, expert: 8 };
  const visible = new Set(shuffle(Array.from({ length: 25 }, (_, i) => i), r).slice(0, visibleMap[difficulty]));
  const puzzle = solution.map((row, ri) => row.map((v, ci) => visible.has(ri * 5 + ci) ? v : 0));
  return { type: "kakuro", puzzle, solution, rowSums, colSums };
}

function sumplete(seed, difficulty) {
  const r = rand(seed); const size = 6; const p = { easy: .42, medium: .5, hard: .58, expert: .64 }[difficulty];
  const puzzle = Array.from({ length: size }, () => Array.from({ length: size }, () => Math.floor(r() * 8) + 1));
  const keep = Array.from({ length: size }, () => Array.from({ length: size }, () => r() > p));
  const rowSums = puzzle.map((row, ri) => row.reduce((sum, v, ci) => sum + (keep[ri][ci] ? v : 0), 0));
  const colSums = Array.from({ length: size }, (_, ci) => puzzle.reduce((sum, row, ri) => sum + (keep[ri][ci] ? row[ci] : 0), 0));
  return { type: "sumplete", puzzle, keep, rowSums, colSums };
}

function puzzle(game, difficulty, level) {
  const seed = key(game, difficulty, level);
  if (game === "sudoku") return sudoku(seed, difficulty);
  if (game === "kakuro") return kakuro(seed, difficulty);
  return sumplete(seed, difficulty);
}

function ensureSave(game, difficulty, level) {
  const k = key(game, difficulty, level);
  if (state.saves[k]) return state.saves[k];
  const def = puzzle(game, difficulty, level);
  state.saves[k] = {
    key: k,
    game,
    difficulty,
    level,
    timer: 0,
    completed: false,
    board: game === "sumplete" ? def.puzzle.map((row) => row.map(() => "keep")) : def.puzzle.map((row) => [...row]),
    notes: game === "sumplete" ? [] : def.puzzle.map((row) => row.map(() => [])),
    history: [],
    future: [],
    updatedAt: new Date().toISOString()
  };
  persist();
  return state.saves[k];
}

function currentSave() { return state.currentKey ? state.saves[state.currentKey] : null; }
function continueSave() { return state.recent.map((k) => state.saves[k]).find((s) => s && !s.completed) || null; }
function completedCount(game) { return Object.keys(state.completed).filter((k) => k.startsWith(`${game}-`)).length; }
function pct(game) { return ((completedCount(game) / LEVELS) * 100).toFixed(2); }

function upsertRecent(saveKey) {
  state.recent = [saveKey, ...state.recent.filter((k) => k !== saveKey)].slice(0, 8);
}

function snapshotSave(save) {
  return { board: clone(save.board), notes: clone(save.notes), completed: save.completed, timer: save.timer, hintsUsed: save.hintsUsed || 0 };
}

function recordHistory(save) {
  save.history = save.history || [];
  save.future = [];
  save.history.push(snapshotSave(save));
  if (save.history.length > 200) save.history.shift();
}

function markTouched(save) {
  save.updatedAt = new Date().toISOString();
  upsertRecent(save.key);
  persist();
}

function restoreSnapshot(save, snap) {
  save.board = clone(snap.board);
  save.notes = clone(snap.notes);
  save.completed = snap.completed;
  save.timer = snap.timer;
  save.hintsUsed = snap.hintsUsed || 0;
  markTouched(save);
}

function achievementRows() {
  const total = state.stats.totalCompleted;
  const byGame = Object.fromEntries(GAMES.map((game) => [game, completedCount(game)]));
  const streak = state.stats.longest || 0;
  return [
    { label: "First Puzzle", done: total >= 1, progress: `${Math.min(total, 1)}/1` },
    { label: "10 Levels", done: total >= 10, progress: `${Math.min(total, 10)}/10` },
    { label: "100 Levels", done: total >= 100, progress: `${Math.min(total, 100)}/100` },
    { label: "First Sudoku", done: byGame.sudoku >= 1, progress: `${Math.min(byGame.sudoku, 1)}/1` },
    { label: "First Kakuro", done: byGame.kakuro >= 1, progress: `${Math.min(byGame.kakuro, 1)}/1` },
    { label: "First Sumplete", done: byGame.sumplete >= 1, progress: `${Math.min(byGame.sumplete, 1)}/1` },
    { label: "7 Day Streak", done: streak >= 7, progress: `${Math.min(streak, 7)}/7` }
  ];
}

function routeTitle() {
  if (state.route === "games") return meta[state.game].title;
  if (state.route === "play") return "Now Playing";
  if (state.route === "progress") return "Progress";
  if (state.route === "profile") return "Profile";
  if (state.route === "settings") return "Settings";
  return "PuzzleHub";
}

function render() {
  document.body.classList.toggle("light", !state.settings.dark);
  pageTitle.textContent = routeTitle();
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.route === state.route));
  syncButton.textContent = state.cloud.userId ? "Sync" : "Local";
  if (state.route === "home") app.innerHTML = homeView();
  if (state.route === "games") app.innerHTML = gamesView();
  if (state.route === "play") app.innerHTML = playView();
  if (state.route === "progress") app.innerHTML = progressView();
  if (state.route === "profile") app.innerHTML = profileView();
  if (state.route === "settings") app.innerHTML = settingsView();
}

function homeView() {
  const cont = continueSave();
  return `
  <section class="stack home-stack mobile-home">
    <section class="hero-panel mobile-hero">
      <div class="mobile-hero-top">
        <div>
          <p class="eyebrow">PuzzleHub</p>
          <h2 class="hero-title mobile-hero-title">Pick up and play.</h2>
        </div>
        <div class="mobile-hero-badge"><strong>${state.stats.totalCompleted}</strong><span>Solved</span></div>
      </div>
      ${cont ? `<article class="continue-card home-continue-card"><div><span class="game-pill">${meta[cont.game].title}</span><h3>Level ${cont.level}</h3><p class="muted">${cap(cont.difficulty)} • ${fmt(cont.timer)}</p></div><button class="accent-button" data-action="resume" data-key="${cont.key}" type="button">Continue</button></article>` : `<article class="continue-card home-continue-card"><div><span class="game-pill">Sudoku</span><h3>Fresh start ready</h3><p class="muted">Jump into easy mode.</p></div><button class="accent-button" data-action="start" data-game="sudoku" data-difficulty="easy" type="button">Start</button></article>`}
    </section>
    <section class="section-stack">
      <div class="section-head"><h2 class="section-title">Game Library</h2></div>
      <div class="mobile-library-grid">${GAMES.map((game) => `<button class="mobile-game-tile" data-action="library" data-game="${game}" type="button"><span class="mobile-game-name">${meta[game].title}</span><span class="mobile-game-count">${completedCount(game)} / ${LEVELS}</span><span class="mobile-game-percent">${pct(game)}%</span></button>`).join("")}</div>
    </section>
  </section>`;
}

function gamesView() {
  const perPage = 100;
  const maxPage = Math.ceil(LEVELS / perPage);
  const page = Math.min(Math.max(1, state.levelPage || 1), maxPage);
  const start = ((page - 1) * perPage) + 1;
  const levels = Array.from({ length: perPage }, (_, i) => start + i).filter((level) => level <= LEVELS);
  return `<section class="stack"><article class="panel"><div class="route-head"><h2 class="section-title">${meta[state.game].title}</h2><span class="muted">${completedCount(state.game)} / ${LEVELS}</span></div><div class="difficulty-row">${GAMES.map((game) => `<button class="difficulty-pill ${game === state.game ? "active" : ""}" data-action="pick-game" data-game="${game}" type="button">${meta[game].title}</button>`).join("")}</div><div class="difficulty-row">${DIFFICULTIES.map((d) => `<button class="difficulty-pill ${d === state.difficulty ? "active" : ""}" data-action="difficulty" data-difficulty="${d}" type="button">${cap(d)}</button>`).join("")}</div></article><article class="panel"><div class="route-head"><strong>Levels ${String(start).padStart(4, "0")} - ${String(levels.at(-1)).padStart(4, "0")}</strong><div class="difficulty-row"><button class="ghost-button" data-action="page-levels" data-page="${Math.max(1, page - 1)}" type="button">Prev</button><button class="ghost-button" data-action="page-levels" data-page="${Math.min(maxPage, page + 1)}" type="button">Next</button></div></div><div class="level-grid">${levels.map((level) => { const levelKey = key(state.game, state.difficulty, level); const done = state.completed[levelKey]; const current = state.currentKey === levelKey; return `<button class="level-tile ${done ? "done locked" : ""} ${current ? "current" : ""}" ${done ? "disabled" : ""} data-action="open" data-game="${state.game}" data-difficulty="${state.difficulty}" data-level="${level}" type="button">${done ? "✓" : String(level).padStart(4, "0")}</button>`; }).join("")}</div></article></section>`;
}

function noteGrid(notes) { return `<span class="note-grid">${Array.from({ length: 9 }, (_, i) => i + 1).map((n) => `<span>${notes.includes(n) ? n : ""}</span>`).join("")}</span>`; }

function boardView(save, def) {
  if (save.game === "sudoku") {
    const selectedValue = state.selected ? save.board[state.selected.row]?.[state.selected.col] : 0;
    return `<div class="sudoku-board">${def.puzzle.map((row, ri) => row.map((given, ci) => { const v = save.board[ri][ci]; const selected = state.selected && state.selected.row === ri && state.selected.col === ci; const related = state.selected && (state.selected.row === ri || state.selected.col === ci || (Math.floor(state.selected.row / 3) === Math.floor(ri / 3) && Math.floor(state.selected.col / 3) === Math.floor(ci / 3))); const peer = selectedValue && v === selectedValue && !selected; return `<button class="cell ${given ? "given" : ""} ${selected ? "selected" : ""} ${related ? "related" : ""} ${peer ? "peer" : ""} ${ci % 3 === 2 && ci < 8 ? "block-right" : ""} ${ri % 3 === 2 && ri < 8 ? "block-bottom" : ""}" data-action="cell" data-row="${ri}" data-col="${ci}" type="button">${v ? `<span>${v}</span>` : noteGrid(save.notes[ri][ci] || [])}</button>`; }).join("")).join("")}</div>`;
  }
  if (save.game === "kakuro") {
    const cells = []; const size = def.puzzle.length + 1;
    for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) {
      if (r === 0 && c === 0) cells.push(`<div class="clue-cell kakuro-corner"></div>`);
      else if (r === 0) cells.push(`<div class="clue-cell kakuro-clue top-clue"><span class="clue-down">${def.colSums[c - 1]}</span></div>`);
      else if (c === 0) cells.push(`<div class="clue-cell kakuro-clue side-clue"><span class="clue-right">${def.rowSums[r - 1]}</span></div>`);
      else { const given = def.puzzle[r - 1][c - 1]; const v = save.board[r - 1][c - 1]; const selected = state.selected && state.selected.row === r - 1 && state.selected.col === c - 1; cells.push(`<button class="kakuro-cell ${given ? "given" : ""} ${selected ? "selected" : ""}" data-action="cell" data-row="${r - 1}" data-col="${c - 1}" type="button">${v ? `<span>${v}</span>` : noteGrid(save.notes[r - 1][c - 1] || [])}</button>`); }
    }
    return `<div class="kakuro-board" style="grid-template-columns:repeat(${size},minmax(0,1fr));">${cells.join("")}</div>`;
  }
  const cells = []; const size = def.puzzle.length + 1;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) {
    if (r === 0 && c === 0) cells.push(`<div class="clue-cell">Σ</div>`);
    else if (r === 0) cells.push(`<div class="clue-cell">${def.colSums[c - 1]}</div>`);
    else if (c === 0) cells.push(`<div class="clue-cell">${def.rowSums[r - 1]}</div>`);
    else { const v = def.puzzle[r - 1][c - 1]; const mode = save.board[r - 1][c - 1]; const selected = state.selected && state.selected.row === r - 1 && state.selected.col === c - 1; cells.push(`<button class="sumplete-cell ${mode === "remove" ? "removed" : ""} ${mode === "lock" ? "locked" : ""} ${selected ? "selected" : ""}" data-action="cell" data-row="${r - 1}" data-col="${c - 1}" type="button">${v}</button>`); }
  }
  return `<div class="sumplete-board" style="grid-template-columns:repeat(${size},minmax(0,1fr));">${cells.join("")}</div>`;
}

function playView() {
  const save = currentSave();
  if (!save) return `<article class="panel"><p>No puzzle open.</p></article>`;
  const def = puzzle(save.game, save.difficulty, save.level);
  const gameStats = perGameStats(save.game);
  const bestForGame = state.stats.bestTimes?.[save.game] || gameStats.best;
  const isBest = save.completed && bestForGame === save.timer;
  const isSudoku = save.game === "sudoku";
  const isKakuro = save.game === "kakuro";
  const useDigitShell = isSudoku || isKakuro;
  const pad = save.game === "sumplete"
    ? `<article class="list-card"><h3>Tap cell to cycle</h3><p class="muted">Keep -> Remove -> Lock. No extra button needed.</p></article>`
    : useDigitShell
      ? `<div class="sudoku-input-shell"><div class="sudoku-tool-row"><button class="sudoku-tool ${state.noteMode ? "active" : ""}" data-action="notes" type="button"><span>Notes</span></button><button class="sudoku-tool" data-action="hint" type="button"><span>Hint</span></button><button class="sudoku-tool" data-action="undo" type="button"><span>Undo</span></button><button class="sudoku-tool" data-action="erase" type="button"><span>Erase</span></button></div><div class="sudoku-digit-row">${[1,2,3,4,5,6,7,8,9].map((n) => `<button class="sudoku-digit" data-action="digit" data-value="${n}" type="button">${n}</button>`).join("")}</div></div>`
      : `<div class="pad-grid">${[1,2,3,4,5,6,7,8,9].map((n) => `<button class="pad-button" data-action="digit" data-value="${n}" type="button">${n}</button>`).join("")}<button class="pad-button" data-action="erase" type="button">Erase</button></div>`;
  return `<section class="stack play-screen ${isSudoku ? "sudoku-screen" : ""}">${save.completed ? `<article class="celebration panel"><p class="eyebrow">Puzzle Complete</p><h2>${meta[save.game].title} cleared</h2><p class="muted">Time ${fmt(save.timer)} • ${isBest ? "New personal best" : "Progress saved"}.</p><div class="quick-grid"><article class="stat-card"><span class="muted">Completed</span><strong>${gameStats.completed} / ${LEVELS}</strong></article><article class="stat-card"><span class="muted">Best Time</span><strong>${bestForGame ? fmt(bestForGame) : fmt(save.timer)}</strong></article></div><div class="action-row"><button class="accent-button" data-action="next-level" type="button">Next Level</button><button class="ghost-button" data-action="replay-level" type="button">Replay</button><button class="ghost-button" data-action="back-games" type="button">Back to Menu</button></div></article>` : ""}<article class="board-shell ${isSudoku ? "sudoku-shell" : ""}"><div class="route-head ${isSudoku ? "sudoku-head" : ""}">${isSudoku ? `<div class="sudoku-level-wrap"><p class="eyebrow">${save.difficulty.toUpperCase()}</p><h2 class="board-title">Level ${save.level}</h2></div><div class="sudoku-timer-wrap"><strong class="sudoku-timer" data-live-timer="1">${fmt(save.timer)}</strong><span class="muted">${syncLabel()}</span></div>` : `<div><p class="eyebrow">${meta[save.game].title}</p><h2 class="board-title">Level ${save.level}</h2></div><div class="board-summary"><strong>${fmt(save.timer)}</strong><span class="muted">${syncLabel()}</span></div>`}</div>${save.game === "kakuro" ? `<article class="list-card kakuro-intro"><h3>Kakuro</h3><p class="muted">Use clues on dark cells to complete each run total.</p></article>` : ""}<div class="board-frame ${isSudoku ? "sudoku-frame" : ""}">${boardView(save, def)}</div><div class="board-actions ${isSudoku ? "sudoku-actions" : ""}">${useDigitShell ? pad : `<div class="control-strip"><button class="toggle-button ${state.noteMode ? "active" : ""}" data-action="notes" type="button">Notes</button><button class="toggle-button" data-action="hint" type="button">Hint</button><button class="toggle-button" data-action="undo" type="button">Undo</button><button class="toggle-button" data-action="redo" type="button">Redo</button></div>${pad}`}</div></article></section>`;
}

function progressView() {
  return `<section class="stack"><article class="panel"><div class="section-head"><h2 class="section-title">Overall Progress</h2><strong>${state.stats.totalCompleted} solved</strong></div><p class="muted">Long journey mode. Every game scales to 10,000 seeded levels.</p><div class="quick-grid"><article class="stat-card"><span class="muted">Total Play Time</span><strong>${fmt(totalPlayTime())}</strong></article><article class="stat-card"><span class="muted">Hints Used</span><strong>${state.stats.hints || 0}</strong></article></div>${GAMES.map((game) => { const stats = perGameStats(game); return `<div class="chart-row"><div class="stats-line"><span>${meta[game].title}</span><strong>${stats.completed} / ${LEVELS}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${pct(game)}%"></div></div><div class="quick-grid"><article class="stat-card"><span class="muted">Best Time</span><strong>${stats.best ? fmt(stats.best) : "--:--"}</strong></article><article class="stat-card"><span class="muted">Average Time</span><strong>${stats.avg ? fmt(stats.avg) : "--:--"}</strong></article></div></div>`; }).join("")}</article><article class="panel"><div class="section-head"><h2 class="section-title">Achievements</h2><span class="muted">${achievementRows().filter((item) => item.done).length} unlocked</span></div><div class="achievement-list">${achievementRows().map((item) => `<article class="achievement-card"><div class="stats-line"><strong>${item.label}</strong><span class="tag ${item.done ? "done" : "pending"}">${item.done ? "Unlocked" : "Locked"}</span></div><p class="muted">${item.progress}</p></article>`).join("")}</div></article></section>`;
}

function profileView() {
  return `<section class="stack"><article class="panel"><p class="eyebrow">Player Profile</p><h2 class="section-title">${state.profile.name}</h2><p class="muted">Avatar ${state.profile.avatar} • ${syncLabel()}</p><div class="quick-grid"><article class="stat-card"><span class="muted">Total Solved</span><strong>${state.stats.totalCompleted}</strong></article><article class="stat-card"><span class="muted">Current Streak</span><strong>${state.stats.streak || 0}</strong></article></div></article></section>`;
}

function settingsView() {
  return `<section class="stack"><article class="setting-card"><div class="switch-row"><span>Dark Mode</span><input id="dark-mode" type="checkbox" ${state.settings.dark ? "checked" : ""}></div><div class="switch-row"><span>Cloud Sync</span><input id="cloud-sync" type="checkbox" ${state.settings.cloudSync ? "checked" : ""}></div><div class="action-row"><button class="accent-button" data-action="save-settings" type="button">Save Settings</button><button class="ghost-button" data-action="export" type="button">Export Save Data</button></div><div class="action-row"><a class="ghost-button connect-link" href="./connect.html">Connect Device</a><button class="ghost-button" data-action="sync-now" type="button">Sync Now</button></div><p class="muted">Safe DB mode: only table prefix <code>puzzlehub_*</code>. Current: ${syncLabel()}</p></article><article class="panel"><div class="section-head"><h3>Cloud Status</h3><span class="muted">${state.cloud.userId ? "Connected" : "Not connected"}</span></div><div class="quick-grid"><article class="stat-card"><span class="muted">Status</span><strong>${state.cloud.status}</strong></article><article class="stat-card"><span class="muted">Last Sync</span><strong>${state.cloud.lastSyncedAt ? new Date(state.cloud.lastSyncedAt).toLocaleTimeString() : "Never"}</strong></article></div><p class="muted">${state.cloud.userId ? "This device can sync with cloud whenever internet returns." : "Connect this device first. After that, save states will sync into Supabase automatically."}</p></article><article class="panel"><div class="section-head"><h3>Sync Debug</h3><span class="muted">${state.cloud.userId || "No user id"}</span></div><div class="list-card">${(state.cloud.debug || []).length ? state.cloud.debug.map((line) => `<p class="muted">${line}</p>`).join("") : `<p class="muted">No debug logs yet.</p>`}</div></article></section>`;
}

function solveCheck(save) {
  const def = puzzle(save.game, save.difficulty, save.level);
  let solved = false;
  if (save.game === "sumplete") solved = save.board.every((row, ri) => row.every((mode, ci) => def.keep[ri][ci] ? mode !== "remove" : mode === "remove"));
  else solved = save.board.every((row, ri) => row.every((v, ci) => v === def.solution[ri][ci]));
  if (!solved || save.completed) return;
  save.completed = true;
  state.completed[save.key] = { at: new Date().toISOString(), time: save.timer };
  state.stats.totalCompleted += 1;
  state.stats.bestTimes = state.stats.bestTimes || {};
  const currentBest = state.stats.bestTimes[save.game];
  if (!currentBest || save.timer < currentBest) state.stats.bestTimes[save.game] = save.timer;
  updateStreak();
  persistNow();
  toast("Puzzle Complete");
  render();
}

function updateStreak() {
  const today = new Date().toISOString();
  const last = state.stats.lastCompletedAt || null;
  if (sameDay(last, today)) return;
  if (!last) state.stats.streak = 1;
  else {
    const diff = Math.round((new Date(today.slice(0,10)) - new Date(last.slice(0,10))) / 86400000);
    state.stats.streak = diff === 1 ? state.stats.streak + 1 : 1;
  }
  state.stats.lastCompletedAt = today;
  state.stats.longest = Math.max(state.stats.longest || 0, state.stats.streak);
}

function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "puzzlehub-export.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function ensureSession() {
  if (!supabase || !state.settings.cloudSync) {
    state.cloud.status = "Local only";
    render();
    return;
  }
  try {
    pushDebug("Checking auth session");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    state.cloud.userId = data.session?.user?.id || null;
    state.cloud.enabled = Boolean(state.cloud.userId);
    state.cloud.status = state.cloud.userId ? "Cloud ready" : "Local save active";
  } catch (error) {
    state.cloud.enabled = false;
    state.cloud.status = error.message || "Cloud unavailable";
    pushDebug(`Session error: ${error.message || error}`);
  }
  render();
}

async function pullCloud() {
  if (pullInFlight) { pushDebug("Pull skipped: already running"); return; }
  if (!supabase) { pushDebug("Pull skipped: no Supabase client"); return; }
  if (!state.cloud.userId) { pushDebug("Pull skipped: no user id"); return; }
  if (!state.settings.cloudSync) { pushDebug("Pull skipped: cloud sync off"); return; }
  const userId = state.cloud.userId;
  pullInFlight = true;
  try {
    pushDebug("Pulling cloud data");
    pushDebug("Pull profiles start");
    const profileRes = await withTimeout("profiles select", supabase.from(SYNC_TABLES.profiles).select("*").eq("id", userId).maybeSingle());
    pushDebug("Pull profiles ok");
    pushDebug("Pull settings start");
    const settingsRes = await withTimeout("settings select", supabase.from(SYNC_TABLES.settings).select("*").eq("user_id", userId).maybeSingle());
    pushDebug("Pull settings ok");
    pushDebug("Pull progress start");
    const progressRes = await withTimeout("progress select", supabase.from(SYNC_TABLES.progress).select("*").eq("user_id", userId));
    pushDebug("Pull progress ok");
    pushDebug("Pull saves start");
    const savesRes = await withTimeout("saves select", supabase.from(SYNC_TABLES.saves).select("*").eq("user_id", userId));
    pushDebug("Pull saves ok");
    if (profileRes.data) {
      state.profile.name = profileRes.data.display_name || state.profile.name;
      state.profile.avatar = profileRes.data.avatar || state.profile.avatar;
    }
    if (settingsRes.data) {
      state.settings.dark = settingsRes.data.dark_mode;
      state.settings.sound = settingsRes.data.sound_effects;
      state.settings.animations = settingsRes.data.animations;
      state.settings.cloudSync = settingsRes.data.cloud_sync;
    }
    if (Array.isArray(progressRes.data)) {
      for (const row of progressRes.data) {
        const progress = row.progress_json || {};
        if (progress.completed) Object.assign(state.completed, progress.completed);
        if (progress.stats) state.stats = { ...state.stats, ...progress.stats };
      }
    }
    if (Array.isArray(savesRes.data)) {
      for (const row of savesRes.data) {
        const local = state.saves[row.puzzle_key];
        if (!local || new Date(row.updated_at) > new Date(local.updatedAt || 0)) {
          state.saves[row.puzzle_key] = {
            key: row.puzzle_key,
            game: row.game_type,
            difficulty: row.difficulty,
            level: row.level_number,
            timer: row.timer,
            completed: row.completed,
            board: row.board_state,
            notes: row.notes,
            updatedAt: row.updated_at,
            hintsUsed: row.hints_used || 0
          };
        }
      }
    }
    state.cloud.lastSyncedAt = new Date().toISOString();
    state.cloud.status = "Pulled";
    pushDebug(`Pull complete: profiles=${Boolean(profileRes.data)} settings=${Boolean(settingsRes.data)} progress=${progressRes.data?.length || 0} saves=${savesRes.data?.length || 0}`);
    persistNow(false);
    render();
  } catch (error) {
    state.cloud.status = error.message || "Pull failed";
    pushDebug(`Pull failed: ${error.message || error}`);
    toast(`Pull failed: ${error.message || error}`);
    render();
  } finally {
    pullInFlight = false;
  }
}

async function pushCloud() {
  if (pushInFlight) { pushDebug("Push skipped: already running"); return; }
  if (!supabase) { pushDebug("Push skipped: no Supabase client"); return; }
  if (!state.cloud.userId) { pushDebug("Push skipped: no user id"); return; }
  if (!state.settings.cloudSync) { pushDebug("Push skipped: cloud sync off"); return; }
  if (!isOnline()) { pushDebug("Push skipped: offline"); return; }
  const userId = state.cloud.userId;
  pushInFlight = true;
  try {
    pushDebug(`Push start for ${userId}`);
    pushDebug("profiles upsert start");
    const profileWrite = await withTimeout("profiles upsert", supabase.from(SYNC_TABLES.profiles).upsert({ id: userId, display_name: state.profile.name, avatar: state.profile.avatar }));
    if (profileWrite.error) throw new Error(`profiles: ${profileWrite.error.message}`);
    pushDebug("profiles upsert ok");
    pushDebug("settings upsert start");
    const settingsWrite = await withTimeout("settings upsert", supabase.from(SYNC_TABLES.settings).upsert({
      user_id: userId,
      dark_mode: state.settings.dark,
      sound_effects: state.settings.sound,
      animations: state.settings.animations,
      cloud_sync: state.settings.cloudSync
    }, { onConflict: "user_id" }));
    if (settingsWrite.error) throw new Error(`settings: ${settingsWrite.error.message}`);
    pushDebug("settings upsert ok");
    pushDebug("progress upsert start");
    const progressWrite = await withTimeout("progress upsert", supabase.from(SYNC_TABLES.progress).upsert(GAMES.map((game) => ({
      user_id: userId,
      game_type: game,
      progress_json: {
        completed: Object.fromEntries(Object.entries(state.completed).filter(([saveKey]) => saveKey.startsWith(`${game}-`))),
        stats: state.stats
      }
    })), { onConflict: "user_id,game_type" }));
    if (progressWrite.error) throw new Error(`progress: ${progressWrite.error.message}`);
    pushDebug("progress upsert ok");
    const saves = Object.values(state.saves).map((save) => ({
      user_id: userId,
      puzzle_key: save.key,
      game_type: save.game,
      level_number: save.level,
      difficulty: save.difficulty,
      is_daily: false,
      timer: save.timer,
      board_state: save.board,
      notes: save.notes,
      completed: save.completed,
      hints_used: save.hintsUsed || 0,
      last_played: save.updatedAt || new Date().toISOString(),
      updated_at: save.updatedAt || new Date().toISOString()
    }));
    if (saves.length) { pushDebug(`saves upsert start (${saves.length})`); const savesWrite = await withTimeout("saves upsert", supabase.from(SYNC_TABLES.saves).upsert(saves, { onConflict: "user_id,puzzle_key" })); if (savesWrite.error) throw new Error(`saves: ${savesWrite.error.message}`); pushDebug(`saves upsert ok (${saves.length})`); } else { pushDebug("no saves to upsert"); }
    state.cloud.lastSyncedAt = new Date().toISOString();
    state.cloud.status = "Synced";
    pushDebug("Push complete");
    persistNow(false);
    render();
  } catch (error) {
    state.cloud.status = error.message || "Sync failed";
    pushDebug(`Push failed: ${error.message || error}`);
    toast(`Sync failed: ${error.message || error}`);
    render();
  } finally {
    pushInFlight = false;
  }
}

function queueSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { pushCloud(); }, 800);
}

function handleAction(event) {
  const nav = event.target.closest("[data-route]");
  if (nav) { state.route = nav.dataset.route; render(); return; }
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "library") { state.game = btn.dataset.game; state.levelPage = 1; state.route = "games"; render(); return; }
  if (action === "pick-game") { state.game = btn.dataset.game; state.levelPage = 1; persistNow(false); render(); return; }
  if (action === "difficulty") { state.difficulty = btn.dataset.difficulty; state.levelPage = 1; persistNow(false); render(); return; }
  if (action === "page-levels") { state.levelPage = Number(btn.dataset.page); persistNow(false); render(); return; }
  if (action === "start") {
    const save = ensureSave(btn.dataset.game, btn.dataset.difficulty, 1);
    state.currentKey = save.key; state.route = "play"; upsertRecent(save.key); persist(); render(); return;
  }
  if (action === "open") {
    const level = Number(btn.dataset.level);
    const levelKey = key(btn.dataset.game, btn.dataset.difficulty, level);
    if (state.completed[levelKey]) { toast("Level already completed"); return; }
    const save = ensureSave(btn.dataset.game, btn.dataset.difficulty, level);
    state.currentKey = save.key; state.route = "play"; upsertRecent(save.key); persist(); render(); return;
  }
  if (action === "resume") { const save = state.saves[btn.dataset.key]; if (!save || save.completed) { toast("No active puzzle to continue"); render(); return; } state.currentKey = save.key; state.route = "play"; upsertRecent(save.key); persist(); render(); return; }
  if (action === "next-level") { const save = currentSave(); if (!save) return; const nextSave = ensureSave(save.game, save.difficulty, Math.min(LEVELS, save.level + 1)); state.currentKey = nextSave.key; state.selected = null; state.route = "play"; upsertRecent(nextSave.key); persist(); render(); return; }
  if (action === "replay-level") { const save = currentSave(); if (!save) return; delete state.saves[save.key]; const replay = ensureSave(save.game, save.difficulty, save.level); state.currentKey = replay.key; state.selected = null; state.route = "play"; upsertRecent(replay.key); persist(); render(); return; }
  if (action === "back-games") { const save = currentSave(); if (!save) return; state.game = save.game; state.difficulty = save.difficulty; state.route = "games"; render(); return; }
  if (action === "cell") { const save = currentSave(); if (save && save.game === "sumplete") { const row = Number(btn.dataset.row); const col = Number(btn.dataset.col); recordHistory(save); const current = save.board[row][col]; const next = current === "keep" ? "remove" : current === "remove" ? "lock" : "keep"; save.board[row][col] = next; markTouched(save); solveCheck(save); render(); return; } state.selected = { row: Number(btn.dataset.row), col: Number(btn.dataset.col) }; render(); return; }
  if (action === "notes") { const save = currentSave(); if (save && save.completed) { toast("Puzzle already complete"); return; } state.noteMode = !state.noteMode; render(); return; }
  if (action === "digit") {
    const save = currentSave(); if (!save || !state.selected) return;
    const def = puzzle(save.game, save.difficulty, save.level); const { row, col } = state.selected; if (def.puzzle[row][col]) return;
    recordHistory(save);
    if (state.noteMode) {
      const notes = new Set(save.notes[row][col]); const value = Number(btn.dataset.value); if (notes.has(value)) notes.delete(value); else notes.add(value); save.notes[row][col] = [...notes].sort((a,b) => a-b);
    } else { save.board[row][col] = Number(btn.dataset.value); save.notes[row][col] = []; }
    markTouched(save); solveCheck(save); render(); return;
  }
  if (action === "erase") { const save = currentSave(); if (!save || !state.selected) return; const { row, col } = state.selected; recordHistory(save); save.board[row][col] = 0; save.notes[row][col] = []; markTouched(save); render(); return; }
  if (action === "sumplete") { const save = currentSave(); if (!save || !state.selected) return; const { row, col } = state.selected; save.board[row][col] = btn.dataset.mode; markTouched(save); solveCheck(save); render(); return; }
  if (action === "undo") { const save = currentSave(); if (!save?.history?.length) { toast("Nothing to undo"); return; } save.future = save.future || []; save.future.push(snapshotSave(save)); restoreSnapshot(save, save.history.pop()); render(); return; }
  if (action === "redo") { const save = currentSave(); if (!save?.future?.length) { toast("Nothing to redo"); return; } save.history = save.history || []; save.history.push(snapshotSave(save)); restoreSnapshot(save, save.future.pop()); render(); return; }
  if (action === "hint") {
    const save = currentSave(); if (!save) return; if (save.completed) { toast("Puzzle already complete"); return; } if (!state.selected) { toast("Select cell first"); return; } const def = puzzle(save.game, save.difficulty, save.level); const { row, col } = state.selected;
    recordHistory(save);
    if (save.game === "sumplete") save.board[row][col] = def.keep[row][col] ? "keep" : "remove";
    else if (!def.puzzle[row][col]) save.board[row][col] = def.solution[row][col];
    state.stats.hints += 1; save.hintsUsed = (save.hintsUsed || 0) + 1; markTouched(save); solveCheck(save); render(); return;
  }
  if (action === "save-settings") {
    state.settings.dark = document.getElementById("dark-mode").checked;
    state.settings.cloudSync = document.getElementById("cloud-sync").checked;
    persist(); render(); toast("Settings saved"); return;
  }
  if (action === "sync-now") { pushDebug("Settings sync-now tapped"); ensureSession().then(() => pullCloud()).then(() => pushCloud()).then(() => { pushDebug(`Settings sync-now finished: ${syncLabel()}`); toast(syncLabel()); }); return; }
  if (action === "export") exportState();
}

document.addEventListener("click", handleAction);
syncButton.addEventListener("click", async () => { pushDebug("Manual sync button tapped"); await ensureSession(); await pullCloud(); await pushCloud(); pushDebug(`Manual sync finished: ${syncLabel()}`); toast(syncLabel()); });
setInterval(() => {
  const save = currentSave();
  if (!save || state.route !== "play" || save.completed) return;
  save.timer += 1;
  state.stats.totalPlaySeconds = (state.stats.totalPlaySeconds || 0) + 1;
  save.updatedAt = new Date().toISOString();
  persist();
  const node = document.querySelector(`[data-live-timer="1"]`) || document.querySelector(".board-summary strong");
  if (node) node.textContent = fmt(save.timer);
}, 1000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); const btn = document.getElementById("install-button"); btn.classList.remove("hidden"); btn.onclick = async () => { await event.prompt(); btn.classList.add("hidden"); }; });
window.addEventListener("online", () => { queueSync(); render(); });
window.addEventListener("offline", () => render());
if (supabase) {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.cloud.userId = session?.user?.id || null;
    state.cloud.enabled = Boolean(state.cloud.userId);
    state.cloud.status = state.cloud.userId ? "Cloud ready" : "Connect device for cloud sync";
    if (state.cloud.userId) await pullCloud();
    render();
  });
}
ensureSession().then(() => pullCloud()).then(() => render());
render();
