'use strict';

const STORAGE_KEY = 'score-keeper:v2';

const $ = (sel) => document.querySelector(sel);

const els = {
  tableWrap: $('#tableWrap'),
  head: $('#scoresHead'),
  body: $('#scoresBody'),
  addRoundBtn: $('#addRoundBtn'),
  menuBtn: $('#menuBtn'),
  menu: $('#menu'),
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
let openSwipeCell = null;

// keepOrder: leave rows where they are (new players go at the bottom) instead
// of re-sorting, used while you're still typing in the table.
function render({ keepOrder = false } = {}) {
  els.highWinsBtn.setAttribute('aria-pressed', String(!state.lowWins));
  els.lowWinsBtn.setAttribute('aria-pressed', String(state.lowWins));

  const hasPlayers = state.players.length > 0;
  els.addRoundBtn.hidden = !hasPlayers;
  els.clearScoresBtn.disabled = !hasPlayers;
  els.clearPlayersBtn.disabled = !hasPlayers;

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
  openSwipeCell = null; // the rows are rebuilt below, closed

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
    nameInput.setAttribute('aria-label', `Player name: ${p.name}. Swipe left or clear the name to delete this player.`);
    const crown = el('span', { className: 'crown', textContent: '👑' });
    crown.setAttribute('aria-label', 'Winning');

    // Revealed by swiping the name left (see "Swipe to delete" below).
    const deleteBtn = el('button', { className: 'swipe-delete', type: 'button', textContent: 'Delete', tabIndex: -1 });
    deleteBtn.dataset.player = p.id;
    deleteBtn.setAttribute('aria-label', `Delete ${p.name}`);

    const row = el('tr', {}, [el('th', { className: 'name-col', scope: 'row' }, [el('div', { className: 'name-cell' }, [nameInput, crown]), deleteBtn])]);
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

// ---- Settings menu (gear) ----

function setMenuOpen(open) {
  els.menu.hidden = !open;
  els.menuBtn.setAttribute('aria-expanded', String(open));
}

els.menuBtn.addEventListener('click', () => setMenuOpen(els.menu.hidden));

// Tapping anywhere outside the menu, or pressing Escape, closes it.
document.addEventListener('click', (e) => {
  if (!els.menu.hidden && !els.menu.contains(e.target) && !els.menuBtn.contains(e.target)) setMenuOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.menu.hidden) {
    setMenuOpen(false);
    els.menuBtn.focus();
  }
});

// The clear options close the menu before asking to confirm; the winner
// toggle leaves it open so you can see the change.
els.clearScoresBtn.addEventListener('click', () => { setMenuOpen(false); clearScores(); });
els.clearPlayersBtn.addEventListener('click', () => { setMenuOpen(false); clearPlayers(); });
els.highWinsBtn.addEventListener('click', () => setLowWins(false));
els.lowWinsBtn.addEventListener('click', () => setLowWins(true));

// ---- Events ----

els.addRoundBtn.addEventListener('click', addRound);

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

// ---- Swipe to delete ----
// Swiping a player's name to the left slides it over to reveal a red Delete
// button, like deleting an email on iPhone. Only one row is open at a time;
// tapping anywhere else closes it. (The name column ignores sideways
// scrolling so the swipe doesn't fight the table's scroll; the round columns
// still scroll as normal.)

const SWIPE_WIDTH = 76; // matches .swipe-delete width in styles.css
let swipe = null;

function setSwipeOffset(cell, x) {
  cell.style.transform = x ? `translateX(${x}px)` : '';
}

function closeSwipe() {
  if (!openSwipeCell) return;
  setSwipeOffset(openSwipeCell, 0);
  openSwipeCell = null;
}

document.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('tr[data-player] .name-cell');
  if (openSwipeCell && cell !== openSwipeCell && !e.target.closest('.swipe-delete')) closeSwipe();
  if (!cell) return;
  swipe = {
    cell,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    base: cell === openSwipeCell ? -SWIPE_WIDTH : 0,
    x: 0,
    active: false,
  };
});

document.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.pointerId) return;
  const dx = e.clientX - swipe.startX;
  const dy = e.clientY - swipe.startY;
  if (!swipe.active) {
    // Wait until the finger has clearly moved sideways; an up/down move is a scroll.
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 10) return;
    swipe.active = true;
    swipe.cell.classList.add('dragging');
    swipe.cell.setPointerCapture(e.pointerId);
    if (swipe.cell.contains(document.activeElement)) document.activeElement.blur();
  }
  swipe.x = Math.max(-SWIPE_WIDTH, Math.min(0, swipe.base + dx));
  setSwipeOffset(swipe.cell, swipe.x);
});

['pointerup', 'pointercancel'].forEach((type) => {
  document.addEventListener(type, (e) => {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    const s = swipe;
    swipe = null;
    if (!s.active) {
      // A plain tap on an open row just closes it.
      if (s.base) closeSwipe();
      return;
    }
    s.cell.classList.remove('dragging');
    if (s.x < -SWIPE_WIDTH / 2) {
      openSwipeCell = s.cell;
      setSwipeOffset(s.cell, -SWIPE_WIDTH);
    } else {
      setSwipeOffset(s.cell, 0);
      if (openSwipeCell === s.cell) openSwipeCell = null;
    }
  });
});

els.body.addEventListener('click', (e) => {
  const btn = e.target.closest('.swipe-delete');
  if (!btn) return;
  deletePlayer(btn.dataset.player).then((deleted) => { if (!deleted) closeSwipe(); });
});

render();

// ---- Offline support ----

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline caching unavailable */ });
  });
}
