/**
 * app.js — AnyDesk Web Client (unofficial front-end demo)
 *
 * Everything below runs locally. No fetch, no WebSocket, no storage of what you
 * type into the address field. The "session" is a canvas animation.
 */

import { RemoteScreen, QUALITY } from './remote-screen.js';

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORE = {
  self: 'adwc.self',
  recent: 'adwc.recent',
};

const CHAT_REPLIES = [
  'Got it — flashing now.',
  'Give me a second, rebooting the device.',
  'That build looks clean. Logs are in /tmp/build.log.',
  'Can you see the boot splash on your side?',
  'Nice, it came up first try.',
];

const digits = (v) => v.replace(/\D/g, '');
const group = (v) => digits(v).slice(0, 9).replace(/(\d{3})(?=\d)/g, '$1 ');
const randomId = () => group(String(Math.floor(100000000 + Math.random() * 899999999)));

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* private mode / disabled storage — demo keeps working */
  }
  return null;
}

function readJSON(key, fallback) {
  try {
    return JSON.parse(store(key) || '') ?? fallback;
  } catch {
    return fallback;
  }
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/* -------------------------------------------------------------------- toasts */

const toastHost = $('#toasts');

function toast(message, { warn = false, ms = 2600 } = {}) {
  const node = document.createElement('div');
  node.className = `toast${warn ? ' toast--warn' : ''}`;
  const dot = document.createElement('span');
  dot.className = 'toast__dot';
  const text = document.createElement('span');
  text.textContent = message;
  node.append(dot, text);
  toastHost.append(node);

  setTimeout(() => {
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  }, ms);
}

/* --------------------------------------------------------------------- state */

const state = {
  view: 'connect',
  peer: '',
  quality: 'balanced',
  startedAt: 0,
  timers: [],
  ticker: 0,
  screen: null,
  chatTimer: 0,
};

const viewEls = new Map($$('[data-view]').map((el) => [el.dataset.view, el]));

function setView(name) {
  state.view = name;
  for (const [key, el] of viewEls) {
    const active = key === name;
    el.classList.toggle('is-active', active);
    el.toggleAttribute('inert', !active);
    if (active) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.toggle('is-session', name === 'session');
  if (name !== 'session') closeAllDrawers();

  if (name === 'connect') {
    $('#remote-id').focus({ preventScroll: true });
  } else if (name === 'connecting') {
    $('#cancel-connect')?.focus({ preventScroll: true });
  } else if (name === 'session') {
    window.scrollTo(0, 0);
    $('#stage').setAttribute('tabindex', '-1');
    $('#stage').focus({ preventScroll: true });
  }
}

/* ------------------------------------------------------------------ identity */

function initIdentity() {
  let id = store(STORE.self);
  if (!id || digits(id).length !== 9) {
    id = randomId();
    store(STORE.self, id);
  }
  $('#self-id').textContent = id;
}

/* -------------------------------------------------------------------- recent */

function loadRecent() {
  const list = readJSON(STORE.recent, []);
  return Array.isArray(list) ? list.filter((r) => r && digits(String(r.id)).length === 9).slice(0, 4) : [];
}

function saveRecent(id) {
  const list = loadRecent().filter((r) => r.id !== id);
  list.unshift({ id, at: Date.now() });
  store(STORE.recent, JSON.stringify(list.slice(0, 4)));
  renderRecent();
}

function relativeTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderRecent() {
  const list = loadRecent();
  const wrap = $('#recent-wrap');
  const host = $('#recent-list');

  wrap.hidden = list.length === 0;
  host.replaceChildren();

  for (const item of list) {
    const li = document.createElement('li');
    li.className = 'recent__item';

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'recent__go';
    go.dataset.action = 'reconnect';
    go.dataset.id = item.id;

    const id = document.createElement('span');
    id.textContent = item.id;
    const when = document.createElement('span');
    when.className = 'recent__when';
    when.textContent = relativeTime(item.at);
    go.append(id, when);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'recent__x';
    remove.dataset.action = 'forget';
    remove.dataset.id = item.id;
    remove.setAttribute('aria-label', `Forget ${item.id}`);
    remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

    li.append(go, remove);
    host.append(li);
  }
}

/* ---------------------------------------------------------------- form input */

const input = $('#remote-id');
const errorEl = $('#id-error');
const field = $('.idfield');

function setError(message) {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    field.classList.remove('is-invalid');
    input.setAttribute('aria-invalid', 'false');
    return;
  }
  errorEl.textContent = message;
  errorEl.hidden = false;
  field.classList.add('is-invalid');
  input.setAttribute('aria-invalid', 'true');
}

input.addEventListener('input', () => {
  const raw = input.value;
  const rawCaret = input.selectionStart ?? raw.length;
  const digitsBefore = digits(raw.slice(0, rawCaret)).length;
  const next = group(raw);

  input.value = next;

  // rebuild the caret so typing and deleting stay in the same visual spot
  let pos = 0;
  let seen = 0;
  while (pos < next.length && seen < digitsBefore) {
    if (/\d/.test(next[pos])) seen += 1;
    pos += 1;
  }
  input.setSelectionRange(pos, pos);

  if (!errorEl.hidden && digits(next).length === 9) setError('');
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#connect-form').requestSubmit();
  }
});

/* -------------------------------------------------------------- connect flow */

function clearTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
  clearTimeout(state.chatTimer);
}

function later(ms, fn) {
  state.timers.push(setTimeout(fn, ms));
}

function startConnect(id) {
  const clean = group(id);
  if (digits(clean).length !== 9) {
    setError('Enter all nine digits — the address is three groups of three.');
    input.focus();
    return;
  }

  clearTimers();
  state.peer = clean;
  setError('');

  $('#dial-id').textContent = clean;
  $('#peer-id').textContent = clean;
  $('#info-peer').textContent = clean;

  // reset handshake UI
  $$('#steps li').forEach((li) => {
    li.classList.remove('is-active', 'is-done');
    li.querySelector('.steps__state').textContent = '—';
  });
  $('#progress-bar').style.width = '0%';

  setView('connecting');

  const steps = $$('#steps li');
  const step = (i, stateText) => {
    const li = steps[i];
    if (!li) return;
    li.classList.add('is-active');
    li.querySelector('.steps__state').textContent = stateText;
  };
  const done = (i) => {
    const li = steps[i];
    if (!li) return;
    li.classList.remove('is-active');
    li.classList.add('is-done');
    li.querySelector('.steps__state').textContent = 'ok';
  };

  later(60, () => { step(0, 'lookup'); $('#progress-bar').style.width = '14%'; });
  later(700, () => { done(0); step(1, 'handshake'); $('#progress-bar').style.width = '46%'; });
  later(1450, () => { done(1); step(2, 'attaching'); $('#progress-bar').style.width = '78%'; });
  later(2150, () => { done(2); $('#progress-bar').style.width = '100%'; });
  later(2500, () => openSession());
}

function openSession() {
  setView('session');
  state.startedAt = Date.now();

  if (!state.screen) state.screen = new RemoteScreen($('#remote-canvas'));
  state.screen.setQuality(state.quality);
  state.screen.start();

  applyQuality(state.quality);
  resetChat();
  startTicker();
  saveRecent(state.peer);

  $('#stage-hint').classList.remove('is-faded');
  setTimeout(() => $('#stage-hint').classList.add('is-faded'), 5000);

  toast(`Session opened with ${state.peer}`);
}

function endSession({ silent = false } = {}) {
  clearTimers();
  clearInterval(state.ticker);
  state.ticker = 0;
  state.screen?.stop();

  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});

  $('#opt-viewonly').checked = false;
  toggleViewOnly(false);

  if (!silent) {
    setView('connect');
    toast('Session ended', { warn: true });
  }
}

/* ---------------------------------------------------------------- session UI */

const latencyEl = $('#stat-latency');
const uptimeEl = $('#stat-uptime');

function fmtUptime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = String(Math.floor(total / 60) % 60).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function startTicker() {
  clearInterval(state.ticker);
  const update = () => {
    if (!state.startedAt) return;
    const uptime = Date.now() - state.startedAt;
    const ms = Math.round(11 + Math.random() * 16 + Math.sin(uptime / 9000) * 5);
    const fps = clamp(Math.round(58 + Math.sin(uptime / 4000) * 3 - Math.random() * 3), 48, 60);
    const mbps = (3.4 + Math.abs(Math.sin(uptime / 12000)) * 5.2).toFixed(1);
    const pretty = fmtUptime(uptime);

    latencyEl.textContent = ms;
    uptimeEl.textContent = pretty;
    $('#info-latency').textContent = `${ms} ms`;
    $('#info-uptime').textContent = pretty;
    $('#info-fps').textContent = `${fps} fps`;
    $('#info-bitrate').textContent = `${mbps} Mb/s`;
  };
  update();
  state.ticker = setInterval(update, 1000);
}

function applyQuality(quality) {
  const q = QUALITY[quality] || QUALITY.balanced;
  state.quality = quality;
  $('#quality').value = quality;
  $('#hud-quality').textContent = `${q.label} · ${q.resolution}`;
  $('#stat-res').textContent = q.resolution;
  $('#info-res').textContent = q.resolution;
}

function toggleViewOnly(on) {
  const hud = $('#hud-viewonly');
  hud.hidden = !on;
  if (on) toast('View only — input is ignored', { warn: true });
}

function toggleDrawer(name, force) {
  const drawer = $(`[data-drawer="${name}"]`);
  if (!drawer) return;
  const open = typeof force === 'boolean' ? force : !drawer.classList.contains('is-open');

  closeAllDrawers();
  if (!open) return;

  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  const btn = $(`[data-action="toggle-${name}"]`);
  btn?.setAttribute('aria-pressed', 'true');

  if (name === 'chat') setTimeout(() => $('#chat-input').focus({ preventScroll: true }), 120);
}

function closeAllDrawers() {
  $$('.drawer').forEach((d) => {
    d.classList.remove('is-open');
    d.setAttribute('aria-hidden', 'true');
  });
  $$('[data-action="toggle-chat"], [data-action="toggle-info"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}

/* --------------------------------------------------------------------- chat */

function chatBubble(text, dir) {
  const li = document.createElement('li');
  li.className = `chat__msg chat__msg--${dir}`;
  const who = document.createElement('span');
  who.className = 'chat__who';
  who.textContent = dir === 'in' ? 'Remote' : 'You';
  const p = document.createElement('p');
  p.textContent = text;
  li.append(who, p);
  const log = $('#chat-log');
  log.append(li);
  log.scrollTop = log.scrollHeight;
}

function resetChat() {
  const log = $('#chat-log');
  log.replaceChildren();
  chatBubble(`Session is up. Send me the build log when you're ready.`, 'in');
}

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fieldInput = $('#chat-input');
  const text = fieldInput.value.trim();
  if (!text) return;
  chatBubble(text, 'out');
  fieldInput.value = '';

  clearTimeout(state.chatTimer);
  state.chatTimer = setTimeout(() => {
    if (state.view !== 'session') return;
    chatBubble(CHAT_REPLIES[Math.floor(Math.random() * CHAT_REPLIES.length)], 'in');
  }, 900 + Math.random() * 900);
});

/* ------------------------------------------------------------------- actions */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action } = el.dataset;

  switch (action) {
    case 'dismiss-notice':
      $('#notice').classList.add('is-hidden');
      break;

    case 'home':
      e.preventDefault();
      if (state.view === 'session') endSession({ silent: true });
      clearTimers();
      setView('connect');
      break;

    case 'paste-id': {
      try {
        const text = await navigator.clipboard.readText();
        const id = group(text);
        if (digits(id).length === 9) {
          input.value = id;
          setError('');
          toast('Address pasted');
        } else {
          toast('Clipboard has no nine-digit address', { warn: true });
        }
      } catch {
        toast('Clipboard blocked by the browser', { warn: true });
        input.focus();
      }
      break;
    }

    case 'random-id':
      input.value = randomId();
      setError('');
      break;

    case 'copy-self': {
      const id = $('#self-id').textContent.trim();
      try {
        await navigator.clipboard.writeText(id);
        toast('Your address copied');
      } catch {
        toast(id, { ms: 4000 });
      }
      break;
    }

    case 'clear-recent':
      store(STORE.recent, JSON.stringify([]));
      renderRecent();
      toast('History cleared');
      break;

    case 'reconnect':
      input.value = el.dataset.id;
      startConnect(el.dataset.id);
      break;

    case 'forget': {
      const list = loadRecent().filter((r) => r.id !== el.dataset.id);
      store(STORE.recent, JSON.stringify(list));
      renderRecent();
      break;
    }

    case 'cancel-connect':
      clearTimers();
      setView('connect');
      break;

    case 'disconnect':
      endSession();
      break;

    case 'toggle-chat':
    case 'toggle-info':
      toggleDrawer(action.replace('toggle-', ''));
      break;

    case 'toggle-fullscreen':
      toggleFullscreen();
      break;

    default:
      break;
  }
});

$('#connect-form').addEventListener('submit', (e) => {
  e.preventDefault();
  startConnect(input.value);
});

$('#quality').addEventListener('change', (e) => {
  const quality = e.target.value;
  applyQuality(quality);
  state.screen?.setQuality(quality);
});

$('#opt-viewonly').addEventListener('change', (e) => toggleViewOnly(e.target.checked));

$('#opt-clipboard').addEventListener('change', (e) => {
  toast(e.target.checked ? 'Clipboard sync on (demo)' : 'Clipboard sync off');
});

/* --------------------------------------------------------------- fullscreen */

async function toggleFullscreen() {
  const stage = $('#stage');
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      toast('Fullscreen off');
    } else {
      await stage.requestFullscreen();
      toast('Fullscreen — press F to exit');
    }
  } catch {
    toast('Fullscreen is blocked here', { warn: true });
  }
}

document.addEventListener('fullscreenchange', () => {
  const btn = $('[data-action="toggle-fullscreen"] .btn__text');
  if (btn) btn.textContent = document.fullscreenElement ? 'Windowed' : 'Fullscreen';
});

/* ------------------------------------------------------------------ keyboard */

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (state.view === 'session') endSession({ silent: true });
    setView('connect');
    input.focus();
    input.select();
    return;
  }

  if (e.key === 'Escape') {
    const openDrawer = $('.drawer.is-open');
    if (openDrawer) {
      closeAllDrawers();
      if (typing) e.target.blur();
      return;
    }
    if (state.view === 'session') {
      e.preventDefault();
      endSession();
    }
    return;
  }

  if (typing) return;

  if (e.key.toLowerCase() === 'f' && state.view === 'session') {
    e.preventDefault();
    toggleFullscreen();
  }
});

/* ---------------------------------------------------------------- bootstrap */

function boot() {
  initIdentity();
  renderRecent();

  // deep link: #desk/123456789 opens straight into a session
  const hash = location.hash.match(/^#desk\/(\d{9})$/);
  if (hash) startConnect(hash[1]);
  else setView('connect');

  // keep "3m ago" labels honest
  setInterval(() => {
    if (state.view === 'connect') renderRecent();
  }, 60000);
}

boot();
