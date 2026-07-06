import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Inbox, Zap, Globe, Settings as SettingsIcon, LogOut,
  Volume2, VolumeX, Bell, BellOff, Wifi, WifiOff
} from 'lucide-react';
import { api, agentSocket, beep } from './api.js';
import { ChatView } from './components/ChatView.jsx';
import { ConversationList } from './components/ConversationList.jsx';
import { CannedPage, SitesPage, SettingsPage } from './components/Pages.jsx';

function Login({ onLogin }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { password: pw } });
      onLogin();
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <div className="h-full flex items-center justify-center">
      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={submit}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-80 flex flex-col gap-4"
      >
        <div className="flex items-center gap-2 justify-center">
          <MessageSquare className="text-indigo-500" size={24} />
          <h1 className="text-xl font-bold">Chatlet</h1>
        </div>
        <p className="text-sm text-zinc-400 text-center">Agent dashboard — sign in</p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Admin password"
          autoFocus
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        {err && <p className="text-red-400 text-xs">{err}</p>}
        <button className="bg-indigo-600 hover:bg-indigo-500 rounded-lg py-2 text-sm font-semibold transition-colors">
          Sign in
        </button>
      </motion.form>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  useEffect(() => {
    api('/api/me').then((d) => setAuthed(d.authed)).catch(() => setAuthed(false));
  }, []);
  if (authed === null) return null;
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return <Dashboard onLogout={() => setAuthed(false)} />;
}

function Dashboard({ onLogout }) {
  const [view, setView] = useState('inbox');
  const [statusFilter, setStatusFilter] = useState('open');
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [wsUp, setWsUp] = useState(false);
  const [sound, setSound] = useState(() => localStorage.getItem('chatlet_sound') !== '0');
  const [notify, setNotify] = useState(() => localStorage.getItem('chatlet_notify') === '1');
  const [typingConvs, setTypingConvs] = useState({}); // convId -> ts
  const [liveMsg, setLiveMsg] = useState(null); // last ws message event, consumed by ChatView
  const socketRef = useRef(null);
  const stateRef = useRef({});
  stateRef.current = { sound, notify, activeId, view };

  const loadConversations = useCallback((status) => {
    api(`/api/conversations?status=${status}`)
      .then((d) => setConversations(d.conversations))
      .catch(() => {});
  }, []);

  useEffect(() => loadConversations(statusFilter), [statusFilter, loadConversations]);

  const upsertConv = useCallback((conv) => {
    if (!conv) return;
    setConversations((prev) => {
      const rest = prev.filter((c) => c.id !== conv.id);
      return [conv, ...rest].sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
    });
  }, []);

  useEffect(() => {
    const sock = agentSocket({
      onStatus: setWsUp,
      onEvent: (msg) => {
        const s = stateRef.current;
        if (msg.type === 'message') {
          upsertConv(msg.conversation);
          setLiveMsg({ ...msg, _t: Date.now() });
          if (msg.message?.sender === 'visitor') {
            if (s.sound) beep();
            if (s.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
              new Notification(`${msg.conversation?.visitor_name || 'Visitor'} says:`, {
                body: msg.message.body.slice(0, 120),
                tag: `chatlet-${msg.conversationId}`
              });
            }
          }
        } else if (msg.type === 'conversation_new' || msg.type === 'conversation_updated') {
          upsertConv(msg.conversation);
        } else if (msg.type === 'typing' && msg.from === 'visitor') {
          setTypingConvs((t) => ({ ...t, [msg.conversationId]: Date.now() }));
        }
      }
    });
    socketRef.current = sock;
    return () => sock.close();
  }, [upsertConv]);

  // expire typing indicators
  useEffect(() => {
    const t = setInterval(() => {
      setTypingConvs((prev) => {
        const now = Date.now();
        const next = {};
        for (const [k, v] of Object.entries(prev)) if (now - v < 3000) next[k] = v;
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const toggleNotify = async () => {
    if (!notify && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return;
    }
    const v = !notify;
    setNotify(v);
    localStorage.setItem('chatlet_notify', v ? '1' : '0');
  };
  const toggleSound = () => {
    const v = !sound;
    setSound(v);
    localStorage.setItem('chatlet_sound', v ? '1' : '0');
  };

  const navBtn = (id, Icon, label) => (
    <button
      onClick={() => setView(id)}
      title={label}
      className={`flex flex-col items-center gap-1 py-3 w-full text-[10px] transition-colors ${
        view === id ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      <Icon size={20} />
      {label}
    </button>
  );

  const totalUnread = conversations.reduce((n, c) => n + (c.unread || 0), 0);

  return (
    <div className="h-full flex">
      {/* nav rail */}
      <div className="w-16 bg-zinc-950 border-r border-zinc-800 flex flex-col items-center">
        <div className="py-4 relative">
          <MessageSquare className="text-indigo-500" size={26} />
          {totalUnread > 0 && (
            <span className="absolute -top-0.5 -right-2 bg-red-500 text-[10px] font-bold rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </div>
        {navBtn('inbox', Inbox, 'Inbox')}
        {navBtn('canned', Zap, 'Canned')}
        {navBtn('sites', Globe, 'Sites')}
        {navBtn('settings', SettingsIcon, 'Settings')}
        <div className="mt-auto flex flex-col items-center gap-1 pb-3">
          <button onClick={toggleSound} title="Sound" className="p-2 text-zinc-500 hover:text-zinc-300">
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button onClick={toggleNotify} title="Browser notifications" className="p-2 text-zinc-500 hover:text-zinc-300">
            {notify ? <Bell size={17} /> : <BellOff size={17} />}
          </button>
          <div title={wsUp ? 'Live connection up' : 'Reconnecting…'} className="p-2">
            {wsUp ? <Wifi size={16} className="text-emerald-500" /> : <WifiOff size={16} className="text-amber-500" />}
          </div>
          <button
            onClick={async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); onLogout(); }}
            title="Log out"
            className="p-2 text-zinc-500 hover:text-red-400"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'inbox' && (
          <motion.div key="inbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 min-w-0">
            <ConversationList
              conversations={conversations}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              activeId={activeId}
              setActiveId={setActiveId}
              typingConvs={typingConvs}
            />
            <ChatView
              key={activeId}
              conversationId={activeId}
              socket={socketRef}
              liveMsg={liveMsg}
              typing={activeId && typingConvs[activeId]}
              onConversationChange={upsertConv}
              refresh={() => loadConversations(statusFilter)}
            />
          </motion.div>
        )}
        {view === 'canned' && <PageWrap key="canned"><CannedPage /></PageWrap>}
        {view === 'sites' && <PageWrap key="sites"><SitesPage /></PageWrap>}
        {view === 'settings' && <PageWrap key="settings"><SettingsPage /></PageWrap>}
      </AnimatePresence>
    </div>
  );
}

function PageWrap({ children }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-w-0 overflow-y-auto">
      {children}
    </motion.div>
  );
}
