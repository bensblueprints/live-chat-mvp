// WebSocket hub — routes messages between visitor widgets and agent dashboards.
const { getSetting } = require('./db');

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

class Hub {
  constructor(db) {
    this.db = db;
    this.agents = new Set(); // agent websockets
    this.visitors = new Map(); // "siteId:visitorId" -> Set<ws>
  }

  // ---------- state helpers ----------

  agentOnline() {
    return this.agents.size > 0;
  }

  visitorKey(siteId, visitorId) {
    return `${siteId}:${visitorId}`;
  }

  sendJson(ws, obj) {
    if (ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
    }
  }

  broadcastAgents(obj, except = null) {
    for (const ws of this.agents) if (ws !== except) this.sendJson(ws, obj);
  }

  sendToVisitor(siteId, visitorId, obj) {
    const set = this.visitors.get(this.visitorKey(siteId, visitorId));
    if (!set) return;
    for (const ws of set) this.sendJson(ws, obj);
  }

  broadcastVisitors(obj) {
    for (const set of this.visitors.values()) for (const ws of set) this.sendJson(ws, obj);
  }

  // ---------- persistence helpers ----------

  ensureVisitor(siteId, visitorId, info = {}) {
    const db = this.db;
    const existing = db.prepare('SELECT * FROM visitors WHERE id = ?').get(visitorId);
    if (!existing) {
      db.prepare(
        `INSERT INTO visitors (id, site_id, name, email, user_agent, referrer, current_page)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(visitorId, siteId, info.name || '', info.email || '', info.userAgent || '', info.referrer || '', info.page || '');
    } else {
      db.prepare(
        `UPDATE visitors SET
           name = CASE WHEN ? != '' THEN ? ELSE name END,
           email = CASE WHEN ? != '' THEN ? ELSE email END,
           user_agent = CASE WHEN ? != '' THEN ? ELSE user_agent END,
           referrer = CASE WHEN ? != '' THEN ? ELSE referrer END,
           current_page = CASE WHEN ? != '' THEN ? ELSE current_page END,
           last_seen = datetime('now')
         WHERE id = ?`
      ).run(
        info.name || '', info.name || '',
        info.email || '', info.email || '',
        info.userAgent || '', info.userAgent || '',
        info.referrer || '', info.referrer || '',
        info.page || '', info.page || '',
        visitorId
      );
    }
    return db.prepare('SELECT * FROM visitors WHERE id = ?').get(visitorId);
  }

  openConversation(siteId, visitorId) {
    const db = this.db;
    let conv = db.prepare(
      `SELECT * FROM conversations WHERE site_id = ? AND visitor_id = ? AND status = 'open'
       ORDER BY id DESC LIMIT 1`
    ).get(siteId, visitorId);
    if (!conv) {
      const r = db.prepare('INSERT INTO conversations (site_id, visitor_id) VALUES (?, ?)').run(siteId, visitorId);
      conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(r.lastInsertRowid);
      this.broadcastAgents({ type: 'conversation_new', conversation: this.conversationSummary(conv.id) });
    }
    return conv;
  }

  addMessage(conversationId, sender, body, { offline = 0 } = {}) {
    const db = this.db;
    const r = db.prepare(
      'INSERT INTO messages (conversation_id, sender, body, offline, agent_read) VALUES (?, ?, ?, ?, ?)'
    ).run(conversationId, sender, body, offline ? 1 : 0, sender === 'agent' ? 1 : 0);
    db.prepare("UPDATE conversations SET last_message_at = datetime('now'), status = 'open' WHERE id = ?")
      .run(conversationId);
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid);
  }

  conversationSummary(id) {
    const db = this.db;
    return db.prepare(
      `SELECT c.*, v.name AS visitor_name, v.email AS visitor_email, v.current_page, v.user_agent, v.referrer,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender = 'visitor' AND m.agent_read = 0) AS unread,
        (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
        s.name AS site_name
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       JOIN sites s ON s.id = c.site_id
       WHERE c.id = ?`
    ).get(id);
  }

  history(siteId, visitorId) {
    // All messages for this visitor on this site, across past conversations.
    return this.db.prepare(
      `SELECT m.* FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.site_id = ? AND c.visitor_id = ?
       ORDER BY m.id ASC LIMIT 500`
    ).all(siteId, visitorId);
  }

  // ---------- offline email notify (BYO SMTP) ----------

  notifyOffline(conv, visitor, body) {
    const db = this.db;
    const host = getSetting(db, 'smtp_host', process.env.SMTP_HOST || '');
    const to = getSetting(db, 'notify_email', process.env.NOTIFY_EMAIL || '');
    if (!host || !to) return;
    try {
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport({
        host,
        port: Number(getSetting(db, 'smtp_port', process.env.SMTP_PORT || 587)),
        secure: Number(getSetting(db, 'smtp_port', process.env.SMTP_PORT || 587)) === 465,
        auth: getSetting(db, 'smtp_user', process.env.SMTP_USER || '')
          ? {
              user: getSetting(db, 'smtp_user', process.env.SMTP_USER || ''),
              pass: getSetting(db, 'smtp_pass', process.env.SMTP_PASS || '')
            }
          : undefined
      });
      transport
        .sendMail({
          from: getSetting(db, 'smtp_from', process.env.SMTP_FROM || 'chatlet@localhost'),
          to,
          subject: `[Chatlet] New offline message from ${visitor.name || 'a visitor'}`,
          text: `A visitor left a message while no agent was online.\n\nName: ${visitor.name || '—'}\nEmail: ${visitor.email || '—'}\nPage: ${visitor.current_page || '—'}\n\nMessage:\n${body}\n\nConversation #${conv.id}`
        })
        .catch((e) => console.warn('[chatlet] offline email failed:', e.message));
    } catch (e) {
      console.warn('[chatlet] offline email failed:', e.message);
    }
  }

  // ---------- visitor sockets ----------

  handleVisitor(ws, { siteId, visitorId, userAgent }) {
    const site = this.db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    if (!site) {
      this.sendJson(ws, { type: 'error', error: 'unknown_site' });
      ws.close(4004, 'unknown site');
      return;
    }
    const key = this.visitorKey(siteId, visitorId);
    if (!this.visitors.has(key)) this.visitors.set(key, new Set());
    this.visitors.get(key).add(ws);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const t = msg.type;

      if (t === 'hello') {
        const visitor = this.ensureVisitor(siteId, visitorId, {
          name: msg.name || '', email: msg.email || '',
          page: msg.page || '', referrer: msg.referrer || '', userAgent: userAgent || ''
        });
        const conv = this.openConversation(siteId, visitorId);
        this.sendJson(ws, {
          type: 'history',
          conversationId: conv.id,
          agentOnline: this.agentOnline(),
          messages: this.history(siteId, visitorId)
        });
        this.broadcastAgents({ type: 'conversation_updated', conversation: this.conversationSummary(conv.id) });
        return;
      }

      if (t === 'identify') {
        this.ensureVisitor(siteId, visitorId, { name: msg.name || '', email: msg.email || '' });
        const conv = this.openConversation(siteId, visitorId);
        this.broadcastAgents({ type: 'conversation_updated', conversation: this.conversationSummary(conv.id) });
        return;
      }

      if (t === 'page') {
        this.ensureVisitor(siteId, visitorId, { page: msg.url || '' });
        return;
      }

      if (t === 'typing') {
        const conv = this.openConversation(siteId, visitorId);
        this.broadcastAgents({ type: 'typing', from: 'visitor', conversationId: conv.id });
        return;
      }

      if (t === 'message') {
        const body = String(msg.body || '').slice(0, 4000).trim();
        if (!body) return;
        const visitor = this.ensureVisitor(siteId, visitorId, { page: msg.page || '' });
        const conv = this.openConversation(siteId, visitorId);
        const offline = !this.agentOnline();
        const row = this.addMessage(conv.id, 'visitor', body, { offline });
        this.sendJson(ws, { type: 'message', message: row, agentOnline: !offline });
        this.broadcastAgents({
          type: 'message',
          conversationId: conv.id,
          message: row,
          conversation: this.conversationSummary(conv.id)
        });
        if (offline) {
          this.sendJson(ws, { type: 'agent_status', online: false });
          this.notifyOffline(conv, visitor, body);
        }
        return;
      }
    });

    ws.on('close', () => {
      const set = this.visitors.get(key);
      if (set) {
        set.delete(ws);
        if (set.size === 0) this.visitors.delete(key);
      }
    });
    ws.on('error', () => {});

    this.sendJson(ws, { type: 'welcome', agentOnline: this.agentOnline() });
  }

  // ---------- agent sockets ----------

  handleAgent(ws) {
    const wasOnline = this.agentOnline();
    this.agents.add(ws);
    if (!wasOnline) this.broadcastVisitors({ type: 'agent_status', online: true });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const t = msg.type;

      if (t === 'message') {
        const convId = Number(msg.conversationId);
        const body = String(msg.body || '').slice(0, 4000).trim();
        const conv = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
        if (!conv || !body) return;
        const row = this.addMessage(convId, 'agent', body);
        this.sendToVisitor(conv.site_id, conv.visitor_id, { type: 'message', message: row });
        const summary = this.conversationSummary(convId);
        this.sendJson(ws, { type: 'message', conversationId: convId, message: row, conversation: summary });
        this.broadcastAgents({ type: 'message', conversationId: convId, message: row, conversation: summary }, ws);
        return;
      }

      if (t === 'typing') {
        const conv = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(msg.conversationId));
        if (conv) this.sendToVisitor(conv.site_id, conv.visitor_id, { type: 'typing', from: 'agent' });
        return;
      }

      if (t === 'read') {
        const convId = Number(msg.conversationId);
        this.db.prepare("UPDATE messages SET agent_read = 1 WHERE conversation_id = ? AND sender = 'visitor'").run(convId);
        this.broadcastAgents({ type: 'conversation_updated', conversation: this.conversationSummary(convId) });
        return;
      }
    });

    ws.on('close', () => {
      this.agents.delete(ws);
      if (!this.agentOnline()) this.broadcastVisitors({ type: 'agent_status', online: false });
    });
    ws.on('error', () => {});

    this.sendJson(ws, { type: 'ready', agentOnline: true, ts: now() });
  }
}

module.exports = { Hub };
