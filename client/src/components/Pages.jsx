import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Check, Copy, Zap, Globe, Save } from 'lucide-react';
import { api } from '../api.js';

// ---------------- Canned responses ----------------

export function CannedPage() {
  const [items, setItems] = useState([]);
  const [shortcut, setShortcut] = useState('');
  const [body, setBody] = useState('');
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api('/api/canned').then((d) => setItems(d.canned)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr('');
    try {
      if (editId) await api(`/api/canned/${editId}`, { method: 'PUT', body: { shortcut, body } });
      else await api('/api/canned', { method: 'POST', body: { shortcut, body } });
      setShortcut(''); setBody(''); setEditId(null);
      load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-xl font-bold flex items-center gap-2 mb-1"><Zap size={20} className="text-indigo-500" /> Canned responses</h1>
      <p className="text-sm text-zinc-500 mb-6">Type <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-indigo-400">/shortcut</code> in the composer to insert these instantly.</p>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-6 space-y-3">
        <div className="flex gap-2 items-center">
          <span className="text-zinc-500 font-mono">/</span>
          <input
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder="shortcut (e.g. pricing)"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 font-mono"
          />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Response text…"
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 resize-none"
        />
        {err && <p className="text-red-400 text-xs">{err}</p>}
        <button onClick={save} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          {editId ? <Check size={15} /> : <Plus size={15} />} {editId ? 'Update' : 'Add'}
        </button>
      </div>

      {items.map((c) => (
        <div key={c.id} className="flex items-start gap-3 bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 mb-2">
          <div className="flex-1 min-w-0">
            <span className="text-indigo-400 font-mono text-sm font-semibold">/{c.shortcut}</span>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{c.body}</p>
          </div>
          <button onClick={() => { setEditId(c.id); setShortcut(c.shortcut); setBody(c.body); }} className="p-1.5 text-zinc-500 hover:text-white"><Pencil size={15} /></button>
          <button onClick={async () => { await api(`/api/canned/${c.id}`, { method: 'DELETE' }); load(); }} className="p-1.5 text-zinc-500 hover:text-red-400"><Trash2 size={15} /></button>
        </div>
      ))}
      {items.length === 0 && <p className="text-zinc-600 text-sm">No canned responses yet.</p>}
    </div>
  );
}

// ---------------- Sites ----------------

export function SitesPage() {
  const [sites, setSites] = useState([]);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(null);
  const origin = location.origin;

  const load = () => api('/api/sites').then((d) => setSites(d.sites)).catch(() => {});
  useEffect(() => { load(); }, []);

  const snippet = (id) => `<script src="${origin}/chat.js" data-site="${id}"></script>`;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-xl font-bold flex items-center gap-2 mb-1"><Globe size={20} className="text-indigo-500" /> Sites</h1>
      <p className="text-sm text-zinc-500 mb-6">One Chatlet install can power chat on all your websites. Paste each site's snippet before <code className="bg-zinc-800 px-1 rounded">&lt;/body&gt;</code>.</p>

      <div className="flex gap-2 mb-6">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={async (e) => { if (e.key === 'Enter' && name.trim()) { await api('/api/sites', { method: 'POST', body: { name } }); setName(''); load(); } }}
          placeholder="Site name (e.g. My Store)"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button
          onClick={async () => { if (name.trim()) { await api('/api/sites', { method: 'POST', body: { name } }); setName(''); load(); } }}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={15} /> Add site
        </button>
      </div>

      {sites.map((s) => (
        <div key={s.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-semibold text-sm flex-1">{s.name}</span>
            <span className="text-xs text-zinc-500">{s.conversations} conversation{s.conversations === 1 ? '' : 's'}</span>
            <button
              onClick={async () => {
                if (confirm(`Delete site "${s.name}"? The widget on that site will stop working.`)) {
                  await api(`/api/sites/${s.id}`, { method: 'DELETE' }); load();
                }
              }}
              className="p-1.5 text-zinc-500 hover:text-red-400"
            ><Trash2 size={15} /></button>
          </div>
          <div className="flex gap-2 items-center">
            <code className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] text-emerald-400 overflow-x-auto whitespace-nowrap">{snippet(s.id)}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(snippet(s.id)); setCopied(s.id); setTimeout(() => setCopied(null), 1500); }}
              className="p-2 text-zinc-400 hover:text-white"
              title="Copy snippet"
            >
              {copied === s.id ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Settings ----------------

const FIELDS = [
  { section: 'Widget appearance', items: [
    { key: 'widget_title', label: 'Widget title', ph: 'Chat with us' },
    { key: 'widget_greeting', label: 'Greeting message', ph: 'Hi there! How can we help?' },
    { key: 'widget_color', label: 'Accent color (hex)', ph: '#6366f1' }
  ]},
  { section: 'Offline email notifications (BYO SMTP)', items: [
    { key: 'notify_email', label: 'Notify email (where offline messages go)', ph: 'you@company.com' },
    { key: 'smtp_host', label: 'SMTP host', ph: 'smtp.fastmail.com' },
    { key: 'smtp_port', label: 'SMTP port', ph: '587' },
    { key: 'smtp_user', label: 'SMTP user', ph: '' },
    { key: 'smtp_pass', label: 'SMTP password', ph: '', type: 'password' },
    { key: 'smtp_from', label: 'From address', ph: 'chatlet@yourdomain.com' }
  ]}
];

export function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api('/api/settings').then((d) => setSettings(d.settings)).catch(() => {});
  }, []);

  const save = async () => {
    await api('/api/settings', { method: 'PUT', body: settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-6">Settings</h1>
      {FIELDS.map((sec) => (
        <div key={sec.section} className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3">{sec.section}</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
            {sec.items.map((f) => (
              <label key={f.key} className="block">
                <span className="text-xs text-zinc-400">{f.label}</span>
                <input
                  type={f.type || 'text'}
                  value={settings[f.key] ?? ''}
                  onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder={f.ph}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-zinc-500 mb-4">If SMTP host + notify email are empty, offline messages are still stored in the inbox — you just won't get an email ping. Sound & browser notification toggles live in the left rail.</p>
      <button onClick={save} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
        {saved ? <Check size={15} /> : <Save size={15} />} {saved ? 'Saved' : 'Save settings'}
      </button>
    </div>
  );
}
