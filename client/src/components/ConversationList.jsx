import React from 'react';
import { Circle } from 'lucide-react';

function timeAgo(ts) {
  if (!ts) return '';
  const d = (Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()) / 1000;
  if (d < 60) return 'now';
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export function ConversationList({ conversations, statusFilter, setStatusFilter, activeId, setActiveId, typingConvs }) {
  const filtered = conversations.filter((c) => c.status === statusFilter);
  return (
    <div className="w-80 border-r border-zinc-800 bg-zinc-950/50 flex flex-col shrink-0">
      <div className="p-3 border-b border-zinc-800">
        <div className="flex bg-zinc-900 rounded-lg p-0.5">
          {['open', 'closed'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`flex-1 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${
                statusFilter === s ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-zinc-600 text-sm text-center mt-10 px-4">
            No {statusFilter} conversations yet. Embed the widget on your site and messages will appear here live.
          </p>
        )}
        {filtered.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveId(c.id)}
            className={`w-full text-left px-4 py-3 border-b border-zinc-900 transition-colors ${
              activeId === c.id ? 'bg-zinc-800/70' : 'hover:bg-zinc-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate flex-1">
                {c.visitor_name || 'Anonymous visitor'}
              </span>
              <span className="text-[11px] text-zinc-500">{timeAgo(c.last_message_at)}</span>
              {c.unread > 0 && (
                <span className="bg-indigo-500 text-[10px] font-bold rounded-full min-w-4.5 h-4.5 px-1.5 flex items-center justify-center">
                  {c.unread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Circle size={6} className={c.status === 'open' ? 'text-emerald-500 fill-emerald-500' : 'text-zinc-600 fill-zinc-600'} />
              <span className="text-xs text-zinc-500 truncate">{c.site_name}</span>
            </div>
            <p className="text-xs text-zinc-400 truncate mt-1">
              {typingConvs[c.id] ? <em className="text-indigo-400">typing…</em> : c.last_body || 'No messages yet'}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
