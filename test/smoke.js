// Chatlet smoke test — spins up the real server on an ephemeral port and drives
// real visitor + agent WebSocket clients (ws package) through the core flows.
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const WebSocket = require('ws');
const { createServer } = require('../server/app.js');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlet-smoke-'));
const ADMIN_PASSWORD = 'smoke-test-pw';
const results = [];

function ok(name) { results.push(['PASS', name]); console.log('  PASS', name); }

// Messages can arrive in the same tick as 'open' (server pushes immediately),
// so every socket buffers everything it receives; waitFor consumes the buffer.
function waitFor(ws, predicate, label, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const idx = ws._buf.findIndex(predicate);
    if (idx !== -1) return resolve(ws._buf.splice(idx, 1)[0]);
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`timeout waiting for: ${label}`));
    }, timeout);
    function handler() {
      const i = ws._buf.findIndex(predicate);
      if (i !== -1) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(ws._buf.splice(i, 1)[0]);
      }
    }
    ws.on('message', handler);
  });
}

function connect(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws._buf = [];
    ws.on('message', (raw) => {
      try { ws._buf.push(JSON.parse(raw.toString())); } catch {}
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', (req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

async function main() {
  const server = createServer({ dataDir, adminPassword: ADMIN_PASSWORD });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}`;
  const db = server.db;
  const site = db.prepare('SELECT * FROM sites LIMIT 1').get();
  assert(site, 'default site seeded');

  // ---- 1. unauth dashboard socket rejected ----
  let rejected = false;
  try {
    await connect(`${wsBase}/ws?role=agent`);
  } catch (e) {
    rejected = /401/.test(e.message) || /socket hang up|ECONNRESET/.test(e.message);
  }
  assert(rejected, 'unauthenticated agent socket must be rejected');
  ok('unauth dashboard socket rejected');

  // ---- login to get an agent session cookie ----
  const loginRes = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD })
  });
  assert.strictEqual(loginRes.status, 200, 'login ok');
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];

  // wrong password rejected
  const badLogin = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nope' })
  });
  assert.strictEqual(badLogin.status, 401, 'wrong password rejected');
  ok('login auth (wrong password rejected, correct accepted)');

  // ---- 2. offline flow FIRST (no agent connected yet) ----
  const vid = 'v_smoke_visitor_1';
  let visitor = await connect(`${wsBase}/ws?role=visitor&site=${site.id}&visitor=${vid}`);
  const welcome = await waitFor(visitor, (m) => m.type === 'welcome', 'welcome');
  assert.strictEqual(welcome.agentOnline, false, 'no agent online yet');

  visitor.send(JSON.stringify({ type: 'hello', name: 'Smokey', email: 'smokey@test.io', page: 'https://example.com/pricing', referrer: 'https://google.com' }));
  const hist0 = await waitFor(visitor, (m) => m.type === 'history', 'initial history');
  const convId = hist0.conversationId;
  assert(Number.isInteger(convId), 'conversation created');

  visitor.send(JSON.stringify({ type: 'message', body: 'Anyone there? Leaving a message.' }));
  const offEcho = await waitFor(visitor, (m) => m.type === 'message', 'offline message echo');
  assert.strictEqual(offEcho.agentOnline, false);
  const offRow = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND sender = 'visitor'").get(convId);
  assert(offRow, 'offline message row stored');
  assert.strictEqual(offRow.offline, 1, 'offline message flagged offline=1');
  const convRow = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  assert.strictEqual(convRow.visitor_id, vid);
  assert.strictEqual(convRow.status, 'open');
  const visRow = db.prepare('SELECT * FROM visitors WHERE id = ?').get(vid);
  assert.strictEqual(visRow.name, 'Smokey');
  assert.strictEqual(visRow.current_page, 'https://example.com/pricing');
  ok('visitor connect + message -> conversation, visitor & message rows (offline flagged)');

  // ---- 3. agent connects, receives live visitor message ----
  const agent = await connect(`${wsBase}/ws?role=agent`, { Cookie: cookie });
  await waitFor(agent, (m) => m.type === 'ready', 'agent ready');
  // visitor should be told an agent came online
  await waitFor(visitor, (m) => m.type === 'agent_status' && m.online === true, 'agent_status online');

  const liveP = waitFor(agent, (m) => m.type === 'message' && m.message?.body === 'Hello live!', 'agent receives live message');
  visitor.send(JSON.stringify({ type: 'message', body: 'Hello live!' }));
  const live = await liveP;
  assert.strictEqual(live.conversationId, convId);
  assert.strictEqual(live.message.offline, 0, 'online message not flagged offline');
  assert(live.conversation.unread >= 1, 'unread count present on conversation summary');
  ok('agent WS receives visitor message live');

  // ---- 4. agent replies -> visitor receives ----
  const replyP = waitFor(visitor, (m) => m.type === 'message' && m.message?.sender === 'agent', 'visitor receives reply');
  agent.send(JSON.stringify({ type: 'message', conversationId: convId, body: 'Hi Smokey, agent here!' }));
  const reply = await replyP;
  assert.strictEqual(reply.message.body, 'Hi Smokey, agent here!');
  ok('agent reply delivered to visitor live');

  // ---- 5. typing relayed both ways ----
  const tAgentP = waitFor(agent, (m) => m.type === 'typing' && m.from === 'visitor', 'visitor typing -> agent');
  visitor.send(JSON.stringify({ type: 'typing' }));
  await tAgentP;
  const tVisP = waitFor(visitor, (m) => m.type === 'typing' && m.from === 'agent', 'agent typing -> visitor');
  agent.send(JSON.stringify({ type: 'typing', conversationId: convId }));
  await tVisP;
  ok('typing events relayed visitor->agent and agent->visitor');

  // ---- 6. visitor reconnect gets history ----
  visitor.close();
  await new Promise((r) => setTimeout(r, 100));
  visitor = await connect(`${wsBase}/ws?role=visitor&site=${site.id}&visitor=${vid}`);
  visitor.send(JSON.stringify({ type: 'hello', page: 'https://example.com/pricing' }));
  const hist = await waitFor(visitor, (m) => m.type === 'history', 'history on reconnect');
  const bodies = hist.messages.map((m) => m.body);
  assert(bodies.includes('Anyone there? Leaving a message.'), 'history has offline message');
  assert(bodies.includes('Hello live!'), 'history has live message');
  assert(bodies.includes('Hi Smokey, agent here!'), 'history has agent reply');
  assert.strictEqual(hist.conversationId, convId, 'same open conversation reused');
  ok('visitor reconnect receives full history');

  // ---- 7. HTTP polling fallback ----
  const pollHello = await (await fetch(`${base}/api/widget/hello`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site: site.id, visitor: vid, page: 'https://example.com/faq' })
  })).json();
  assert.strictEqual(pollHello.conversationId, convId);
  const sent = await (await fetch(`${base}/api/widget/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site: site.id, visitor: vid, body: 'via polling fallback' })
  })).json();
  assert(sent.message.id, 'polled message stored');
  const polled = await (await fetch(`${base}/api/widget/poll?site=${site.id}&visitor=${vid}&after=${sent.message.id - 1}`)).json();
  assert(polled.messages.some((m) => m.body === 'via polling fallback'), 'poll returns new message');
  ok('HTTP polling fallback (hello/message/poll)');

  // ---- 8. canned response CRUD ----
  const auth = { 'Content-Type': 'application/json', Cookie: cookie };
  const created = await (await fetch(`${base}/api/canned`, { method: 'POST', headers: auth, body: JSON.stringify({ shortcut: 'refund', body: 'Our refund policy is 30 days, no questions asked.' }) })).json();
  assert(created.canned.id, 'canned created');
  const dupe = await fetch(`${base}/api/canned`, { method: 'POST', headers: auth, body: JSON.stringify({ shortcut: 'refund', body: 'x' }) });
  assert.strictEqual(dupe.status, 409, 'duplicate shortcut rejected');
  const updated = await (await fetch(`${base}/api/canned/${created.canned.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ shortcut: 'refunds', body: '30-day refunds.' }) })).json();
  assert.strictEqual(updated.canned.shortcut, 'refunds');
  const list = await (await fetch(`${base}/api/canned`, { headers: auth })).json();
  assert(list.canned.some((c) => c.shortcut === 'refunds'), 'canned listed');
  await fetch(`${base}/api/canned/${created.canned.id}`, { method: 'DELETE', headers: auth });
  const list2 = await (await fetch(`${base}/api/canned`, { headers: auth })).json();
  assert(!list2.canned.some((c) => c.id === created.canned.id), 'canned deleted');
  const unauthCanned = await fetch(`${base}/api/canned`);
  assert.strictEqual(unauthCanned.status, 401, 'canned API requires auth');
  ok('canned response CRUD (+dupe rejected, +auth required)');

  // ---- 9. dashboard REST: conversations, close/reopen, transcript ----
  const convs = await (await fetch(`${base}/api/conversations?status=open`, { headers: auth })).json();
  assert(convs.conversations.some((c) => c.id === convId), 'conversation listed');
  await fetch(`${base}/api/conversations/${convId}/status`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'closed' }) });
  assert.strictEqual(db.prepare('SELECT status FROM conversations WHERE id = ?').get(convId).status, 'closed');
  await fetch(`${base}/api/conversations/${convId}/status`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'open' }) });
  assert.strictEqual(db.prepare('SELECT status FROM conversations WHERE id = ?').get(convId).status, 'open');
  const transcript = await (await fetch(`${base}/api/conversations/${convId}/transcript`, { headers: auth })).text();
  assert(transcript.includes('Hello live!') && transcript.includes('Smokey'), 'transcript contains messages');
  ok('close/reopen + transcript download');

  // ---- 10. unknown site rejected; widget script served ----
  const badSite = await connect(`${wsBase}/ws?role=visitor&site=doesnotexist&visitor=v2`);
  const errMsg = await waitFor(badSite, (m) => m.type === 'error', 'unknown site error');
  assert.strictEqual(errMsg.error, 'unknown_site');
  const chatJs = await fetch(`${base}/chat.js`);
  assert.strictEqual(chatJs.status, 200);
  assert((await chatJs.text()).includes('chatlet_vid'), 'widget script served');
  ok('unknown site rejected + /chat.js served');

  // ---- 11. agent disconnect -> offline flag returns ----
  agent.close();
  await waitFor(visitor, (m) => m.type === 'agent_status' && m.online === false, 'agent_status offline');
  visitor.send(JSON.stringify({ type: 'message', body: 'offline again' }));
  await waitFor(visitor, (m) => m.type === 'message' && m.message?.body === 'offline again', 'echo');
  const lastMsg = db.prepare("SELECT * FROM messages WHERE body = 'offline again'").get();
  assert.strictEqual(lastMsg.offline, 1, 'message after agent left flagged offline');
  ok('agent disconnect -> visitor notified, new messages flagged offline');

  visitor.close();
  badSite.close();
  server.close();
  db.close();

  console.log(`\nAll ${results.length} smoke checks passed.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('\nSMOKE TEST FAILED:', e);
  process.exit(1);
});
