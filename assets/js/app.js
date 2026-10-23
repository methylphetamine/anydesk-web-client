/**
 * app.js — AnyDesk Web Client (unofficial)
 *
 * Two real paths:
 *   1. Launch  — hand the address to the installed AnyDesk app via the documented
 *                `anydesk:<address>` URL handler. No credentials ever touch this page.
 *   2. Viewer  — WebRTC screen share between two browser tabs (view-only), brokered
 *                by PeerJS, media peer-to-peer.
 */

const PEER_PREFIX = 'adwcv1-';
const CODE_LEN = 6;

const QUALITY = {
  speed:    { label: 'Speed',    maxBitrate: 900_000 },
  balanced: { label: 'Balanced', maxBitrate: 2_500_000 },
  quality:  { label: 'Quality',  maxBitrate: 6_000_000 },
};

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const digits = (v) => String(v).replace(/\D/g, '');
const isAlias = (v) => /^[a-z0-9][a-z0-9._-]*(@[a-z0-9.-]+)?$/i.test(v) && /@/.test(v);

/** 1234567890 -> "123 456 7890"; aliases pass through untouched */
function group(v) {
  const raw = String(v).trim();
  if (!/^\d[\d\s]*$/.test(raw)) return raw;
  const d = digits(raw).slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(' ');
}

const groupCode = (v) => digits(v).slice(0, CODE_LEN).replace(/(\d{3})(?=\d)/, '$1 ');

function validAddress(v) {
  const raw = String(v).trim();
  if (isAlias(raw)) return true;
  const n = digits(raw).length;
  return (n === 9 || n === 10) && /^[\d\s]+$/.test(raw);
}

function normalizeAddress(v) {
  const raw = String(v).trim();
  return isAlias(raw) ? raw : digits(raw);
}

const randomDigits = (n) => {
  let out = String(1 + Math.floor(Math.random() * 9));
  while (out.length < n) out += Math.floor(Math.random() * 10);
  return out;
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/* -------------------------------------------------------------------- toasts */

const toastHost = $('#toasts');

function toast(message, { warn = false, error = false, ms = 3200 } = {}) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' toast--error' : warn ? ' toast--warn' : ''}`;
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------- state */

const state = {
  view: 'home',
  role: null,          // 'host' | 'viewer'
  address: '',
  code: '',
  peer: null,
  conn: null,
  call: null,
  stream: null,
  startedAt: 0,
  statsTimer: 0,
  lastBytes: 0,
  lastTs: 0,
  lastFrames: 0,
  streamTimer: 0,
  teardown: false,
  quality: 'balanced',
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
  document.body.classList.toggle('is-sharing', name === 'sharing');
  if (name !== 'session') closeAllDrawers();

  window.scrollTo(0, 0);
  if (name === 'home') {
    $('#remote-id').focus({ preventScroll: true });
  } else if (name === 'session') {
    $('#stage').setAttribute('tabindex', '-1');
    $('#stage').focus({ preventScroll: true });
  }
}

/* ------------------------------------------------------------------- errors */

function setError(el, message) {
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

function clearErrors() {
  setError($('#launch-error'), '');
  setError($('#share-error'), '');
  $('#launch-fallback').hidden = true;
}

/* --------------------------------------------------------------- launch path */

const idField = $('#remote-id');
let launchTimer = 0;

idField.addEventListener('input', () => {
  const raw = idField.value;
  if (/^[\d\s]+$/.test(raw) || raw === '') {
    const caret = idField.selectionStart ?? raw.length;
    const before = digits(raw.slice(0, caret)).length;
    const next = group(raw);
    idField.value = next;

    let pos = 0;
    let seen = 0;
    while (pos < next.length && seen < before) {
      if (/\d/.test(next[pos])) seen += 1;
      pos += 1;
    }
    idField.setSelectionRange(pos, pos);
  }
  if (!$('#launch-error').hidden && validAddress(idField.value)) setError($('#launch-error'), '');
});

idField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#launch-form').requestSubmit();
  }
});

$('#launch-form').addEventListener('submit', (e) => {
  e.preventDefault();
  launch();
});

function launch() {
  clearErrors();
  const raw = idField.value.trim();

  if (!validAddress(raw)) {
    setError(
      $('#launch-error'),
      raw ? 'Use a 9–10 digit address or an alias like desk@company.' : 'Enter the address you were given.'
    );
    idField.focus();
    return;
  }

  state.address = normalizeAddress(raw);
  const url = `anydesk:${state.address}`;

  // If the handler exists the OS takes over and this tab loses focus. If we are
  // still visible a couple of seconds later, offer the manual fallbacks.
  clearTimeout(launchTimer);
  launchTimer = setTimeout(() => {
    if (!document.hidden) $('#launch-fallback').hidden = false;
  }, 2200);

  try {
    window.location.href = url;
  } catch {
    setError($('#launch-error'), 'This browser blocked the anydesk: link. Copy the address instead.');
    $('#launch-fallback').hidden = false;
  }
}

/* --------------------------------------------------------------- share (host) */

const shareBtn = $('#share-btn');
const preview = $('#preview-video');

shareBtn.addEventListener('click', startSharing);

async function startSharing() {
  clearErrors();
  shareBtn.disabled = true;

  if (!navigator.mediaDevices?.getDisplayMedia) {
    setError($('#share-error'), 'This browser cannot capture a screen. Try Chrome, Edge or Firefox on desktop.');
    shareBtn.disabled = false;
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: false,
    });
  } catch (err) {
    const denied = err?.name === 'NotAllowedError';
    setError(
      $('#share-error'),
      denied ? 'Screen capture was cancelled or blocked. Allow it to start sharing.' : 'Could not start screen capture on this device.'
    );
    shareBtn.disabled = false;
    return;
  }

  state.role = 'host';
  state.teardown = false;
  state.stream = stream;
  state.address = randomDigits(9);
  state.code = randomDigits(CODE_LEN);

  preview.srcObject = stream;
  preview.play().catch(() => {});
  $('#share-id').textContent = group(state.address);
  $('#share-code').textContent = groupCode(state.code);
  $('#share-status').innerHTML = '<span class="dot dot--live" aria-hidden="true"></span> Connecting to the broker…';

  stream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (state.role === 'host' && state.view !== 'home') endSession('Screen sharing stopped');
    });
  });

  setView('sharing');
  createHostPeer();
}

function createHostPeer() {
  if (!window.Peer) {
    setError($('#share-error'), 'The signalling library failed to load. Check your connection.');
    return;
  }

  const peer = new Peer(PEER_PREFIX + state.address, { debug: 1 });
  state.peer = peer;

  peer.on('open', () => {
    if (state.view !== 'sharing') return;
    $('#share-status').innerHTML = '<span class="dot dot--live" aria-hidden="true"></span> Waiting for a viewer to connect…';
  });

  peer.on('connection', onHostConnection);
  peer.on('error', onPeerError);
  peer.on('disconnected', () => {
    if (!state.teardown) peer.reconnect();
  });
}

let authFailures = [];

function onHostConnection(conn) {
  if (state.teardown) return;

  const now = Date.now();
  authFailures = authFailures.filter((t) => now - t < 60_000);
  const locked = authFailures.length >= 8;
  const provided = String(conn.metadata?.code ?? '');
  const ok = !locked && provided === state.code;

  if (!ok) {
    if (!locked) authFailures.push(now);
    conn.on('open', () => {
      try {
        conn.send({ t: 'denied', reason: locked ? 'Too many attempts. Wait a minute.' : 'Wrong access code.' });
      } catch {}
      setTimeout(() => conn.close(), 200);
    });
    return;
  }

  // only one viewer at a time
  if (state.conn) {
    try { conn.close(); } catch {}
    return;
  }

  state.conn = conn;
  bindConnection(conn);

  const start = () => {
    const call = state.peer.call(conn.peer, state.stream, { metadata: { code: state.code } });
    state.call = call;
    call.on('error', () => {});
    openSession();
    startStats();
  };

  if (conn.open) start();
  else conn.on('open', start);
}

/* -------------------------------------------------------------- viewer path */

$('#watch-btn').addEventListener('click', () => {
  clearErrors();
  const raw = idField.value.trim();
  const code = digits($('#remote-code').value);

  if (!validAddress(raw)) {
    setError($('#launch-error'), 'Enter the 9–10 digit address shown by the host.');
    idField.focus();
    return;
  }
  if (code.length !== CODE_LEN) {
    toast('Enter the six-digit access code', { warn: true });
    $('#remote-code').focus();
    return;
  }

  startWatching(normalizeAddress(raw), code);
});

$('#remote-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#watch-btn').click();
  }
});

$('#remote-code').addEventListener('input', (e) => {
  const el = e.target;
  el.value = groupCode(el.value);
});

function startWatching(address, code) {
  state.role = 'viewer';
  state.address = address;
  state.code = code;
  state.teardown = false;

  $('#peer-id').textContent = group(address);
  $('#role-badge').textContent = 'viewing';
  $('#info-role').textContent = 'viewer';
  $('#info-peer').textContent = group(address);
  $('#stage-waiting-text').textContent = `Connecting to ${group(address)}…`;
  $('#stage-waiting').classList.remove('is-hidden');

  setView('session');
  resetChat();
  applyQuality(state.quality, { broadcast: false });

  if (!window.Peer) {
    failSession('The signalling library failed to load. Check your connection.');
    return;
  }

  const peer = new Peer({ debug: 1 });
  state.peer = peer;
  state.startedAt = Date.now();

  peer.on('open', () => {
    if (state.teardown) return;
    const conn = peer.connect(PEER_PREFIX + address, {
      metadata: { code },
      reliable: true,
    });
    state.conn = conn;
    bindConnection(conn);

    conn.on('open', () => {
      $('#stage-waiting-text').textContent = 'Waiting for the host to answer…';
    });
  });

  peer.on('call', (call) => {
    state.call = call;
    call.on('stream', attachStream);
    call.on('close', () => {
      if (!state.teardown) endSession('The host ended the session');
    });
    call.on('error', () => failSession('The video connection failed.'));
    try { call.answer(); } catch {}
  });

  peer.on('error', onPeerError);

  state.streamTimer = setTimeout(() => {
    if (!state.stream && !state.teardown) {
      failSession('No answer. Check the address and code, and that the host is still sharing.');
    }
  }, 20_000);
}

function attachStream(stream) {
  clearTimeout(state.streamTimer);
  state.stream = stream;
  const video = $('#remote-video');
  video.srcObject = stream;
  video.play().catch(() => {});
  $('#stage-waiting').classList.add('is-hidden');
  startStats();

  stream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (!state.teardown) endSession('The screen share ended');
    });
  });

  toast('Live screen connected');
}

function bindConnection(conn) {
  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'chat' && typeof data.text === 'string') {
      chatBubble(data.text.slice(0, 2000), 'in');
    }
    if (data.t === 'denied') {
      failSession(data.reason || 'The host refused the connection.');
    }
    if (data.t === 'quality' && state.role === 'host' && QUALITY[data.v]) {
      applyQuality(data.v, { broadcast: false });
    }
  });

  conn.on('close', () => {
    if (state.teardown || state.view === 'home') return;
    if (state.role === 'viewer' && !state.stream) {
      failSession('The host closed the connection. Check the code and try again.');
    } else if (state.role === 'host') {
      endSession('The viewer disconnected');
    } else {
      endSession('The other side disconnected');
    }
  });

  conn.on('error', () => {});
}

/* ---------------------------------------------------------------- peer errors */

function onPeerError(err) {
  const type = err?.type || '';
  const status = $('#net-status');

  const hostError = (msg) => {
    if (state.role === 'host') {
      endSession(msg);
      setError($('#share-error'), msg);
    } else {
      failSession(msg);
    }
  };

  if (type === 'peer-unavailable') {
    hostError('No shared desk at that address. Is the host still on the sharing screen?');
    return;
  }
  if (type === 'unavailable-id') {
    hostError('That address is already in use. Try again.');
    return;
  }
  if (type === 'network' || type === 'server-error' || type === 'socket-error') {
    status.classList.remove('is-online');
    status.classList.add('is-offline');
    $('#net-status-text').textContent = 'broker offline';
    hostError('Cannot reach the signalling broker. Try again in a moment.');
    return;
  }
  if (type === 'browser-incompatible') {
    failSession('This browser does not support the WebRTC features required.');
  }
}

/* --------------------------------------------------------------- session view */

function openSession() {
  $('#peer-id').textContent = group(state.address);
  $('#role-badge').textContent = state.role === 'host' ? 'sharing' : 'viewing';
  $('#info-role').textContent = state.role === 'host' ? 'host' : 'viewer';
  $('#info-peer').textContent = group(state.address);
  $('#info-state').textContent = 'connecting';

  if (state.role === 'host') {
    const video = $('#remote-video');
    video.srcObject = state.stream;
    video.play().catch(() => {});
    $('#stage-waiting').classList.add('is-hidden');
  }

  setView('session');
  resetChat();
  applyQuality(state.quality, { broadcast: false });
  $('#stage-hint').classList.remove('is-faded');
  setTimeout(() => $('#stage-hint').classList.add('is-faded'), 6000);
}

/* --------------------------------------------------------------------- stats */

function startStats() {
  clearInterval(state.statsTimer);
  state.lastBytes = 0;
  state.lastTs = 0;
  state.lastFrames = 0;
  if (!state.startedAt) state.startedAt = Date.now();
  state.statsTimer = setInterval(tickStats, 1000);
  tickStats();
}

function fmtUptime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = String(Math.floor(total / 60) % 60).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

async function tickStats() {
  const pc = state.call?.peerConnection;
  if (!pc || state.teardown) return;

  let report;
  try {
    report = await pc.getStats();
  } catch {
    return;
  }

  const byId = new Map();
  report.forEach((r) => byId.set(r.id, r));

  let inbound = null;
  let outbound = null;
  let pair = null;
  report.forEach((r) => {
    if (r.type === 'inbound-rtp' && r.kind === 'video') inbound = r;
    else if (r.type === 'outbound-rtp' && r.kind === 'video') outbound = r;
    else if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = r;
  });

  const rtp = inbound || outbound;
  const now = performance.now();
  const bytes = rtp ? (inbound ? rtp.bytesReceived : rtp.bytesSent) || 0 : 0;

  let mbps = 0;
  if (state.lastTs && now > state.lastTs && bytes >= state.lastBytes) {
    mbps = ((bytes - state.lastBytes) * 8) / ((now - state.lastTs) / 1000) / 1e6;
  }
  state.lastBytes = bytes;
  state.lastTs = now;

  let fps = rtp?.framesPerSecond;
  if (fps == null && outbound && outbound.framesEncoded != null) {
    const deltaFrames = outbound.framesEncoded - (state.lastFrames || 0);
    fps = deltaFrames > 0 ? deltaFrames : 0;
    state.lastFrames = outbound.framesEncoded;
  }

  const width = rtp?.frameWidth || $('#remote-video').videoWidth || 0;
  const height = rtp?.frameHeight || $('#remote-video').videoHeight || 0;
  const rtt = pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;

  const codec = rtp?.codecId ? byId.get(rtp.codecId) : null;
  const codecName = codec?.mimeType ? codec.mimeType.replace('video/', '').toUpperCase() : null;

  const local = pair?.localCandidateId ? byId.get(pair.localCandidateId) : null;
  const remote = pair?.remoteCandidateId ? byId.get(pair.remoteCandidateId) : null;
  const route = local && remote ? `${local.candidateType} → ${remote.candidateType}` : null;

  $('#stat-latency').textContent = rtt != null ? rtt : '—';
  $('#stat-fps').textContent = fps != null ? Math.round(fps) : '—';
  $('#stat-res').textContent = width && height ? `${width}×${height}` : '—';
  $('#stat-bitrate').textContent = mbps > 0 ? mbps.toFixed(1) : '—';

  $('#info-latency').textContent = rtt != null ? `${rtt} ms` : '—';
  $('#info-fps').textContent = fps != null ? `${Math.round(fps)} fps` : '—';
  $('#info-res').textContent = width && height ? `${width}×${height}` : '—';
  $('#info-bitrate').textContent = mbps > 0 ? `${mbps.toFixed(1)} Mb/s` : '—';
  $('#info-codec').textContent = codecName || '—';
  $('#info-route').textContent = route || '—';
  $('#info-state').textContent = pc.connectionState || '—';
  $('#info-uptime').textContent = fmtUptime(Date.now() - state.startedAt);
}

/* ------------------------------------------------------------------- quality */

function applyQuality(quality, { broadcast = true } = {}) {
  const cfg = QUALITY[quality] || QUALITY.balanced;
  state.quality = quality;
  $('#quality').value = quality;
  $('#hud-quality').textContent = cfg.label;

  const pc = state.call?.peerConnection;
  const sender = pc?.getSenders?.().find((s) => s.track && s.track.kind === 'video');
  if (sender) {
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings.forEach((enc) => { enc.maxBitrate = cfg.maxBitrate; });
      sender.setParameters(params).catch(() => {});
    } catch {}
  }

  if (broadcast && state.role === 'viewer' && state.conn?.open) {
    try { state.conn.send({ t: 'quality', v: quality }); } catch {}
  }
}

$('#quality').addEventListener('change', (e) => applyQuality(e.target.value));

/* ---------------------------------------------------------------------- chat */

function chatBubble(text, dir) {
  const li = document.createElement('li');
  li.className = `chat__msg chat__msg--${dir}`;
  const who = document.createElement('span');
  who.className = 'chat__who';
  who.textContent = dir === 'in' ? (state.role === 'host' ? 'Viewer' : 'Host') : 'You';
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
  const li = document.createElement('li');
  li.className = 'chat__msg chat__msg--in';
  li.innerHTML = '<span class="chat__who">System</span><p>Connected. Messages go straight to the other browser.</p>';
  log.append(li);
}

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!state.conn?.open) {
    toast('Not connected yet', { warn: true });
    return;
  }
  try { state.conn.send({ t: 'chat', text }); } catch {}
  chatBubble(text, 'out');
  input.value = '';
});

/* ------------------------------------------------------------------- drawers */

function toggleDrawer(name, force) {
  const drawer = $(`[data-drawer="${name}"]`);
  if (!drawer) return;
  const open = typeof force === 'boolean' ? force : !drawer.classList.contains('is-open');

  closeAllDrawers();
  if (!open) return;

  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  $(`[data-action="toggle-${name}"]`)?.setAttribute('aria-pressed', 'true');

  if (name === 'chat') setTimeout(() => $('#chat-input').focus({ preventScroll: true }), 120);
}

function closeAllDrawers() {
  $$('.drawer').forEach((d) => {
    d.classList.remove('is-open');
    d.setAttribute('aria-hidden', 'true');
  });
  $$('[data-action="toggle-chat"], [data-action="toggle-info"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}

/* ------------------------------------------------------------------- teardown */

function endSession(message) {
  state.teardown = true;
  clearTimeout(state.streamTimer);
  clearInterval(state.statsTimer);

  try { state.conn?.close(); } catch {}
  try { state.call?.close(); } catch {}
  try { state.peer?.destroy(); } catch {}
  state.stream?.getTracks().forEach((t) => t.stop());

  $('#remote-video').srcObject = null;
  preview.srcObject = null;
  state.stream = null;
  state.conn = null;
  state.call = null;
  state.peer = null;
  state.role = null;
  state.startedAt = 0;
  state.lastBytes = 0;
  state.lastTs = 0;

  closeAllDrawers();
  setView('home');
  shareBtn.disabled = false;

  if (message) toast(message, { warn: true });
}

function failSession(message) {
  if (state.view !== 'session') return;
  endSession();
  setError($('#launch-error'), message);
  toast(message, { error: true, ms: 5000 });
}

/* ------------------------------------------------------------------- actions */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  switch (el.dataset.action) {
    case 'dismiss-notice':
      $('#notice').classList.add('is-hidden');
      break;

    case 'home':
      e.preventDefault();
      if (state.view === 'sharing' || state.view === 'session') endSession();
      clearErrors();
      setView('home');
      break;

    case 'paste-id': {
      try {
        const text = await navigator.clipboard.readText();
        idField.value = group(text.trim());
        setError($('#launch-error'), '');
        if (validAddress(idField.value)) toast('Address pasted');
        else toast('Clipboard has no AnyDesk address', { warn: true });
      } catch {
        toast('Clipboard blocked by the browser', { warn: true });
        idField.focus();
      }
      break;
    }

    case 'copy-address': {
      const ok = await copyText(state.address || normalizeAddress(idField.value));
      toast(ok ? 'Address copied' : 'Copy failed — select it manually', { warn: !ok });
      break;
    }

    case 'copy-share': {
      const text = `AnyDesk Web Client\nAddress: ${group(state.address)}\nCode: ${groupCode(state.code)}\n${location.origin}${location.pathname}#desk/${state.address}`;
      const ok = await copyText(text);
      toast(ok ? 'Address and code copied' : 'Copy failed', { warn: !ok });
      break;
    }

    case 'stop-sharing':
    case 'disconnect':
      endSession(state.role === 'host' ? 'Stopped sharing' : undefined);
      break;

    case 'toggle-chat':
    case 'toggle-info':
      toggleDrawer(el.dataset.action.replace('toggle-', ''));
      break;

    case 'toggle-fullscreen':
      toggleFullscreen();
      break;

    default:
      break;
  }
});

/* ----------------------------------------------------------------- fullscreen */

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
  const label = $('[data-action="toggle-fullscreen"] .btn__text');
  if (label) label.textContent = document.fullscreenElement ? 'Windowed' : 'Fullscreen';
});

/* ------------------------------------------------------------------- keyboard */

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (state.view === 'session' || state.view === 'sharing') endSession();
    setView('home');
    idField.focus();
    idField.select();
    return;
  }

  if (e.key === 'Escape') {
    if ($('.drawer.is-open')) {
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

/* ------------------------------------------------------------------ bootstrap */

function boot() {
  // status pill reflects real capabilities, not a fake heartbeat
  const status = $('#net-status');
  const canCapture = !!navigator.mediaDevices?.getDisplayMedia;
  const canRtc = typeof RTCPeerConnection === 'function';
  const canSignal = !!window.Peer;

  if (canRtc && canSignal) {
    status.classList.add('is-online');
    $('#net-status-text').textContent = canCapture ? 'ready to share' : 'viewer ready';
  } else {
    status.classList.add('is-offline');
    $('#net-status-text').textContent = 'unsupported';
  }

  if (!canCapture) {
    shareBtn.disabled = true;
    setError($('#share-error'), 'Screen capture is not available in this browser. You can still watch a shared desk.');
  }

  // deep link: #desk/123456789 or #desk/123456789/123456
  const hash = location.hash.match(/^#desk\/([\w@.-]{6,32})(?:\/(\d{6}))?$/);
  if (hash) {
    idField.value = group(hash[1]);
    if (hash[2]) $('#remote-code').value = groupCode(hash[2]);
    toast('Address filled from link');
  }

  setView('home');
}

boot();
