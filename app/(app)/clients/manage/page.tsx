'use client';

import { useEffect, useState, useRef } from 'react';
import { Spinner } from '@/components/Spinner';
interface Client {
  id: number;
  name: string;
  domains: string[];
  seedUrls: string[] | null;
  seedUrlsUpdatedAt: string | null;
  teamworkTasklistId: string | null;
  archivedAt: string | null;
  createdAt: string;
}

function formatDate(dt: string | null | undefined): string {
  if (!dt) return '';
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828A2 2 0 0110 16.414H8v-2a2 2 0 01.586-1.414z" />
    </svg>
  );
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addForm, setAddForm] = useState({ open: false, name: '', error: '', loading: false });
  const [editForm, setEditForm] = useState<{ id: number | null; name: string; error: string; loading: boolean }>({ id: null, name: '', error: '', loading: false });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number | null; loading: boolean }>({ id: null, loading: false });
  const [archiveConfirm, setArchiveConfirm] = useState<{ id: number | null; loading: boolean }>({ id: null, loading: false });
  const [showArchived, setShowArchived] = useState(false);

  // Domain management
  const [domainInput, setDomainInput] = useState<Record<number, string>>({});
  const [domainLoading, setDomainLoading] = useState<Record<number, boolean>>({});

  // Seed URL management
  const [localSeedUrlsText, setLocalSeedUrlsText] = useState<Record<number, string>>({});
  const [seedUrlsLoading, setSeedUrlsLoading] = useState<Record<number, boolean>>({});

  // Teamwork tasklist ID management
  const [localTasklistId, setLocalTasklistId] = useState<Record<number, string>>({});
  const [tasklistIdLoading, setTasklistIdLoading] = useState<Record<number, boolean>>({});

  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Clients — ER SEO Tools';
  }, []);

  useEffect(() => {
    fetch('/api/clients?includeArchived=1')
      .then((r) => r.json())
      .then((data) => {
        setClients(Array.isArray(data) ? data : []);
        setIsLoading(false);
      })
      .catch(() => {
        setError('Failed to load clients.');
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (addForm.open) setTimeout(() => addInputRef.current?.focus(), 50);
  }, [addForm.open]);

  useEffect(() => {
    if (editForm.id !== null) setTimeout(() => editInputRef.current?.focus(), 50);
  }, [editForm.id]);

  // ── Add client ─────────────────────────────────────────────────────────────

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = addForm.name.trim();
    if (!name) return;
    setAddForm((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setAddForm((prev) => ({ ...prev, loading: false, error: data.error ?? 'Failed to add client' })); return; }
      setClients((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setAddForm({ open: false, name: '', error: '', loading: false });
    } catch {
      setAddForm((prev) => ({ ...prev, loading: false, error: 'Failed to add client' }));
    }
  };

  // ── Rename client ──────────────────────────────────────────────────────────

  const startEdit = (client: Client) => {
    setEditForm({ id: client.id, name: client.name, error: '', loading: false });
  };

  const saveEdit = async (id: number) => {
    const name = editForm.name.trim();
    if (!name) return;
    setEditForm((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setEditForm((prev) => ({ ...prev, loading: false, error: data.error ?? 'Failed to rename' })); return; }
      setClients((prev) =>
        prev.map((c) => (c.id === id ? { ...c, name: data.name } : c))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditForm({ id: null, name: '', error: '', loading: false });
    } catch {
      setEditForm((prev) => ({ ...prev, loading: false, error: 'Failed to rename' }));
    }
  };

  // ── Domain management ──────────────────────────────────────────────────────

  const addDomain = async (client: Client) => {
    const raw = (domainInput[client.id] ?? '').trim().toLowerCase();
    if (!raw) return;
    // Strip protocol if accidentally typed
    const domain = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain) return;
    if (client.domains.includes(domain)) {
      setDomainInput((prev) => ({ ...prev, [client.id]: '' }));
      return;
    }
    const newDomains = [...client.domains, domain];
    setDomainLoading((prev) => ({ ...prev, [client.id]: true }));
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: newDomains }),
      });
      if (res.ok) {
        setClients((prev) =>
          prev.map((c) => (c.id === client.id ? { ...c, domains: newDomains } : c))
        );
        setDomainInput((prev) => ({ ...prev, [client.id]: '' }));
      }
    } finally {
      setDomainLoading((prev) => ({ ...prev, [client.id]: false }));
    }
  };

  const removeDomain = async (client: Client, domain: string) => {
    const newDomains = client.domains.filter((d) => d !== domain);
    setDomainLoading((prev) => ({ ...prev, [client.id]: true }));
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: newDomains }),
      });
      if (res.ok) {
        setClients((prev) =>
          prev.map((c) => (c.id === client.id ? { ...c, domains: newDomains } : c))
        );
      }
    } finally {
      setDomainLoading((prev) => ({ ...prev, [client.id]: false }));
    }
  };

  // ── Seed URL management ────────────────────────────────────────────────────

  const handleSaveSeedUrls = async (clientId: number, text: string) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
    // Extract first http(s) URL per line (lenient, same as parseManualUrls)
    const HTTP_URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i;
    const urls = lines.map((l) => { const m = l.match(HTTP_URL_RE); return m ? m[0] : null; }).filter(Boolean) as string[];
    const seedUrls = urls.length > 0 ? urls : null;
    setSeedUrlsLoading((prev) => ({ ...prev, [clientId]: true }));
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedUrls }),
      });
      const data = await res.json();
      if (res.ok) {
        setClients((prev) =>
          prev.map((c) => (c.id === clientId ? { ...c, seedUrls: data.seedUrls, seedUrlsUpdatedAt: data.seedUrlsUpdatedAt } : c))
        );
        // Clear local override so the textarea reflects saved state
        setLocalSeedUrlsText((prev) => { const next = { ...prev }; delete next[clientId]; return next; });
      }
    } finally {
      setSeedUrlsLoading((prev) => ({ ...prev, [clientId]: false }));
    }
  };

  // ── Teamwork tasklist ID management ──────────────────────────────────────

  const handleSaveTasklistId = async (clientId: number, value: string) => {
    setTasklistIdLoading((prev) => ({ ...prev, [clientId]: true }));
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamworkTasklistId: value.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setClients((prev) =>
          prev.map((c) => (c.id === clientId ? { ...c, teamworkTasklistId: data.teamworkTasklistId } : c))
        );
        setLocalTasklistId((prev) => { const next = { ...prev }; delete next[clientId]; return next; });
      }
    } finally {
      setTasklistIdLoading((prev) => ({ ...prev, [clientId]: false }));
    }
  };

  // ── Archive / restore / delete ─────────────────────────────────────────────

  const setArchived = async (id: number, archived: boolean) => {
    const res = await fetch(`/api/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    });
    if (res.ok) {
      const data = await res.json();
      setClients((prev) => prev.map((c) => (c.id === id ? { ...c, archivedAt: data.archivedAt } : c)));
    }
  };

  const handleArchive = async (id: number) => {
    setArchiveConfirm({ id, loading: true });
    try { await setArchived(id, true); } finally { setArchiveConfirm({ id: null, loading: false }); }
  };

  // Hard delete — only offered on already-archived rows (the API 409s otherwise).
  const handleDelete = async (id: number) => {
    setDeleteConfirm({ id, loading: true });
    try {
      const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      if (res.ok) setClients((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setDeleteConfirm({ id: null, loading: false });
    }
  };

  const visibleClients = clients.filter((c) => (showArchived ? true : !c.archivedAt));
  const archivedCount = clients.filter((c) => c.archivedAt).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <a
            href="/clients"
            className="text-xs text-gray-400 dark:text-white/40 hover:text-orange transition-colors"
          >
            ← Fleet
          </a>
          <h1 className="text-3xl font-display font-bold text-navy dark:text-white mb-1 mt-1">Manage Clients</h1>
          <p className="text-sm text-gray-500 dark:text-white/60">
            Shared across the Quarter Grid and SEO Parser. Add domains to enable automatic client matching when uploading crawl files.
          </p>
        </div>
        <button
          onClick={() => setAddForm({ open: true, name: '', error: '', loading: false })}
          className="flex items-center gap-1.5 px-4 py-2 bg-orange hover:bg-orange-dark text-white text-sm font-semibold rounded-lg transition-colors shadow-sm flex-shrink-0 ml-6"
        >
          <PlusIcon />
          Add Client
        </button>
      </div>

      {/* Add client form */}
      {addForm.open && (
        <form
          onSubmit={handleAdd}
          className="mb-6 p-4 bg-orange/8 border border-orange/30 rounded-xl flex items-start gap-3"
        >
          <div className="flex-1">
            <input
              ref={addInputRef}
              type="text"
              placeholder="Client name…"
              value={addForm.name}
              onChange={(e) => setAddForm((prev) => ({ ...prev, name: e.target.value, error: '' }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-navy-border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 bg-white dark:bg-navy-card dark:text-white"
            />
            {addForm.error && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{addForm.error}</p>}
          </div>
          <button
            type="submit"
            disabled={!addForm.name.trim() || addForm.loading}
            className="px-4 py-2 bg-orange hover:bg-orange-dark disabled:bg-gray-200 dark:disabled:bg-navy-light disabled:text-gray-400 dark:disabled:text-white/40 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {addForm.loading ? 'Adding…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => setAddForm({ open: false, name: '', error: '', loading: false })}
            className="px-3 py-2 text-sm text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-navy-light transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-navy-light rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-8 text-red-500 dark:text-red-400 text-sm">{error}</div>
      )}

      {/* Empty */}
      {!isLoading && !error && clients.length === 0 && (
        <div className="text-center py-12 text-gray-400 dark:text-white/40">
          <p className="text-sm mb-1">No clients yet.</p>
          <p className="text-xs">Add your first client above.</p>
        </div>
      )}

      {/* Client list */}
      {!isLoading && !error && clients.length > 0 && (
        <div className="space-y-3">
          {visibleClients.map((client) => (
            <div
              key={client.id}
              className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-xl px-5 py-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                {/* Name / edit */}
                <div className="flex-1 min-w-0">
                  {editForm.id === client.id ? (
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value, error: '' }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(client.id);
                          if (e.key === 'Escape') setEditForm({ id: null, name: '', error: '', loading: false });
                        }}
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-navy-border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 dark:bg-navy-card dark:text-white"
                      />
                      <button
                        onClick={() => saveEdit(client.id)}
                        disabled={!editForm.name.trim() || editForm.loading}
                        className="px-3 py-1.5 bg-orange hover:bg-orange-dark disabled:bg-gray-200 dark:disabled:bg-navy-light text-white text-xs font-semibold rounded-lg transition-colors"
                      >
                        {editForm.loading ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditForm({ id: null, name: '', error: '', loading: false })}
                        className="px-3 py-1.5 text-xs text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-navy-light transition-colors"
                      >
                        Cancel
                      </button>
                      {editForm.error && <span className="text-xs text-red-500 dark:text-red-400">{editForm.error}</span>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-3">
                      <a
                        href={`/clients/${client.id}`}
                        className="font-semibold text-navy dark:text-white text-sm hover:text-orange dark:hover:text-orange transition-colors"
                      >
                        {client.name}
                      </a>
                      {client.archivedAt && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-white/50 font-semibold uppercase tracking-wide">
                          Archived {formatDate(client.archivedAt)}
                        </span>
                      )}
                      <button
                        onClick={() => startEdit(client)}
                        aria-label="Rename client"
                        className="p-1 text-gray-400 dark:text-white/40 hover:text-navy dark:hover:text-white rounded transition-colors"
                      >
                        <PencilIcon />
                      </button>
                      <a
                        href={`/clients/${client.id}`}
                        className="text-xs text-gray-400 dark:text-white/40 hover:text-orange transition-colors"
                      >
                        SEO history →
                      </a>
                    </div>
                  )}

                  {/* Domains */}
                  <div className="flex flex-wrap items-center gap-2">
                    {client.domains.map((domain) => (
                      <span
                        key={domain}
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-navy/8 dark:bg-white/10 text-navy dark:text-white/80 rounded-full font-mono"
                      >
                        {domain}
                        <button
                          onClick={() => removeDomain(client, domain)}
                          disabled={domainLoading[client.id]}
                          aria-label={`Remove domain ${domain}`}
                          className="ml-0.5 text-gray-400 dark:text-white/40 hover:text-red-500 transition-colors leading-none"
                        >
                          ×
                        </button>
                      </span>
                    ))}

                    {/* Add domain input */}
                    <form
                      onSubmit={(e) => { e.preventDefault(); addDomain(client); }}
                      className="flex items-center gap-1"
                    >
                      <input
                        type="text"
                        placeholder="add domain…"
                        value={domainInput[client.id] ?? ''}
                        onChange={(e) =>
                          setDomainInput((prev) => ({ ...prev, [client.id]: e.target.value }))
                        }
                        className="w-36 px-2 py-0.5 text-xs border border-dashed border-gray-300 dark:border-navy-border rounded-full focus:outline-none focus:border-orange bg-transparent dark:text-white font-mono placeholder:text-gray-400 dark:placeholder:text-white/40"
                      />
                      {(domainInput[client.id] ?? '').trim() && (
                        <button
                          type="submit"
                          disabled={domainLoading[client.id]}
                          className="text-xs px-2 py-0.5 bg-navy text-white rounded-full hover:bg-navy-deep transition-colors"
                        >
                          +
                        </button>
                      )}
                    </form>
                  </div>

                  {client.domains.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-white/40 mt-1">
                      No domains yet — add one above to enable auto-matching in the SEO Parser.
                    </p>
                  )}

                  {/* Seed URLs */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[12px] font-body font-semibold text-navy/70 dark:text-white/70 hover:text-orange select-none">
                      Manual seed URLs
                      {client.seedUrls && client.seedUrls.length > 0 && (
                        <span className="font-normal text-navy/40 dark:text-white/40">
                          {' '}· {client.seedUrls.length} saved
                        </span>
                      )}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={localSeedUrlsText[client.id] ?? (client.seedUrls?.join('\n') ?? '')}
                        onChange={(e) => setLocalSeedUrlsText((prev) => ({ ...prev, [client.id]: e.target.value }))}
                        rows={6}
                        placeholder={'https://example.edu/\nhttps://example.edu/about/'}
                        className="w-full px-3 py-2 text-[12px] font-mono text-navy dark:text-white border border-gray-300 dark:border-navy-border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange bg-white dark:bg-navy-card transition-colors resize-y"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
                          {client.seedUrlsUpdatedAt
                            ? `Saved · ${client.seedUrls?.length ?? 0} URLs · updated ${formatDate(client.seedUrlsUpdatedAt)}`
                            : 'Not saved'}
                        </p>
                        <button
                          type="button"
                          disabled={seedUrlsLoading[client.id]}
                          onClick={() => handleSaveSeedUrls(client.id, localSeedUrlsText[client.id] ?? (client.seedUrls?.join('\n') ?? ''))}
                          className="text-[12px] font-body font-semibold text-orange hover:text-orange-dark disabled:opacity-50 transition-colors"
                        >
                          {seedUrlsLoading[client.id] ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </details>

                  {/* Teamwork tasklist ID */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[12px] font-body font-semibold text-navy/70 dark:text-white/70 hover:text-orange select-none">
                      Teamwork tasklist ID
                      {client.teamworkTasklistId && (
                        <span className="font-normal font-mono text-navy/40 dark:text-white/40">
                          {' '}· {client.teamworkTasklistId}
                        </span>
                      )}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        value={localTasklistId[client.id] ?? (client.teamworkTasklistId ?? '')}
                        onChange={(e) => setLocalTasklistId((prev) => ({ ...prev, [client.id]: e.target.value }))}
                        placeholder="e.g. 12345678"
                        className="w-full px-3 py-2 text-[12px] font-mono text-navy dark:text-white border border-gray-300 dark:border-navy-border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange bg-white dark:bg-navy-card transition-colors"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
                          {client.teamworkTasklistId ? `Saved · ${client.teamworkTasklistId}` : 'Not set'}
                        </p>
                        <button
                          type="button"
                          disabled={tasklistIdLoading[client.id]}
                          onClick={() => handleSaveTasklistId(client.id, localTasklistId[client.id] ?? (client.teamworkTasklistId ?? ''))}
                          className="text-[12px] font-body font-semibold text-orange hover:text-orange-dark disabled:opacity-50 transition-colors"
                        >
                          {tasklistIdLoading[client.id] ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </details>
                </div>

                {/* Archive (active) / Restore + Delete (archived) */}
                <div className="flex-shrink-0">
                  {!client.archivedAt ? (
                    archiveConfirm.id === client.id && !archiveConfirm.loading ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-600 dark:text-white/60">Archive?</span>
                        <button
                          onClick={() => handleArchive(client.id)}
                          className="text-amber-600 dark:text-amber-400 font-semibold hover:text-amber-800 dark:hover:text-amber-300"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setArchiveConfirm({ id: null, loading: false })}
                          className="text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setArchiveConfirm({ id: client.id, loading: false })}
                        disabled={archiveConfirm.loading && archiveConfirm.id === client.id}
                        aria-label="Archive client"
                        title="Archive — hides the client everywhere; data is preserved and restorable"
                        className="p-1.5 text-gray-400 dark:text-white/40 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-colors"
                      >
                        {archiveConfirm.loading && archiveConfirm.id === client.id ? (
                          <Spinner className="w-4 h-4" />
                        ) : (
                          <TrashIcon />
                        )}
                      </button>
                    )
                  ) : (
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        onClick={() => setArchived(client.id, false)}
                        aria-label="Restore client"
                        className="text-orange font-semibold hover:text-orange-dark"
                      >
                        Restore
                      </button>
                      {deleteConfirm.id === client.id && !deleteConfirm.loading ? (
                        <>
                          <span className="text-gray-600 dark:text-white/60">Delete forever?</span>
                          <button
                            onClick={() => handleDelete(client.id)}
                            className="text-red-600 dark:text-red-400 font-semibold hover:text-red-800 dark:hover:text-red-300"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ id: null, loading: false })}
                            className="text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white"
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm({ id: client.id, loading: false })}
                          aria-label="Delete client"
                          className="text-gray-400 dark:text-white/40 hover:text-red-500"
                        >
                          {deleteConfirm.loading && deleteConfirm.id === client.id ? <Spinner className="w-4 h-4" /> : 'Delete'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-white/40 mt-6 text-center">
        {clients.length - archivedCount} client{clients.length - archivedCount !== 1 ? 's' : ''}
        {archivedCount > 0 && (
          <>
            {' · '}
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="underline hover:text-orange transition-colors"
            >
              {showArchived ? 'Hide' : 'Show'} {archivedCount} archived
            </button>
          </>
        )}
      </p>
    </div>
  );
}
