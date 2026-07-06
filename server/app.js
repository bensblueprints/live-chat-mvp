const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
const { openDb, getSetting, setSetting } = require('./db');
const { Hub } = require('./hub');

const SETTING_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'notify_email', 'widget_color', 'widget_title', 'widget_greeting'];

function createServer(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const adminPassword = opts.adminPassword || process.env.ADMIN_PASSWORD || 'admin';
  const autologinToken = opts.autologinToken || process.env.AUTOLOGIN_TOKEN || null;

  const db = openDb(dataDir);
  const hub = new Hub(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // ---- sessions (in-memory, simple by design) ----
  const sessions = new Set();
  function newSession(res) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.add(sid);
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
    return sid;
  }
  function requireAuth(req, res, next) {
    if (req.cookies.sid && sessions.has(req.cookies.sid)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  }

  // ================= WIDGET (public) =================

  // Embeddable script — served with CORS so any site can load it.
  const widgetSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'chat.js'), 'utf8');
  app.get('/chat.js', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/javascript').send(widgetSrc);
  });

  // CORS for the widget HTTP fallback endpoints
  app.use('/api/widget', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  function widgetSite(req, res) {
    const siteId = String(req.query.site || req.body?.site || '');
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    if (!site) {
      res.status(404).json({ error: 'Unknown site' });
      return null;
    }
    return site;
  }

  app.get('/api/widget/config', (req, res) => {
    const site = widgetSite(req, res);
    if (!site) return;
    res.json({
      site: site.name,
      agentOnline: hub.agentOnline(),
      color: getSetting(db, 'widget_color', '#6366f1'),
      title: getSetting(db, 'widget_title', 'Chat with us'),
      greeting: getSetting(db, 'widget_greeting', 'Hi there! How can we help?')
    });
  });

  // HTTP polling fallback (when WebSocket is blocked)
  app.post('/api/widget/hello', (req, res) => {
    const site = widgetSite(req, res);
    if (!site) return;
    const visitorId = String(req.body?.visitor || '').slice(0, 64);
    if (!visitorId) return res.status(400).json({ error: 'visitor required' });
    hub.ensureVisitor(site.id, visitorId, {
      name: req.body?.name || '', email: req.body?.email || '',
      page: req.body?.page || '', referrer: req.body?.referrer || '',
      userAgent: req.get('user-agent') || ''
    });
    const conv = hub.openConversation(site.id, visitorId);
    res.json({ conversationId: conv.id, agentOnline: hub.agentOnline(), messages: hub.history(site.id, visitorId) });
  });

  app.post('/api/widget/message', (req, res) => {
    const site = widgetSite(req, res);
    if (!site) return;
    const visitorId = String(req.body?.visitor || '').slice(0, 64);
    const body = String(req.body?.body || '').slice(0, 4000).trim();
    if (!visitorId || !body) return res.status(400).json({ error: 'visitor and body required' });
    const visitor = hub.ensureVisitor(site.id, visitorId, { page: req.body?.page || '', userAgent: req.get('user-agent') || '' });
    const conv = hub.openConversation(site.id, visitorId);
    const offline = !hub.agentOnline();
    const row = hub.addMessage(conv.id, 'visitor', body, { offline });
    hub.broadcastAgents({ type: 'message', conversationId: conv.id, message: row, conversation: hub.conversationSummary(conv.id) });
    if (offline) hub.notifyOffline(conv, visitor, body);
    res.json({ message: row, agentOnline: !offline });
  });

  app.get('/api/widget/poll', (req, res) => {
    const site = widgetSite(req, res);
    if (!site) return;
    const visitorId = String(req.query.visitor || '').slice(0, 64);
    const after = Number(req.query.after) || 0;
    if (!visitorId) return res.status(400).json({ error: 'visitor required' });
    const messages = db.prepare(
      `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.site_id = ? AND c.visitor_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 200`
    ).all(site.id, visitorId, after);
    res.json({ messages, agentOnline: hub.agentOnline() });
  });

  // ================= AUTH =================

  app.post('/api/login', (req, res) => {
    const pw = String(req.body?.password || '');
    const a = Buffer.from(pw);
    const b = Buffer.from(adminPassword);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    newSession(res);
    res.json({ ok: true });
  });

  app.post('/api/logout', requireAuth, (req, res) => {
    sessions.delete(req.cookies.sid);
    res.clearCookie('sid');
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    res.json({ authed: !!(req.cookies.sid && sessions.has(req.cookies.sid)) });
  });

  // desktop-mode auto-login
  if (autologinToken) {
    app.get('/auth/auto', (req, res) => {
      if (req.query.token !== autologinToken) return res.status(403).send('Forbidden');
      newSession(res);
      res.redirect('/admin/');
    });
  }

  // ================= DASHBOARD API (auth) =================

  app.get('/api/conversations', requireAuth, (req, res) => {
    const status = req.query.status === 'closed' ? 'closed' : req.query.status === 'open' ? 'open' : null;
    const rows = db.prepare(
      `SELECT c.id FROM conversations c
       WHERE (? IS NULL OR c.status = ?)
       ORDER BY c.last_message_at DESC LIMIT 200`
    ).all(status, status);
    res.json({ conversations: rows.map((r) => hub.conversationSummary(r.id)) });
  });

  app.get('/api/conversations/:id', requireAuth, (req, res) => {
    const conv = hub.conversationSummary(Number(req.params.id));
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC').all(conv.id);
    const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(conv.visitor_id);
    const past = db.prepare(
      'SELECT id, status, created_at, last_message_at FROM conversations WHERE visitor_id = ? AND id != ? ORDER BY id DESC LIMIT 20'
    ).all(conv.visitor_id, conv.id);
    res.json({ conversation: conv, messages, visitor, pastConversations: past });
  });

  app.post('/api/conversations/:id/read', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE messages SET agent_read = 1 WHERE conversation_id = ? AND sender = 'visitor'").run(id);
    res.json({ ok: true });
  });

  app.post('/api/conversations/:id/status', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status === 'closed' ? 'closed' : 'open';
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, id);
    hub.broadcastAgents({ type: 'conversation_updated', conversation: hub.conversationSummary(id) });
    if (status === 'closed') {
      hub.sendToVisitor(conv.site_id, conv.visitor_id, { type: 'conversation_closed', conversationId: id });
    }
    res.json({ ok: true, status });
  });

  app.get('/api/conversations/:id/transcript', requireAuth, (req, res) => {
    const conv = hub.conversationSummary(Number(req.params.id));
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC').all(conv.id);
    const lines = [
      `Chatlet transcript — conversation #${conv.id}`,
      `Visitor: ${conv.visitor_name || 'Anonymous'} ${conv.visitor_email ? `<${conv.visitor_email}>` : ''}`,
      `Site: ${conv.site_name}`,
      `Started: ${conv.created_at}`,
      ''
    ];
    for (const m of messages) {
      lines.push(`[${m.created_at}] ${m.sender === 'visitor' ? conv.visitor_name || 'Visitor' : m.sender === 'agent' ? 'Agent' : 'System'}: ${m.body}`);
    }
    res.set('Content-Disposition', `attachment; filename="chatlet-transcript-${conv.id}.txt"`);
    res.type('text/plain').send(lines.join('\n'));
  });

  // ---- canned responses ----
  app.get('/api/canned', requireAuth, (req, res) => {
    res.json({ canned: db.prepare('SELECT * FROM canned_responses ORDER BY shortcut ASC').all() });
  });
  app.post('/api/canned', requireAuth, (req, res) => {
    const shortcut = String(req.body?.shortcut || '').trim().replace(/^\//, '').toLowerCase();
    const body = String(req.body?.body || '').trim();
    if (!/^[a-z0-9_-]{1,32}$/.test(shortcut) || !body) {
      return res.status(400).json({ error: 'Shortcut must be 1-32 chars (a-z, 0-9, -, _) and body required' });
    }
    try {
      const r = db.prepare('INSERT INTO canned_responses (shortcut, body) VALUES (?, ?)').run(shortcut, body);
      res.json({ canned: db.prepare('SELECT * FROM canned_responses WHERE id = ?').get(r.lastInsertRowid) });
    } catch (e) {
      if (/UNIQUE/.test(String(e))) return res.status(409).json({ error: 'Shortcut already exists' });
      throw e;
    }
  });
  app.put('/api/canned/:id', requireAuth, (req, res) => {
    const shortcut = String(req.body?.shortcut || '').trim().replace(/^\//, '').toLowerCase();
    const body = String(req.body?.body || '').trim();
    if (!/^[a-z0-9_-]{1,32}$/.test(shortcut) || !body) return res.status(400).json({ error: 'Invalid shortcut or body' });
    db.prepare('UPDATE canned_responses SET shortcut = ?, body = ? WHERE id = ?').run(shortcut, body, Number(req.params.id));
    res.json({ canned: db.prepare('SELECT * FROM canned_responses WHERE id = ?').get(Number(req.params.id)) });
  });
  app.delete('/api/canned/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM canned_responses WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- sites ----
  app.get('/api/sites', requireAuth, (req, res) => {
    const sites = db.prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM conversations c WHERE c.site_id = s.id) AS conversations
       FROM sites s ORDER BY s.created_at ASC`
    ).all();
    res.json({ sites });
  });
  app.post('/api/sites', requireAuth, (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Name required' });
    const id = crypto.randomBytes(8).toString('hex');
    db.prepare('INSERT INTO sites (id, name) VALUES (?, ?)').run(id, name);
    res.json({ site: db.prepare('SELECT * FROM sites WHERE id = ?').get(id) });
  });
  app.put('/api/sites/:id', requireAuth, (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Name required' });
    db.prepare('UPDATE sites SET name = ? WHERE id = ?').run(name, req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/sites/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- settings ----
  app.get('/api/settings', requireAuth, (req, res) => {
    const out = {};
    for (const k of SETTING_KEYS) out[k] = getSetting(db, k, '');
    res.json({ settings: out });
  });
  app.put('/api/settings', requireAuth, (req, res) => {
    for (const k of SETTING_KEYS) {
      if (k in (req.body || {})) setSetting(db, k, String(req.body[k] ?? ''));
    }
    res.json({ ok: true });
  });

  // ================= STATIC DASHBOARD =================

  const distDir = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use('/admin', express.static(distDir));
    app.get('/admin/*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }
  app.get('/', (req, res) => res.redirect('/admin/'));

  // ================= HTTP + WEBSOCKET =================

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const role = url.searchParams.get('role');

    if (role === 'agent') {
      // Auth: session cookie required — unauthenticated dashboard sockets are rejected.
      const cookies = Object.fromEntries(
        (req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0])
      );
      if (!cookies.sid || !sessions.has(cookies.sid)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => hub.handleAgent(ws));
      return;
    }

    if (role === 'visitor') {
      const siteId = url.searchParams.get('site') || '';
      const visitorId = (url.searchParams.get('visitor') || '').slice(0, 64);
      if (!siteId || !visitorId) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) =>
        hub.handleVisitor(ws, { siteId, visitorId, userAgent: req.headers['user-agent'] || '' })
      );
      return;
    }

    socket.destroy();
  });

  server.hub = hub;
  server.db = db;
  return server;
}

module.exports = { createServer };
