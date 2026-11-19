'use strict';

const STORAGE_KEY = 'score-keeper:v2';

const $ = (sel) => document.querySelector(sel);

const els = {
  tableWrap: $('#tableWrap'),
  table: $('#scores'),
  head: $('#scoresHead'),
  body: $('#scoresBody'),
  addRoundBtn: $('#addRoundBtn'),
  menuBtn: $('#menuBtn'),
  menu: $('#menu'),
  clearScoresBtn: $('#clearScoresBtn'),
  highWinsBtn: $('#highWinsBtn'),
  lowWinsBtn: $('#lowWinsBtn'),
  clearPlayersBtn: $('#clearPlayersBtn'),
  playersDownBtn: $('#playersDownBtn'),
  playersAcrossBtn: $('#playersAcrossBtn'),
  shareBtn: $('#shareBtn'),
  targetInput: $('#targetInput'),
  status: $('#status'),
  statusText: $('#statusText'),
  statusShareBtn: $('#statusShareBtn'),
  toast: $('#toast'),
  toastMessage: $('#toastMessage'),
  toastUndoBtn: $('#toastUndoBtn'),
};

// ---- State ----
// players: [{ id, name }]
// rounds:  [{ id, scores: { [playerId]: number } }]  (a missing score counts as 0)
// lowWins: true when the lowest total wins
// sortKey: 'name', 'total', or null for the order players were added
// sortDir: 'asc' or 'desc'
// playersAcross: true to list players across the top (rounds go down the side)
// target: the game ends once someone's total reaches this, or null for no limit

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function loadState() {
  const defaults = { players: [], rounds: [], lowWins: false, sortKey: null, sortDir: 'asc', playersAcross: false, target: null };
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

// Removes a player without redrawing (for when the redraw has to wait).
function removePlayer(id) {
  const player = findPlayer(id);
  if (!player) return;
  const undo = snapshot();
  state.players = state.players.filter((p) => p.id !== id);
  state.rounds.forEach((r) => { delete r.scores[id]; });
  save();
  showToast(`Deleted ${player.name}`, undo);
}

function deletePlayer(id) {
  removePlayer(id);
  render();
}

function addRound() {
  state.rounds.push({ id: newId(), scores: {} });
  save();
  render();
  // Jump to the new round and start typing the first player's score.
  if (!state.playersAcross) els.tableWrap.scrollLeft = els.tableWrap.scrollWidth;
  const first = els.body.querySelector(`input[data-round="${state.rounds.length - 1}"]`);
  if (first) first.focus();
}

function deleteRound(index) {
  const undo = snapshot();
  state.rounds.splice(index, 1);
  save();
  render();
  showToast(`Deleted Round ${index + 1}`, undo);
}

function setLowWins(lowWins) {
  state.lowWins = lowWins;
  save();
  render();
}

function setPlayersAcross(across) {
  state.playersAcross = across;
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

function clearPlayers() {
  const undo = snapshot();
  state.players = [];
  save();
  render();
  showToast('Cleared all players', undo);
}

function clearScores() {
  const undo = snapshot();
  state.rounds = [];
  save();
  render();
  showToast('Cleared all scores', undo);
}

function setTarget(value) {
  const n = parseFloat(value);
  state.target = Number.isFinite(n) && n > 0 ? n : null;
  save();
  updateStandings();
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

// The "+ Player" cell: at the bottom of the table when players are down the
// side, at the right end of the top row when they're across the top. It's
// built once and kept in place (never removed and re-added), so typing
// several names in a row doesn't close the keyboard.
const newPlayerInput = el('input', {
  className: 'name-input',
  type: 'text',
  maxLength: 24,
  placeholder: '+ Player',
  autocomplete: 'off',
  spellcheck: false,
  enterKeyHint: 'done',
});
newPlayerInput.setAttribute('autocapitalize', 'words');
newPlayerInput.setAttribute('autocorrect', 'off');
newPlayerInput.setAttribute('aria-label', 'Add a player');
const newPlayerCell = el('th', {}, [el('div', { className: 'name-cell' }, [newPlayerInput])]);
const newPlayerRow = el('tr'); // players down the side
const namesRow = el('tr', { className: 'names-row' }); // players across the top

const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return n + suffix;
};

// Every player with their total and place, best first. Tied players share
// a place.
function standings() {
  const better = (a, b) => (state.lowWins ? a < b : a > b);
  const rows = state.players.map((player) => ({ player, total: totalFor(player.id) }));
  rows.forEach((row) => { row.place = 1 + rows.filter((o) => better(o.total, row.total)).length; });
  return rows.sort((a, b) => a.place - b.place);
}

// Refreshes the totals, each player's place and gap to the leader, the
// crown, and the target-score line. Nobody leads before any scores are in
// or while everyone is tied.
function updateStandings() {
  const ranked = standings();
  const byId = new Map(ranked.map((row) => [row.player.id, row]));
  const best = ranked.length ? ranked[0].total : 0;
  const anyLead = ranked.length > 1 && ranked.some((row) => row.place > 1);

  els.body.querySelectorAll('[data-total]').forEach((td) => {
    const { total, place } = byId.get(td.dataset.total);
    td.querySelector('.total-num').textContent = formatNumber(total);
    const gap = round3(total - best);
    const sign = gap > 0 ? '+' : '−';
    td.querySelector('.rank').textContent = !anyLead ? ''
      : place === 1 ? '1st' : `${ordinal(place)} · ${sign}${formatNumber(Math.abs(gap))}`;
  });
  els.body.querySelectorAll('[data-leads]').forEach((node) => {
    node.classList.toggle('leader', anyLead && byId.get(node.dataset.leads).place === 1);
  });

  updateStatus(ranked);
}

// The line above the table when there's a target score: how far the game
// goes, then the winner once someone reaches it. The game only ends once
// everyone has a score for the round, so it doesn't call it halfway through.
function updateStatus(ranked) {
  const target = state.target;
  els.status.hidden = !target || ranked.length === 0;
  if (els.status.hidden) return;

  const reached = ranked.filter((row) => row.total >= target);
  const last = state.rounds[state.rounds.length - 1];
  const roundDone = !!last && state.players.every((p) => p.id in last.scores);
  const over = reached.length > 0 && roundDone;
  const names = (rows) => rows.map((row) => row.player.name).join(' and ');

  els.status.classList.toggle('game-over', over);
  els.statusShareBtn.hidden = !over;
  if (over) {
    const winners = ranked.filter((row) => row.place === 1);
    const verb = winners.length > 1 ? 'tie' : 'wins';
    els.statusText.textContent = `🏆 ${names(winners)} ${verb} with ${formatNumber(winners[0].total)}!`;
  } else if (reached.length) {
    els.statusText.textContent = `${names(reached)} reached ${formatNumber(target)}. Finish the round to end the game.`;
  } else {
    els.statusText.textContent = `Game ends at ${formatNumber(target)}`;
  }
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

// keepOrder: leave players where they are (new players go at the end) instead
// of re-sorting, used while you're still typing in the table.
function render({ keepOrder = false } = {}) {
  els.highWinsBtn.setAttribute('aria-pressed', String(!state.lowWins));
  els.lowWinsBtn.setAttribute('aria-pressed', String(state.lowWins));
  els.playersDownBtn.setAttribute('aria-pressed', String(!state.playersAcross));
  els.playersAcrossBtn.setAttribute('aria-pressed', String(state.playersAcross));

  const hasPlayers = state.players.length > 0;
  els.addRoundBtn.hidden = !hasPlayers;
  els.clearScoresBtn.disabled = !hasPlayers;
  els.clearPlayersBtn.disabled = !hasPlayers;
  els.shareBtn.disabled = !hasPlayers;
  if (document.activeElement !== els.targetInput) els.targetInput.value = state.target ?? '';

  const refocus = focusKey(document.activeElement);

  let order = playersInOrder();
  if (keepOrder) {
    const shown = displayedOrder.map(findPlayer).filter(Boolean);
    order = [...shown, ...state.players.filter((p) => !shown.includes(p))];
  }
  displayedOrder = order.map((p) => p.id);
  openSwipeCell = null; // the rows are rebuilt below, closed

  els.table.classList.toggle('players-across', state.playersAcross);
  if (state.playersAcross) renderPlayersAcross(order);
  else renderPlayersDown(order);

  els.body.querySelectorAll('[data-player].name-input').forEach(fitName);
  updateStandings();

  if (refocus) {
    const target = els.body.querySelector(refocus);
    if (target) target.focus();
  }
}

// Player | R1 … Rn | Total across the top, one row per player.
function renderPlayersDown(order) {
  const headRow = el('tr', {}, [sortHeader('Player', 'name', 'name-col', 'col')]);
  state.rounds.forEach((_, i) => headRow.append(el('th', { className: 'round-head', scope: 'col' }, [roundButton(i)])));
  headRow.append(sortHeader('Total', 'total', 'total-col', 'col'));
  els.head.replaceChildren(headRow);

  const rows = order.map((p) => {
    // Revealed by swiping the name left (see "Swipe to delete" below).
    const deleteBtn = el('button', { className: 'swipe-delete', type: 'button', textContent: 'Delete', tabIndex: -1 });
    deleteBtn.dataset.player = p.id;
    deleteBtn.setAttribute('aria-label', `Delete ${p.name}`);

    const row = el('tr', {}, [el('th', { className: 'name-col', scope: 'row' }, [nameCell(p), deleteBtn])]);
    row.dataset.player = p.id;
    row.dataset.leads = p.id;
    state.rounds.forEach((r, i) => row.append(el('td', {}, [scoreInput(p, r, i)])));
    row.append(totalCell(p, 'total-col'));
    return row;
  });

  // Swap the player rows but leave the "+ Player" row in the DOM.
  namesRow.remove();
  newPlayerCell.className = 'name-col new-player';
  newPlayerCell.scope = 'row';
  if (newPlayerCell.parentNode !== newPlayerRow) newPlayerRow.prepend(newPlayerCell);
  [...els.body.children].forEach((row) => { if (row !== newPlayerRow) row.remove(); });
  if (!newPlayerRow.isConnected) els.body.append(newPlayerRow);
  els.body.insertBefore(fragmentOf(rows), newPlayerRow);

  // Empty cells under each round and the total for the "+ Player" row.
  while (newPlayerRow.children.length > 1) newPlayerRow.lastElementChild.remove();
  state.rounds.forEach(() => newPlayerRow.append(el('td')));
  newPlayerRow.append(el('td', { className: 'total-col' }));
}

// Player names across the top, one row per round, and totals along the
// bottom. Everything lives in the table body so the same typing and
// focus handling works for both layouts.
function renderPlayersAcross(order) {
  els.head.replaceChildren();

  // Top row: Player | a column per player | + Player. That last cell stays put.
  newPlayerRow.remove();
  newPlayerCell.className = 'player-head new-player';
  newPlayerCell.scope = 'col';
  if (newPlayerCell.parentNode !== namesRow) namesRow.append(newPlayerCell);
  [...namesRow.children].forEach((cell) => { if (cell !== newPlayerCell) cell.remove(); });
  const heads = order.map((p) => {
    const th = el('th', { className: 'player-head', scope: 'col' }, [nameCell(p)]);
    th.dataset.leads = p.id;
    return th;
  });
  namesRow.insertBefore(fragmentOf([sortHeader('Player', 'name', 'name-col', 'col'), ...heads]), newPlayerCell);

  const rows = state.rounds.map((r, i) => {
    const row = el('tr', {}, [el('th', { className: 'name-col', scope: 'row' }, [roundButton(i)])]);
    order.forEach((p) => row.append(el('td', {}, [scoreInput(p, r, i)])));
    row.append(el('td'));
    return row;
  });
  if (order.length) {
    const totalRow = el('tr', { className: 'total-row' }, [sortHeader('Total', 'total', 'name-col', 'row')]);
    order.forEach((p) => totalRow.append(totalCell(p)));
    totalRow.append(el('td'));
    rows.push(totalRow);
  }

  [...els.body.children].forEach((row) => { if (row !== namesRow) row.remove(); });
  if (!namesRow.isConnected) els.body.prepend(namesRow);
  els.body.append(...rows);
}

// Player and Total are sortable; the active one shows ▲ or ▼.
function sortHeader(label, key, className, scope) {
  const active = state.sortKey === key;
  const btn = el('button', { className: 'ghost sort-btn', textContent: label });
  btn.dataset.sortKey = key;
  if (active) btn.dataset.dir = state.sortDir;
  const th = el('th', { className, scope }, [btn]);
  th.setAttribute('aria-sort', active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  return th;
}

function roundButton(i) {
  const btn = el('button', { className: 'ghost round-btn', textContent: `R${i + 1}`, title: `Delete Round ${i + 1}` });
  btn.dataset.round = i;
  btn.setAttribute('aria-label', `Round ${i + 1}. Tap to delete this round.`);
  return btn;
}

function nameCell(p) {
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
  const howToDelete = state.playersAcross ? 'Clear the name' : 'Swipe left or clear the name';
  nameInput.setAttribute('aria-label', `Player name: ${p.name}. ${howToDelete} to delete this player.`);
  const crown = el('span', { className: 'crown', textContent: '👑' });
  crown.setAttribute('aria-label', 'Winning');
  return el('div', { className: 'name-cell' }, [nameInput, crown]);
}

function scoreInput(p, r, i) {
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
  return input;
}

// The total, with the player's place and gap to the leader under it
// (filled in by updateStandings).
function totalCell(p, className = 'total-cell') {
  const td = el('td', { className }, [el('span', { className: 'total-num' }), el('span', { className: 'rank' })]);
  td.dataset.total = p.id;
  if (state.playersAcross) td.dataset.leads = p.id;
  return td;
}

function fragmentOf(nodes) {
  const frag = document.createDocumentFragment();
  frag.append(...nodes);
  return frag;
}

// ---- Undo bar ----
// Deleting and clearing happen straight away; a bar at the bottom offers
// Undo for a few seconds instead of asking "are you sure?" first. Undo puts
// back the players and scores only, not settings changed in the meantime.

const snapshot = () => JSON.stringify({ players: state.players, rounds: state.rounds });
let toastTimer = 0;
let toastUndo = null;

function showToast(message, undo = null) {
  els.toastMessage.textContent = message;
  els.toastUndoBtn.hidden = !undo;
  toastUndo = undo;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 6000 : 2500);
}

function hideToast() {
  els.toast.hidden = true;
  toastUndo = null;
}

els.toastUndoBtn.addEventListener('click', () => {
  if (!toastUndo) return;
  Object.assign(state, JSON.parse(toastUndo));
  save();
  hideToast();
  render();
});

// ---- Share results ----

// Standings as plain text for a group chat.
function resultsText() {
  const ranked = standings();
  const lines = ranked.map(({ player, total, place }) =>
    `${place === 1 && ranked.length > 1 ? '🏆' : ordinal(place)} ${player.name}: ${formatNumber(total)}`);
  const rounds = state.rounds.length === 1 ? '1 round' : `${state.rounds.length} rounds`;
  return `Score Keeper, after ${rounds}:\n${lines.join('\n')}`;
}

async function shareResults() {
  const text = resultsText();
  if (navigator.share) {
    try {
      await navigator.share({ text });
    } catch { /* closed the share sheet */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Results copied');
  } catch {
    showToast("Couldn't share the results");
  }
}

// ---- Keep the screen on ----
// The phone would otherwise lock in the middle of a game. iOS lets go of
// this whenever the app is in the background, so ask again on return.

let wakeLock = null;

async function keepScreenOn() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* not allowed right now; try again on the next tap */ }
}

document.addEventListener('visibilitychange', keepScreenOn);
document.addEventListener('pointerdown', keepScreenOn);
keepScreenOn();

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

// Actions close the menu; settings leave it open so you can see the change.
els.clearScoresBtn.addEventListener('click', () => { setMenuOpen(false); clearScores(); });
els.clearPlayersBtn.addEventListener('click', () => { setMenuOpen(false); clearPlayers(); });
els.shareBtn.addEventListener('click', () => { setMenuOpen(false); shareResults(); });
els.statusShareBtn.addEventListener('click', shareResults);
els.targetInput.addEventListener('input', () => setTarget(els.targetInput.value));
els.targetInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.targetInput.blur(); });
els.highWinsBtn.addEventListener('click', () => setLowWins(false));
els.lowWinsBtn.addEventListener('click', () => setLowWins(true));
els.playersDownBtn.addEventListener('click', () => setPlayersAcross(false));
els.playersAcrossBtn.addEventListener('click', () => setPlayersAcross(true));

// ---- Events ----

els.addRoundBtn.addEventListener('click', addRound);

// Round and sort buttons are in the header, or down the side and along the
// bottom when players are across the top.
els.table.addEventListener('click', (e) => {
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
    updateStandings();
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

  // Return in "+ Player" adds them and stays ready for the next name;
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
      // Clearing a name deletes the player (Undo brings them back).
      removePlayer(player.id);
      renderPending = true;
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
  deletePlayer(btn.dataset.player);
});

render();

// ---- Offline support ----

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline caching unavailable */ });
  });
}
