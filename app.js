'use strict';

const STORAGE_KEY = 'score-keeper:v2';

const $ = (sel) => document.querySelector(sel);

const els = {
  tableWrap: $('#tableWrap'),
  head: $('#scoresHead'),
  body: $('#scoresBody'),
  addRoundBtn: $('#addRoundBtn'),
  clearScoresBtn: $('#clearScoresBtn'),
  highWinsBtn: $('#highWinsBtn'),
  lowWinsBtn: $('#lowWinsBtn'),
  clearPlayersBtn: $('#clearPlayersBtn'),
  confirmDialog: $('#confirmDialog'),
  confirmTitle: $('#confirmTitle'),
  confirmMessage: $('#confirmMessage'),
  confirmOkBtn: $('#confirmOkBtn'),
};

// ---- State ----
// players: [{ id, name }]
// rounds:  [{ id, scores: { [playerId]: number } }]  (a missing score counts as 0)
// lowWins: true when the lowest total wins
// sortKey: 'name', 'total', or null for the order players were added
// sortDir: 'asc' or 'desc'

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function loadState() {
  const defaults = { players: [], rounds: [], lowWins: false, sortKey: null, sortDir: 'asc' };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.players) && Array.isArray(saved.rounds)) {
      // Earlier versions only had "sort by total, winner first".
      if ('sortByTotal' in saved) {
        if (saved.sortByTotal) Object.assign(saved, { sortKey: 'total', sortDir: saved.lowWins ? 'asc' : 'desc' });
        delete saved.sortByTotal;
      }
      return { ...defaults, ...saved };
    }
  } catch { /* fall through to a fresh state */ }
  return defaults;
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
const cleanName = (s) => s.trim().slice(0, 24);

function totalFor(playerId) {
  return round3(state.rounds.reduce((sum, r) => sum + (Number(r.scores[playerId]) || 0), 0));
}

const formatNumber = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

// ---- Actions ----

function addPlayer(name) {
  state.players.push({ id: newId(), name });
  save();
}

// Resolves true if the player was deleted, false if the user cancelled.
async function deletePlayer(id) {
  const player = findPlayer(id);
  if (!player) return false;
  const ok = await askConfirm(`Delete ${player.name}?`, 'Their scores in every round will be removed too.', 'Delete');
  if (!ok) return false;
  state.players = state.players.filter((p) => p.id !== id);
  state.rounds.forEach((r) => { delete r.scores[id]; });
  save();
  render();
  return true;
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

// Tapping a column header sorts ascending, then descending, then goes back
// to the order players were added.
function toggleSort(key) {
  if (state.sortKey !== key) {
    state.sortKey = key;
    state.sortDir = 'asc';
  } else if (state.sortDir === 'asc') {
    state.sortDir = 'desc';
  } else {
    state.sortKey = null;
    state.sortDir = 'asc';
  }
  save();
  render();
}

async function clearPlayers() {
  const ok = await askConfirm('Clear all players?', 'Every player and all of their scores will be deleted.', 'Clear');
  if (!ok) return;
  state.players = [];
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

// Sizes a name box to fit its text, so the crown can sit right after the name.
const measureCtx = document.createElement('canvas').getContext('2d');
function fitName(input) {
  const cs = getComputedStyle(input);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  input.style.width = `${Math.ceil(measureCtx.measureText(input.value || ' ').width) + 10}px`;
}

// The "+ Add player" row at the bottom of the table. It's built once and kept
// in place (never removed and re-added), so typing several names in a row
// doesn't close the keyboard.
const newPlayerInput = el('input', {
  className: 'name-input',
  type: 'text',
  maxLength: 24,
  placeholder: '+ Add player',
  autocomplete: 'off',
  spellcheck: false,
  enterKeyHint: 'done',
});
newPlayerInput.setAttribute('autocapitalize', 'words');
newPlayerInput.setAttribute('autocorrect', 'off');
newPlayerInput.setAttribute('aria-label', 'Add a player');
const newPlayerRow = el('tr', { className: 'new-player' }, [
  el('th', { className: 'name-col', scope: 'row' }, [el('div', { className: 'name-cell' }, [newPlayerInput])]),
]);

// Marks the player(s) with the winning total. Nobody leads before any
// scores are in or while everyone is tied.
function updateLeaders() {
  const totals = state.players.map((p) => totalFor(p.id));
  const tied = totals.every((t) => t === totals[0]);
  const best = state.lowWins ? Math.min(...totals) : Math.max(...totals);
  els.body.querySelectorAll('tr[data-player]').forEach((row) => {
    const leads = !tied && state.players.length > 1 && totalFor(row.dataset.player) === best;
    row.classList.toggle('leader', leads);
  });
}

// Players in display order. Sorting is stable, so ties keep the order added.
function playersInOrder() {
  if (!state.sortKey) return state.players;
  const sign = state.sortDir === 'asc' ? 1 : -1;
  const compare = state.sortKey === 'name'
    ? (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    : (a, b) => totalFor(a.id) - totalFor(b.id);
  return [...state.players].sort((a, b) => sign * compare(a, b));
}

const isTableInput = (node) => !!node && node.tagName === 'INPUT' && els.body.contains(node);

// Identifies the focused box so focus can be put back after a redraw.
function focusKey(node) {
  if (!isTableInput(node) || node === newPlayerInput) return null;
  return node.classList.contains('score-input')
    ? `.score-input[data-player="${node.dataset.player}"][data-round="${node.dataset.round}"]`
    : `.name-input[data-player="${node.dataset.player}"]`;
}

let displayedOrder = [];

// keepOrder: leave rows where they are (new players go at the bottom) instead
// of re-sorting, used while you're still typing in the table.
function render({ keepOrder = false } = {}) {
  els.highWinsBtn.setAttribute('aria-pressed', String(!state.lowWins));
  els.lowWinsBtn.setAttribute('aria-pressed', String(state.lowWins));

  const hasPlayers = state.players.length > 0;
  els.addRoundBtn.hidden = !hasPlayers;
  els.clearScoresBtn.hidden = !hasPlayers;
  els.clearPlayersBtn.hidden = !hasPlayers;

  const refocus = focusKey(document.activeElement);

  // Header: Player | Round 1 … Round N | Total
  // Player and Total are sortable; the active one shows ▲ or ▼.
  const sortHeader = (label, key, className) => {
    const active = state.sortKey === key;
    const btn = el('button', { className: 'ghost sort-btn', textContent: label });
    btn.dataset.sortKey = key;
    if (active) btn.dataset.dir = state.sortDir;
    const th = el('th', { className, scope: 'col' }, [btn]);
    th.setAttribute('aria-sort', active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    return th;
  };
  const headRow = el('tr', {}, [sortHeader('Player', 'name', 'name-col')]);
  state.rounds.forEach((_, i) => {
    const btn = el('button', { className: 'ghost round-btn', textContent: `R${i + 1}`, title: `Delete Round ${i + 1}` });
    btn.dataset.round = i;
    btn.setAttribute('aria-label', `Round ${i + 1}. Tap to delete this round.`);
    headRow.append(el('th', { className: 'round-head', scope: 'col' }, [btn]));
  });
  headRow.append(sortHeader('Total', 'total', 'total-col'));
  els.head.replaceChildren(headRow);

  let order = playersInOrder();
  if (keepOrder) {
    const shown = displayedOrder.map(findPlayer).filter(Boolean);
    order = [...shown, ...state.players.filter((p) => !shown.includes(p))];
  }
  displayedOrder = order.map((p) => p.id);

  // One row per player.
  const rows = order.map((p) => {
    const nameInput = el('input', {
      className: 'name-input',
      type: 'text',
      maxLength: 24,
      value: p.name,
      autocomplete: 'off',
      spellcheck: false,
      enterKeyHint: 'done',
    });
    nameInput.dataset.player = p.id;
    nameInput.setAttribute('autocapitalize', 'words');
    nameInput.setAttribute('autocorrect', 'off');
    nameInput.setAttribute('aria-label', `Player name: ${p.name}. Clear the name to delete this player.`);
    const crown = el('span', { className: 'crown', textContent: '👑' });
    crown.setAttribute('aria-label', 'Winning');

    const row = el('tr', {}, [el('th', { className: 'name-col', scope: 'row' }, [el('div', { className: 'name-cell' }, [nameInput, crown])])]);
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
  });

  // Swap the player rows but leave the "+ Add player" row in the DOM.
  [...els.body.children].forEach((row) => { if (row !== newPlayerRow) row.remove(); });
  if (!newPlayerRow.isConnected) els.body.append(newPlayerRow);
  els.body.insertBefore(fragmentOf(rows), newPlayerRow);

  // Empty cells under each round and the total for the "+ Add player" row.
  while (newPlayerRow.children.length > 1) newPlayerRow.lastElementChild.remove();
  state.rounds.forEach(() => newPlayerRow.append(el('td')));
  newPlayerRow.append(el('td', { className: 'total-col' }));

  els.body.querySelectorAll('tr[data-player] .name-input').forEach(fitName);
  updateLeaders();

  if (refocus) {
    const target = els.body.querySelector(refocus);
    if (target) target.focus();
  }
}

function fragmentOf(nodes) {
  const frag = document.createDocumentFragment();
  frag.append(...nodes);
  return frag;
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

// ---- Events ----

els.addRoundBtn.addEventListener('click', addRound);
els.clearScoresBtn.addEventListener('click', clearScores);
els.highWinsBtn.addEventListener('click', () => setLowWins(false));
els.lowWinsBtn.addEventListener('click', () => setLowWins(true));
els.clearPlayersBtn.addEventListener('click', clearPlayers);

els.head.addEventListener('click', (e) => {
  const roundBtn = e.target.closest('.round-btn');
  if (roundBtn) deleteRound(Number(roundBtn.dataset.round));
  const sortBtn = e.target.closest('.sort-btn');
  if (sortBtn) toggleSort(sortBtn.dataset.sortKey);
});

els.body.addEventListener('input', (e) => {
  const input = e.target;

  // Typing a score updates that player's total right away.
  if (input.classList.contains('score-input')) {
    const r = state.rounds[Number(input.dataset.round)];
    const playerId = input.dataset.player;
    const value = parseFloat(input.value);
    if (Number.isFinite(value)) r.scores[playerId] = value;
    else delete r.scores[playerId];
    save();
    els.body.querySelector(`[data-total="${playerId}"]`).textContent = formatNumber(totalFor(playerId));
    updateLeaders();
    return;
  }

  // Renaming saves as you type (an empty name is handled when you leave the box).
  if (input.classList.contains('name-input') && input.dataset.player) {
    const player = findPlayer(input.dataset.player);
    const name = cleanName(input.value);
    if (player && name) {
      player.name = name;
      save();
    }
    fitName(input);
  }
});

// Remember a name before editing so Escape can put it back.
els.body.addEventListener('focusin', (e) => {
  if (e.target.classList.contains('name-input') && e.target.dataset.player) {
    e.target.dataset.original = e.target.value;
  }
});

els.body.addEventListener('keydown', (e) => {
  const input = e.target;

  // Return in "+ Add player" adds them and stays ready for the next name;
  // Return on an empty box finishes.
  if (input === newPlayerInput && e.key === 'Enter') {
    e.preventDefault();
    const name = cleanName(input.value);
    if (!name) { input.blur(); return; }
    addPlayer(name);
    input.value = '';
    render({ keepOrder: true });
    return;
  }

  if (input.classList.contains('name-input') && input.dataset.player) {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      const player = findPlayer(input.dataset.player);
      input.value = input.dataset.original || (player ? player.name : '');
      if (player) { player.name = input.value; save(); }
      fitName(input);
      input.blur();
    }
    return;
  }

  // Return in a score box moves down to the next player in the same round.
  if (input.classList.contains('score-input') && e.key === 'Enter') {
    e.preventDefault();
    const column = [...els.body.querySelectorAll(`input[data-round="${input.dataset.round}"]`)];
    const next = column[column.indexOf(input) + 1];
    if (next) next.focus();
    else input.blur();
  }
});

// Redraws that happen because you left a box (a newly added player, or
// re-sorting after edits) wait until any tap in progress has finished, so the
// tap still lands on what you tapped. While you're still in the table, rows
// stay put; they re-sort once you leave it.
let renderPending = false;
let pointerDown = false;

function flushRender() {
  if (!renderPending || pointerDown) return;
  renderPending = false;
  render({ keepOrder: isTableInput(document.activeElement) });
}

els.body.addEventListener('focusout', (e) => {
  const input = e.target;
  const stayingInTable = isTableInput(e.relatedTarget);

  if (input === newPlayerInput) {
    const name = cleanName(input.value);
    if (name) {
      addPlayer(name);
      input.value = '';
      renderPending = true;
    }
  } else if (input.classList.contains('name-input') && input.dataset.player) {
    const player = findPlayer(input.dataset.player);
    if (player && !cleanName(input.value)) {
      // Clearing a name deletes the player (after asking).
      deletePlayer(player.id).then((deleted) => {
        if (!deleted) {
          input.value = player.name;
          fitName(input);
        }
      });
    } else if (player) {
      input.value = player.name;
      fitName(input);
    }
  }

  if (!stayingInTable && state.sortKey) renderPending = true;
  if (renderPending) setTimeout(flushRender, 0);
});

document.addEventListener('pointerdown', () => { pointerDown = true; });
['pointerup', 'pointercancel'].forEach((type) => {
  document.addEventListener(type, () => {
    pointerDown = false;
    setTimeout(flushRender, 0);
  });
});

render();

// ---- Offline support ----

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline caching unavailable */ });
  });
}
