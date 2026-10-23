'use strict';

const STORAGE_KEY = 'score-keeper:v2';

const $ = (sel) => document.querySelector(sel);

const els = {
  tableWrap: $('#tableWrap'),
  head: $('#scoresHead'),
  body: $('#scoresBody'),
  empty: $('#empty'),
  addPlayerBtn: $('#addPlayerBtn'),
  addRoundBtn: $('#addRoundBtn'),
  clearScoresBtn: $('#clearScoresBtn'),
  highWinsBtn: $('#highWinsBtn'),
  lowWinsBtn: $('#lowWinsBtn'),
  playerDialog: $('#playerDialog'),
  playerTitle: $('#playerTitle'),
  playerName: $('#playerName'),
  deletePlayerBtn: $('#deletePlayerBtn'),
  confirmDialog: $('#confirmDialog'),
  confirmTitle: $('#confirmTitle'),
  confirmMessage: $('#confirmMessage'),
  confirmOkBtn: $('#confirmOkBtn'),
};

// ---- State ----
// players: [{ id, name }]
// rounds:  [{ id, scores: { [playerId]: number } }]  (a missing score counts as 0)
// lowWins: true when the lowest total wins

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.players) && Array.isArray(saved.rounds)) return { lowWins: false, ...saved };
  } catch { /* fall through to a fresh state */ }
  return { players: [], rounds: [], lowWins: false };
}

// Once there are players there is always at least one round to type into;
// with no players there are no rounds.
function normalize() {
  if (state.players.length === 0) state.rounds = [];
  else if (state.rounds.length === 0) state.rounds.push({ id: newId(), scores: {} });
}

let state = loadState();
normalize();

function save() {
  normalize();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* storage full or unavailable; keep running in memory */ }
}

const findPlayer = (id) => state.players.find((p) => p.id === id);
const round3 = (n) => Math.round(n * 1000) / 1000;

function totalFor(playerId) {
  return round3(state.rounds.reduce((sum, r) => sum + (Number(r.scores[playerId]) || 0), 0));
}

const formatNumber = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

// ---- Actions ----

function addPlayer(name) {
  state.players.push({ id: newId(), name });
  save();
  render();
}

function renamePlayer(id, name) {
  const player = findPlayer(id);
  if (!player) return;
  player.name = name;
  save();
  render();
}

async function deletePlayer(id) {
  const player = findPlayer(id);
  if (!player) return;
  const ok = await askConfirm(`Delete ${player.name}?`, 'Their scores in every round will be removed too.', 'Delete');
  if (!ok) return;
  state.players = state.players.filter((p) => p.id !== id);
  state.rounds.forEach((r) => { delete r.scores[id]; });
  save();
  render();
}

function addRound() {
  state.rounds.push({ id: newId(), scores: {} });
  save();
  render();
  // Jump to the new round and start typing the first player's score.
  els.tableWrap.scrollLeft = els.tableWrap.scrollWidth;
  const first = els.body.querySelector(`input[data-round="${state.rounds.length - 1}"]`);
  if (first) first.focus();
}

async function deleteRound(index) {
  const ok = await askConfirm(`Delete Round ${index + 1}?`, 'Every score in this round will be removed.', 'Delete');
  if (!ok) return;
  state.rounds.splice(index, 1);
  save();
  render();
}

function setLowWins(lowWins) {
  state.lowWins = lowWins;
  save();
  render();
}

async function clearScores() {
  const ok = await askConfirm('Clear all scores?', 'Every round will be removed and you start again at Round 1. Players are kept.', 'Clear');
  if (!ok) return;
  state.rounds = [];
  save();
  render();
}

// ---- Rendering ----

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// Marks the player(s) with the winning total. Nobody leads before any
// scores are in or while everyone is tied.
function updateLeaders() {
  const totals = state.players.map((p) => totalFor(p.id));
  const tied = totals.every((t) => t === totals[0]);
  const best = state.lowWins ? Math.min(...totals) : Math.max(...totals);
  els.body.querySelectorAll('tr').forEach((row) => {
    const leads = !tied && state.players.length > 1 && totalFor(row.dataset.player) === best;
    row.classList.toggle('leader', leads);
  });
}

function render() {
  els.highWinsBtn.setAttribute('aria-pressed', String(!state.lowWins));
  els.lowWinsBtn.setAttribute('aria-pressed', String(state.lowWins));

  const hasPlayers = state.players.length > 0;
  els.tableWrap.hidden = !hasPlayers;
  els.empty.hidden = hasPlayers;
  els.addRoundBtn.hidden = !hasPlayers;
  els.clearScoresBtn.hidden = !hasPlayers;

  // Header: Player | Round 1 … Round N | Total
  const headRow = el('tr', {}, [el('th', { className: 'name-col', scope: 'col', textContent: 'Player' })]);
  state.rounds.forEach((_, i) => {
    const btn = el('button', { className: 'ghost round-btn', textContent: `R${i + 1}`, title: `Delete Round ${i + 1}` });
    btn.dataset.round = i;
    btn.setAttribute('aria-label', `Round ${i + 1}. Tap to delete this round.`);
    headRow.append(el('th', { className: 'round-head', scope: 'col' }, [btn]));
  });
  headRow.append(el('th', { className: 'total-col', scope: 'col', textContent: 'Total' }));
  els.head.replaceChildren(headRow);

  // One row per player.
  els.body.replaceChildren(...state.players.map((p) => {
    const nameBtn = el('button', { className: 'name-btn' }, [el('span', { className: 'name-text', textContent: p.name })]);
    nameBtn.dataset.player = p.id;
    nameBtn.setAttribute('aria-label', `${p.name}. Tap to edit.`);

    const row = el('tr', {}, [el('th', { className: 'name-col', scope: 'row' }, [nameBtn])]);
    row.dataset.player = p.id;

    state.rounds.forEach((r, i) => {
      const value = r.scores[p.id];
      const input = el('input', {
        className: 'score-input',
        type: 'number',
        step: 'any',
        value: value === undefined ? '' : String(value),
        placeholder: '–',
        enterKeyHint: 'next',
      });
      input.dataset.round = i;
      input.dataset.player = p.id;
      input.setAttribute('aria-label', `${p.name}, Round ${i + 1}`);
      row.append(el('td', {}, [input]));
    });

    const total = el('td', { className: 'total-col', textContent: formatNumber(totalFor(p.id)) });
    total.dataset.total = p.id;
    row.append(total);
    return row;
  }));

  updateLeaders();
}

// ---- Confirm dialog ----
// The app's own are-you-sure sheet. Resolves true only when the user taps the
// confirm button; Cancel or tapping outside resolves false.

function askConfirm(title, message, okLabel) {
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmOkBtn.textContent = okLabel;
  els.confirmDialog.returnValue = '';
  els.confirmDialog.showModal();
  return new Promise((resolve) => {
    els.confirmDialog.addEventListener('close', () => resolve(els.confirmDialog.returnValue === 'ok'), { once: true });
  });
}

els.confirmDialog.addEventListener('click', (e) => {
  if (e.target === els.confirmDialog) els.confirmDialog.close('cancel');
});

// ---- Player dialog ----

let editingPlayerId = null;

function openPlayerDialog(id) {
  editingPlayerId = id;
  const player = id ? findPlayer(id) : null;
  els.playerTitle.textContent = player ? 'Edit player' : 'Add player';
  els.playerName.value = player ? player.name : '';
  els.deletePlayerBtn.hidden = !player;
  els.playerDialog.returnValue = '';
  els.playerDialog.showModal();
  els.playerName.focus();
}

els.playerDialog.addEventListener('close', () => {
  const action = els.playerDialog.returnValue;
  const name = els.playerName.value.trim().slice(0, 24);
  els.playerName.blur();
  if (action === 'save' && name) {
    if (editingPlayerId) renamePlayer(editingPlayerId, name);
    else addPlayer(name);
  } else if (action === 'delete' && editingPlayerId) {
    deletePlayer(editingPlayerId);
  }
});

// Return in the name field saves.
els.playerName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    els.playerDialog.close('save');
  }
});

// Tapping the dimmed backdrop closes the sheet.
els.playerDialog.addEventListener('click', (e) => {
  if (e.target === els.playerDialog) els.playerDialog.close('cancel');
});

// ---- Events ----

els.addPlayerBtn.addEventListener('click', () => openPlayerDialog(null));
els.addRoundBtn.addEventListener('click', addRound);
els.clearScoresBtn.addEventListener('click', clearScores);
els.highWinsBtn.addEventListener('click', () => setLowWins(false));
els.lowWinsBtn.addEventListener('click', () => setLowWins(true));

els.body.addEventListener('click', (e) => {
  const nameBtn = e.target.closest('.name-btn');
  if (nameBtn) openPlayerDialog(nameBtn.dataset.player);
});

els.head.addEventListener('click', (e) => {
  const roundBtn = e.target.closest('.round-btn');
  if (roundBtn) deleteRound(Number(roundBtn.dataset.round));
});

// Typing a score updates that player's total right away.
els.body.addEventListener('input', (e) => {
  const input = e.target.closest('.score-input');
  if (!input) return;
  const r = state.rounds[Number(input.dataset.round)];
  const playerId = input.dataset.player;
  const value = parseFloat(input.value);
  if (Number.isFinite(value)) r.scores[playerId] = value;
  else delete r.scores[playerId];
  save();
  els.body.querySelector(`[data-total="${playerId}"]`).textContent = formatNumber(totalFor(playerId));
  updateLeaders();
});

// Return moves down to the next player in the same round.
els.body.addEventListener('keydown', (e) => {
  const input = e.target.closest('.score-input');
  if (!input || e.key !== 'Enter') return;
  e.preventDefault();
  const column = [...els.body.querySelectorAll(`input[data-round="${input.dataset.round}"]`)];
  const next = column[column.indexOf(input) + 1];
  if (next) next.focus();
  else input.blur();
});

render();

// ---- Offline support ----

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline caching unavailable */ });
  });
}
