import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Send, CheckCircle2, RotateCcw, Download, Globe, Monitor, Link2, MessageSquare, Inbox, MailWarning
} from 'lucide-react';
import { api } from '../api.js';

export function ChatView({ conversationId, socket, liveMsg, typing, onConversationChange, refresh }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [canned, setCanned] = useState([]);
  const [showCanned, setShowCanned] = useState(false);
  const endRef = useRef(null);
  const lastTypingRef = useRef(0);

  useEffect(() => {
    api('/api/canned').then((d) => setCanned(d.canned)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!conversationId) { setData(null); return; }
    api(`/api/conversations/${conversationId}`)
      .then((d) => {
        setData(d);
        api(`/api/conversations/${conversationId}/read`, { method: 'POST' })
          .then(() => socket.current?.send({ type: 'read', conversationId }))
          .catch(() => {});
      })
      .catch(() => setData(null));
  }, [conversationId]);

  // live incoming messages for this conversation
  useEffect(() => {
    if (!liveMsg || liveMsg.conversationId !== conversationId || !data) return;
    setData((prev) => {
      if (!prev || prev.messages.some((m) => m.id === liveMsg.message.id)) return prev;
      return { ...prev, messages: [...prev.messages, liveMsg.message] };
    });
    if (liveMsg.message?.sender === 'visitor') {
      api(`/api/conversations/${conversationId}/read`, { method: 'POST' })
        .then(() => socket.current?.send({ type: 'read', conversationId }))
        .catch(() => {});
    }
  }, [liveMsg]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages?.length, typing]);

  if (!conversationId || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-3">
        <Inbox size={40} />
        <p className="text-sm">Select a conversation</p>
      </div>
    );
  }

  const conv = data.conversation;
  const visitor = data.visitor || {};

  const doSend = (body) => {
    const msg = (body ?? text).trim();
    if (!msg) return;
    socket.current?.send({ type: 'message', conversationId, body: msg });
    setText('');
    setShowCanned(false);
  };

  const setStatus = async (status) => {
    await api(`/api/conversations/${conversationId}/status`, { method: 'POST', body: { status } });
    const updated = { ...conv, status };
    setData((p) => ({ ...p, conversation: updated }));
    onConversationChange(updated);
    refresh();
  };

  const onInput = (v) => {
    setText(v);
    setShowCanned(v.startsWith('/'));
    const t = Date.now();
    if (t - lastTypingRef.current > 1500) {
      lastTypingRef.current = t;
      socket.current?.send({ type: 'typing', conversationId });
    }
  };

  const cannedMatches = showCanned
    ? canned.filter((c) => ('/' + c.shortcut).startsWith(text.toLowerCase())).slice(0, 6)
    : [];

  return (
    <div className="flex-1 flex min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        {/* header */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm truncate">{conv.visitor_name || 'Anonymous visitor'}</h2>
            <p className="text-xs text-zinc-500 truncate">{conv.visitor_email || 'no email'} · {conv.site_name}</p>
          </div>
          <a
            href={`/api/conversations/${conversationId}/transcript`}
            className="p-2 text-zinc-400 hover:text-white transition-colors"
            title="Download transcript"
          >
            <Download size={17} />
          </a>
          {conv.status === 'open' ? (
            <button
              onClick={() => setStatus('closed')}
              className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <CheckCircle2 size={14} /> Close
            </button>
          ) : (
            <button
              onClick={() => setStatus('open')}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <RotateCcw size={14} /> Reopen
            </button>
          )}
        </div>

        {/* messages */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-2">
          {data.messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${
                m.sender === 'agent'
                  ? 'self-end bg-indigo-600 rounded-br-md'
                  : m.sender === 'visitor'
                    ? 'self-start bg-zinc-800 rounded-bl-md'
                    : 'self-center bg-transparent text-zinc-500 text-xs'
              }`}
            >
              {m.offline === 1 && (
                <span className="flex items-center gap-1 text-[10px] text-amber-400 mb-0.5">
                  <MailWarning size={11} /> left while offline
                </span>
              )}
              {m.body}
              <span className="block text-[10px] opacity-50 mt-0.5">{m.created_at?.slice(11, 16)}</span>
            </motion.div>
          ))}
          {typing && (
            <div className="self-start bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3 flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-zinc-400"
                  animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                  transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }}
                />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* composer */}
        <div className="relative p-3 border-t border-zinc-800">
          {cannedMatches.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-1 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden shadow-xl">
              {cannedMatches.map((c) => (
                <button
                  key={c.id}
                  onClick={() => doSend(c.body)}
                  className="w-full text-left px-4 py-2.5 hover:bg-zinc-800 transition-colors"
                >
                  <span className="text-indigo-400 text-xs font-mono font-semibold">/{c.shortcut}</span>
                  <p className="text-sm text-zinc-300 truncate">{c.body}</p>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              value={text}
              onChange={(e) => onInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (cannedMatches.length > 0 && text.startsWith('/')) doSend(cannedMatches[0].body);
                  else doSend();
                }
              }}
              placeholder="Reply… (type / for canned responses)"
              rows={1}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm resize-none outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => doSend()}
              className="bg-indigo-600 hover:bg-indigo-500 rounded-xl w-11 flex items-center justify-center transition-colors"
            >
              <Send size={17} />
            </button>
          </div>
        </div>
      </div>

      {/* visitor context sidebar */}
      <div className="w-72 border-l border-zinc-800 bg-zinc-950/50 p-4 overflow-y-auto shrink-0 hidden lg:block">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3">Visitor</h3>
        <div className="space-y-3 text-sm">
          <ContextRow icon={Globe} label="Current page" value={visitor.current_page} link />
          <ContextRow icon={Link2} label="Referrer" value={visitor.referrer} link />
          <ContextRow icon={Monitor} label="Browser" value={visitor.user_agent} />
          <ContextRow icon={MessageSquare} label="First seen" value={visitor.first_seen} />
        </div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mt-6 mb-3">
          Past conversations ({data.pastConversations.length})
        </h3>
        {data.pastConversations.length === 0 && <p className="text-xs text-zinc-600">First conversation with this visitor.</p>}
        {data.pastConversations.map((p) => (
          <div key={p.id} className="text-xs text-zinc-400 py-2 border-b border-zinc-900">
            <span className={`font-semibold ${p.status === 'open' ? 'text-emerald-500' : 'text-zinc-500'}`}>#{p.id} · {p.status}</span>
            <span className="block text-zinc-600">{p.last_message_at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContextRow({ icon: Icon, label, value, link }) {
  return (
    <div>
      <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-0.5">
        <Icon size={12} /> {label}
      </span>
      {value ? (
        link && /^https?:/.test(value) ? (
          <a href={value} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline break-all text-xs">
            {value}
          </a>
        ) : (
          <p className="text-zinc-300 break-all text-xs">{value}</p>
        )
      ) : (
        <p className="text-zinc-600 text-xs">—</p>
      )}
    </div>
  );
}
