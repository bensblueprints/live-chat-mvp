/* Chatlet embeddable widget — self-hosted live chat.
 * Usage: <script src="https://your-server/chat.js" data-site="SITE_ID"></script>
 * Renders inside a shadow DOM so host-page CSS can't break it (and vice versa).
 */
(function () {
  'use strict';
  if (window.__chatletLoaded) return;
  window.__chatletLoaded = true;

  var script = document.currentScript;
  if (!script) {
    var scripts = document.querySelectorAll('script[data-site]');
    script = scripts[scripts.length - 1];
  }
  if (!script) return;
  var SITE = script.getAttribute('data-site') || '';
  var ORIGIN = new URL(script.src, location.href).origin;
  var WS_ORIGIN = ORIGIN.replace(/^http/, 'ws');
  if (!SITE) return;

  // ---- visitor identity (persists across visits) ----
  var VID;
  try {
    VID = localStorage.getItem('chatlet_vid');
    if (!VID) {
      VID = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('chatlet_vid', VID);
    }
  } catch (e) {
    VID = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  var identity = {};
  try { identity = JSON.parse(localStorage.getItem('chatlet_identity') || '{}'); } catch (e) {}

  // ---- state ----
  var state = {
    open: false,
    unread: 0,
    agentOnline: false,
    identified: !!(identity.name || identity.email || identity.skipped),
    messages: [],
    seen: {},          // message id -> true (dedupe ws + poll)
    lastId: 0,
    wsOk: false,
    queue: [],         // messages typed while disconnected
    typingTimer: null,
    config: { color: '#6366f1', title: 'Chat with us', greeting: 'Hi there! How can we help?' }
  };

  // ---- sound (tiny synth beep, no asset needed) ----
  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = beep._ctx || (beep._ctx = new Ctx());
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.25);
    } catch (e) {}
  }

  // ---- shadow DOM UI ----
  var host = document.createElement('div');
  host.id = 'chatlet-widget';
  var root = host.attachShadow({ mode: 'open' });
  document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(host); });
  if (document.body) document.body.appendChild(host);

  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    '.bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;' +
    'box-shadow:0 4px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .15s}' +
    '.bubble:hover{transform:scale(1.06)}' +
    '.bubble svg{width:26px;height:26px;fill:#fff}' +
    '.badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;' +
    'font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px}' +
    '.panel{position:fixed;bottom:88px;right:20px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);' +
    'background:#18181b;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.4);display:flex;flex-direction:column;overflow:hidden;' +
    'z-index:2147483000;opacity:0;pointer-events:none;transform:translateY(12px);transition:opacity .18s,transform .18s}' +
    '.panel.open{opacity:1;pointer-events:auto;transform:translateY(0)}' +
    '.head{padding:14px 16px;color:#fff;display:flex;align-items:center;gap:10px}' +
    '.head .dot{width:9px;height:9px;border-radius:50%;background:#22c55e;flex:none}' +
    '.head .dot.off{background:#71717a}' +
    '.head .t{font-weight:700;font-size:15px;flex:1}' +
    '.head .s{font-size:11.5px;opacity:.85}' +
    '.head button{background:none;border:none;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:2px 6px;opacity:.8}' +
    '.msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#18181b}' +
    '.m{max-width:80%;padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;color:#fff}' +
    '.m.v{align-self:flex-end;border-bottom-right-radius:4px}' +
    '.m.a{align-self:flex-start;background:#27272a;border-bottom-left-radius:4px}' +
    '.m.s{align-self:center;background:none;color:#a1a1aa;font-size:12px;padding:2px}' +
    '.typing{align-self:flex-start;background:#27272a;border-radius:14px;padding:11px 14px;display:none}' +
    '.typing.on{display:flex;gap:4px}' +
    '.typing i{width:6px;height:6px;border-radius:50%;background:#a1a1aa;animation:cb 1.2s infinite}' +
    '.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}' +
    '@keyframes cb{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}' +
    '.ident{padding:14px;background:#1f1f23;border-top:1px solid #27272a;display:none}' +
    '.ident.on{display:block}' +
    '.ident p{margin:0 0 8px;color:#d4d4d8;font-size:12.5px}' +
    '.ident input{width:100%;margin-bottom:6px;background:#27272a;border:1px solid #3f3f46;border-radius:8px;color:#fff;padding:8px 10px;font-size:13px;outline:none}' +
    '.ident .row{display:flex;gap:6px}' +
    '.ident button{flex:1;border:none;border-radius:8px;padding:8px;font-size:12.5px;font-weight:600;cursor:pointer}' +
    '.ident .go{color:#fff}' +
    '.ident .skip{background:#27272a;color:#a1a1aa}' +
    '.foot{display:flex;gap:8px;padding:10px;background:#1f1f23;border-top:1px solid #27272a}' +
    '.foot textarea{flex:1;resize:none;background:#27272a;border:1px solid #3f3f46;border-radius:10px;color:#fff;padding:9px 12px;' +
    'font-size:13.5px;line-height:1.4;height:40px;max-height:96px;outline:none}' +
    '.foot button{border:none;border-radius:10px;width:40px;height:40px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}' +
    '.foot button svg{width:18px;height:18px;fill:#fff}' +
    '.offline{padding:8px 14px;background:#3f2d12;color:#fbbf24;font-size:12px;display:none}' +
    '.offline.on{display:block}' +
    '</style>' +
    '<div class="panel" part="panel">' +
    '  <div class="head"><span class="dot off"></span><div style="flex:1"><div class="t"></div><div class="s">We usually reply fast</div></div><button class="x" aria-label="Close">&times;</button></div>' +
    '  <div class="offline">No one is online right now — leave a message and we\'ll email you back.</div>' +
    '  <div class="msgs"><div class="typing"><i></i><i></i><i></i></div></div>' +
    '  <div class="ident"><p>Want a reply by email? (optional)</p>' +
    '    <input class="in-name" placeholder="Your name" maxlength="80">' +
    '    <input class="in-email" placeholder="you@email.com" type="email" maxlength="120">' +
    '    <div class="row"><button class="go">Start chatting</button><button class="skip">Skip</button></div></div>' +
    '  <div class="foot">' +
    '    <textarea placeholder="Type a message…" rows="1"></textarea>' +
    '    <button class="send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg></button>' +
    '  </div>' +
    '</div>' +
    '<button class="bubble" aria-label="Open chat">' +
    '  <svg class="ic-chat" viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z"/></svg>' +
    '</button>';

  var $ = function (s) { return root.querySelector(s); };
  var bubble = $('.bubble'), panel = $('.panel'), msgsEl = $('.msgs'), typingEl = $('.typing'),
    ta = $('.foot textarea'), identEl = $('.ident'), footEl = $('.foot'), offlineEl = $('.offline'),
    dotEl = $('.head .dot'), titleEl = $('.head .t');

  function applyConfig() {
    bubble.style.background = state.config.color;
    $('.head').style.background = state.config.color;
    $('.foot .send').style.background = state.config.color;
    $('.ident .go').style.background = state.config.color;
    titleEl.textContent = state.config.title;
  }
  applyConfig();

  function setAgentOnline(on) {
    state.agentOnline = on;
    dotEl.className = 'dot' + (on ? '' : ' off');
    $('.head .s').textContent = on ? 'Online now' : 'Leave a message';
    offlineEl.className = 'offline' + (!on && state.messages.length ? ' on' : '');
  }

  function updateBadge() {
    var b = bubble.querySelector('.badge');
    if (state.unread > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'badge'; bubble.appendChild(b); }
      b.textContent = state.unread > 9 ? '9+' : String(state.unread);
    } else if (b) b.remove();
  }

  function renderMessage(m) {
    if (state.seen[m.id]) return;
    state.seen[m.id] = true;
    state.messages.push(m);
    if (m.id > state.lastId) state.lastId = m.id;
    var el = document.createElement('div');
    el.className = 'm ' + (m.sender === 'visitor' ? 'v' : m.sender === 'agent' ? 'a' : 's');
    if (m.sender === 'visitor') el.style.background = state.config.color;
    el.textContent = m.body;
    msgsEl.insertBefore(el, typingEl);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    if (m.sender === 'agent') {
      typingEl.className = 'typing';
      if (!state.open) { state.unread++; updateBadge(); }
      beep();
    }
  }

  function greet() {
    if (state.messages.length === 0 && !root.querySelector('.m.greet')) {
      var el = document.createElement('div');
      el.className = 'm a greet';
      el.textContent = state.config.greeting;
      msgsEl.insertBefore(el, typingEl);
    }
  }

  // ---- transport: WebSocket with reconnect, HTTP polling fallback ----
  var ws = null, reconnectDelay = 1000, pollTimer = null, wsAttempts = 0;

  function pageInfo() {
    return { page: location.href, referrer: document.referrer || '' };
  }

  function wsSend(obj) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
    return false;
  }

  function flushQueue() {
    while (state.queue.length) {
      var body = state.queue[0];
      if (!sendTransport(body)) break;
      state.queue.shift();
    }
  }

  function connect() {
    try {
      ws = new WebSocket(WS_ORIGIN + '/ws?role=visitor&site=' + encodeURIComponent(SITE) + '&visitor=' + encodeURIComponent(VID));
    } catch (e) { startPolling(); return; }
    ws.onopen = function () {
      state.wsOk = true;
      wsAttempts = 0;
      reconnectDelay = 1000;
      stopPolling();
      var info = pageInfo();
      wsSend({ type: 'hello', name: identity.name || '', email: identity.email || '', page: info.page, referrer: info.referrer });
      flushQueue();
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'welcome') setAgentOnline(msg.agentOnline);
      else if (msg.type === 'history') {
        setAgentOnline(msg.agentOnline);
        (msg.messages || []).forEach(renderMessage);
        greet();
      } else if (msg.type === 'message') renderMessage(msg.message);
      else if (msg.type === 'typing' && msg.from === 'agent') {
        typingEl.className = 'typing on';
        msgsEl.scrollTop = msgsEl.scrollHeight;
        clearTimeout(state.typingTimer);
        state.typingTimer = setTimeout(function () { typingEl.className = 'typing'; }, 3000);
      } else if (msg.type === 'agent_status') setAgentOnline(msg.online);
      else if (msg.type === 'conversation_closed') {
        renderMessage({ id: 'c' + Date.now(), sender: 'system', body: 'Conversation closed. Send a message to start a new one.' });
      }
    };
    ws.onclose = function () {
      state.wsOk = false;
      wsAttempts++;
      if (wsAttempts >= 3) startPolling(); // WS likely blocked — fall back to polling
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function api(path, opts) {
    return fetch(ORIGIN + path, opts).then(function (r) { return r.json(); });
  }

  function startPolling() {
    if (pollTimer) return;
    var info = pageInfo();
    api('/api/widget/hello', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: SITE, visitor: VID, name: identity.name || '', email: identity.email || '', page: info.page, referrer: info.referrer })
    }).then(function (d) {
      setAgentOnline(d.agentOnline);
      (d.messages || []).forEach(renderMessage);
      greet();
    }).catch(function () {});
    pollTimer = setInterval(function () {
      if (state.wsOk) { stopPolling(); return; }
      api('/api/widget/poll?site=' + encodeURIComponent(SITE) + '&visitor=' + encodeURIComponent(VID) + '&after=' + state.lastId)
        .then(function (d) {
          setAgentOnline(d.agentOnline);
          (d.messages || []).forEach(renderMessage);
          flushQueue();
        }).catch(function () {});
    }, 3000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function sendTransport(body) {
    if (wsSend({ type: 'message', body: body, page: location.href })) return true;
    if (pollTimer) {
      api('/api/widget/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: SITE, visitor: VID, body: body, page: location.href })
      }).then(function (d) { if (d.message) renderMessage(d.message); setAgentOnline(d.agentOnline); }).catch(function () {});
      return true;
    }
    return false;
  }

  // ---- interactions ----
  function showIdentIfNeeded() {
    var need = !state.identified && state.messages.length === 0;
    identEl.className = 'ident' + (need ? ' on' : '');
    footEl.style.display = need ? 'none' : 'flex';
  }

  bubble.addEventListener('click', function () {
    state.open = !state.open;
    panel.className = 'panel' + (state.open ? ' open' : '');
    if (state.open) {
      state.unread = 0;
      updateBadge();
      showIdentIfNeeded();
      greet();
      msgsEl.scrollTop = msgsEl.scrollHeight;
      if (!state.identified || footEl.style.display !== 'none') ta.focus();
    }
  });
  $('.head .x').addEventListener('click', function () {
    state.open = false;
    panel.className = 'panel';
  });

  $('.ident .go').addEventListener('click', function () {
    identity.name = $('.in-name').value.trim();
    identity.email = $('.in-email').value.trim();
    identity.skipped = true;
    try { localStorage.setItem('chatlet_identity', JSON.stringify(identity)); } catch (e) {}
    state.identified = true;
    if (identity.name || identity.email) wsSend({ type: 'identify', name: identity.name, email: identity.email });
    showIdentIfNeeded();
    ta.focus();
  });
  $('.ident .skip').addEventListener('click', function () {
    identity.skipped = true;
    try { localStorage.setItem('chatlet_identity', JSON.stringify(identity)); } catch (e) {}
    state.identified = true;
    showIdentIfNeeded();
    ta.focus();
  });

  function doSend() {
    var body = ta.value.trim();
    if (!body) return;
    ta.value = '';
    if (!sendTransport(body)) {
      state.queue.push(body); // queued — will flush on reconnect
      renderMessage({ id: 'q' + Date.now(), sender: 'visitor', body: body });
    }
  }
  $('.foot .send').addEventListener('click', doSend);
  var lastTyping = 0;
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); return; }
    var t = Date.now();
    if (t - lastTyping > 1500) { lastTyping = t; wsSend({ type: 'typing' }); }
  });

  // notify server on SPA navigations
  var lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      wsSend({ type: 'page', url: lastHref });
    }
  }, 2000);

  // ---- boot ----
  api('/api/widget/config?site=' + encodeURIComponent(SITE))
    .then(function (c) {
      if (c && !c.error) {
        state.config.color = c.color || state.config.color;
        state.config.title = c.title || state.config.title;
        state.config.greeting = c.greeting || state.config.greeting;
        applyConfig();
        setAgentOnline(!!c.agentOnline);
      }
    })
    .catch(function () {});
  connect();
})();
