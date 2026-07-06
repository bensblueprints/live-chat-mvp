export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function agentSocket({ onEvent, onStatus }) {
  let ws = null;
  let closed = false;
  let delay = 1000;

  function connect() {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?role=agent`);
    ws.onopen = () => {
      delay = 1000;
      onStatus?.(true);
    };
    ws.onmessage = (ev) => {
      try { onEvent?.(JSON.parse(ev.data)); } catch {}
    };
    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) {
        setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      }
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  connect();

  return {
    send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    },
    close() {
      closed = true;
      try { ws?.close(); } catch {}
    }
  };
}

export function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = beep._ctx || (beep._ctx = new Ctx());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  } catch {}
}
