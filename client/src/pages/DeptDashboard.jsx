/**
 * DeptDashboard.jsx - Department Head view
 *  - Inbox with overdue / expiring-SLA tickets pinned at the very top (server-sorted)
 *  - Progress control panel: 0-100% selector, status, resolution proof, official remarks
 *  - Saves with PUT /api/grievances/:id/progress
 *
 * Assumes React 17+, Vite, Tailwind, axios. Login must store `token` and `user` in localStorage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  assetUrl,
  CATEGORY_ICONS,
  CATEGORY_STYLES,
  CRITICAL_THRESHOLD,
  filterImageFiles,
  getErrorMessage,
  getStoredUser,
  isSafeUrl,
  MAX_IMAGES,
  STATUS_STYLES,
  timeAgo,
  uploadImages,
  useNotice,
  useNow,
  useSession,
} from '../utils/common';
import { ImageStrip, ProgressBar, RoleGate, SlaInfo, Spinner, Toast } from '../components/Common';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAGE_SIZE = 20;
const POLL_MS = 30000;
const CLOCK_MS = 30000;
const PROGRESS_STEPS = [0, 25, 50, 75, 100];
const STATUS_OPTIONS = ['Pending', 'In Progress', 'Resolved'];
const STATUS_FILTERS = ['', 'Pending', 'In Progress', 'Escalated', 'Resolved'];
const WINDOW_OPTIONS = [6, 12, 24, 48];
const DESC_PREVIEW = 200;

const SLA_STYLES = {
  overdue: { label: 'OVERDUE', chip: 'bg-red-600 text-white', border: 'border-l-red-500', bg: 'bg-red-50/60' },
  expiring: { label: 'EXPIRING SOON', chip: 'bg-amber-500 text-white', border: 'border-l-amber-400', bg: 'bg-amber-50/60' },
  on_track: { label: 'ON TRACK', chip: 'bg-emerald-100 text-emerald-700', border: 'border-l-emerald-400', bg: 'bg-white' },
  closed: { label: 'CLOSED', chip: 'bg-slate-200 text-slate-600', border: 'border-l-slate-300', bg: 'bg-white' },
};

// ---------------------------------------------------------------------------
// Progress control panel
// ---------------------------------------------------------------------------
function ProgressPanel({ ticket, onUpdated, notify }) {
  const [progress, setProgress] = useState(ticket.progressPercentage ?? 0);
  const [status, setStatus] = useState(ticket.status);
  const [newProofs, setNewProofs] = useState([]); // URLs / paths that will be attached on save
  const [urlInput, setUrlInput] = useState('');
  const [remarks, setRemarks] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // pick up changes that arrive from the server (e.g. after saving or a live refresh)
  useEffect(() => {
    setProgress(ticket.progressPercentage ?? 0);
    setStatus(ticket.status);
  }, [ticket.progressPercentage, ticket.status]);

  const existingProofs = ticket.resolutionProofImages || [];
  const progressChanged = progress !== (ticket.progressPercentage ?? 0);
  const statusChanged = status !== ticket.status;
  const dirty = progressChanged || statusChanged || newProofs.length > 0 || remarks.trim().length > 0;
  const missingProof = status === 'Resolved' && existingProofs.length + newProofs.length === 0;

  // keep progress and status consistent with each other
  const chooseProgress = (value) => {
    setProgress(value);
    if (value === 100) setStatus('Resolved');
    else if (status === 'Resolved') setStatus('In Progress');
    else if (value > 0 && status === 'Pending') setStatus('In Progress');
  };
  const chooseStatus = (value) => {
    setStatus(value);
    if (value === 'Resolved') setProgress(100);
    else if (progress === 100) setProgress(75);
  };

  const addUrl = () => {
    const url = urlInput.trim();
    if (!isSafeUrl(url)) return notify('error', 'Enter a valid image link (https://… or /uploads/…)');
    if (newProofs.includes(url) || existingProofs.includes(url)) return notify('error', 'That image is already attached');
    if (newProofs.length >= MAX_IMAGES) return notify('error', `You can add at most ${MAX_IMAGES} images per update`);
    setNewProofs((p) => [...p, url]);
    setUrlInput('');
    return undefined;
  };

  const handleFiles = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;

    const { valid, error } = filterImageFiles(picked);
    if (error) notify('error', error);
    const room = MAX_IMAGES - newProofs.length;
    if (valid.length > room) notify('error', `You can add at most ${MAX_IMAGES} images per update`);
    const files = valid.slice(0, Math.max(room, 0));
    if (files.length === 0) return;

    setUploading(true);
    try {
      const urls = await uploadImages(files);
      setNewProofs((p) => [...p, ...urls]);
    } catch (err) {
      notify('error', getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!dirty || saving || uploading) return;

    // send only what changed
    const payload = {};
    if (progressChanged) payload.progressPercentage = progress;
    if (statusChanged) payload.status = status;
    if (newProofs.length > 0) payload.resolutionProofImages = newProofs;
    if (remarks.trim()) payload.remarks = remarks.trim();

    setSaving(true);
    try {
      const { data } = await api.put(`/grievances/${ticket._id}/progress`, payload);
      onUpdated(ticket._id, data);
      setNewProofs([]);
      setRemarks('');
      notify('success', status === 'Resolved' ? 'Ticket marked as resolved' : 'Ticket updated');
    } catch (err) {
      notify('error', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-5 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
      <h4 className="text-sm font-semibold text-indigo-900">Progress control panel</h4>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Progress selector */}
        <div>
          <label htmlFor={`progress-${ticket._id}`} className="mb-2 flex items-center justify-between text-sm font-medium text-slate-700">
            <span>Progress</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200">
              {progress}%
            </span>
          </label>
          <input
            id={`progress-${ticket._id}`}
            type="range"
            min={0}
            max={100}
            step={25}
            value={progress}
            onChange={(e) => chooseProgress(Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
          <div className="mt-2 grid grid-cols-5 gap-1">
            {PROGRESS_STEPS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => chooseProgress(p)}
                aria-pressed={progress === p}
                className={`rounded-md py-1 text-xs font-semibold transition-colors ${
                  progress === p ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-indigo-100'
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        {/* Status */}
        <div>
          <label htmlFor={`status-${ticket._id}`} className="mb-2 block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            id={`status-${ticket._id}`}
            value={status}
            onChange={(e) => chooseStatus(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {ticket.status === 'Escalated' && <option value="Escalated">Escalated (by Dean)</option>}
          </select>
          <p className="mt-2 text-xs text-slate-500">Choosing 100% or Resolved keeps both in sync.</p>
        </div>
      </div>

      {/* Resolution proof */}
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">
          Resolution proof <span className="font-normal text-slate-400">(optional · up to {MAX_IMAGES} per update)</span>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addUrl();
              }
            }}
            placeholder="Paste an image link (https://…)"
            aria-label="Resolution proof image URL"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={addUrl}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-indigo-700 ring-1 ring-indigo-300 hover:bg-indigo-100"
          >
            Add link
          </button>
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100">
            {uploading ? <Spinner /> : '📷'} Upload photo
            <input type="file" accept="image/*" multiple onChange={handleFiles} disabled={uploading} className="sr-only" />
          </label>
        </div>

        {newProofs.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {newProofs.map((u) => (
              <li key={u} className="relative">
                <img
                  src={assetUrl(u)}
                  alt="New resolution proof"
                  className="h-16 w-16 rounded-lg border border-indigo-300 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setNewProofs((p) => p.filter((x) => x !== u))}
                  aria-label="Remove image"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs text-white hover:bg-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {existingProofs.length > 0 && (
          <div className="mt-3">
            <ImageStrip label="Already attached" urls={existingProofs} />
          </div>
        )}
        {missingProof && (
          <p className="mt-2 text-xs font-medium text-amber-700">
            ⚠️ No resolution proof is attached yet. Adding a photo helps students trust the resolution.
          </p>
        )}
      </div>

      {/* Remarks */}
      <div>
        <label htmlFor={`remarks-${ticket._id}`} className="mb-1 block text-sm font-medium text-slate-700">
          Official remarks / feedback
        </label>
        <textarea
          id={`remarks-${ticket._id}`}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="e.g. Plumber assigned, pipe replacement scheduled for tomorrow morning."
          className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-slate-500">
          Posted in the ticket discussion as an Official Remark, visible to students. {remarks.length}/1000
        </p>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={!dirty || saving || uploading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {saving && <Spinner />} {saving ? 'Updating…' : 'Update ticket progress'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inbox ticket card
// ---------------------------------------------------------------------------
function InboxTicket({ g, now, notify, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);

  const sla = SLA_STYLES[g.slaState] || SLA_STYLES.on_track;
  const isLong = g.description.length > DESC_PREVIEW;
  const description = full || !isLong ? g.description : `${g.description.slice(0, DESC_PREVIEW).trimEnd()}…`;
  const isCritical = g.isCriticalAlert || g.upvoteCount >= CRITICAL_THRESHOLD;

  return (
    <article className={`rounded-xl border border-l-4 border-slate-200 p-4 shadow-sm sm:p-5 ${sla.border} ${sla.bg}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className={`rounded px-2 py-1 tracking-wide ${sla.chip}`}>{sla.label}</span>
        <span className={`rounded-full px-2.5 py-1 ${g.priority === 'Immediate' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
          {g.priority === 'Immediate' ? '🔴 Immediate' : '🔵 Routine'}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${CATEGORY_STYLES[g.category] || 'bg-slate-100 text-slate-700'}`}>
          {CATEGORY_ICONS[g.category] || '📌'} {g.category}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${STATUS_STYLES[g.status] || STATUS_STYLES.Pending}`}>{g.status}</span>
        {isCritical && g.status !== 'Resolved' && (
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">🚨 Critical alert</span>
        )}
      </div>

      <h3 className="text-base font-semibold text-slate-900 sm:text-lg">{g.title}</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        {g.student?.name ? `By ${g.student.name}` : 'By Anonymous student'} • {timeAgo(g.createdAt)} • 👍 {g.upvoteCount} • 💬{' '}
        {g.commentCount ?? 0}
      </p>

      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">{description}</p>
      {isLong && (
        <button type="button" onClick={() => setFull((v) => !v)} className="mt-1 text-xs font-medium text-indigo-600 hover:underline">
          {full ? 'Show less' : 'Read more'}
        </button>
      )}

      {g.studentImages?.length > 0 && (
        <div className="mt-3">
          <ImageStrip label="Photos from student" urls={g.studentImages} />
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-end">
        <ProgressBar value={g.progressPercentage} status={g.status} />
        <SlaInfo grievance={g} now={now} />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            open ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {open ? 'Close panel' : '⚙️ Update progress'}
        </button>
      </div>

      {open && <ProgressPanel ticket={g} onUpdated={onUpdated} notify={notify} />}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Inbox({ onLogout }) {
  const user = useMemo(getStoredUser, []);
  const now = useNow(CLOCK_MS);
  const { notice, notify } = useNotice();
  const logout = useSession(onLogout);

  const [statusFilter, setStatusFilter] = useState('');
  const [windowHours, setWindowHours] = useState(12);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const resetGen = useRef(0);
  const itemsLen = useRef(0);
  useEffect(() => {
    itemsLen.current = items.length;
  }, [items]);

  /** mode: 'reset' (skeleton) | 'refresh' (silent live update) | 'more' (next page) */
  const loadInbox = useCallback(
    async (mode = 'reset') => {
      const gen = mode === 'reset' ? ++resetGen.current : resetGen.current;
      const loaded = itemsLen.current;
      let page = 1;
      let limit = PAGE_SIZE;
      if (mode === 'refresh') limit = Math.min(Math.max(loaded, PAGE_SIZE), 100);
      if (mode === 'more') page = Math.floor(loaded / PAGE_SIZE) + 1;

      if (mode === 'reset') {
        setLoading(true);
        setLoadingMore(false);
        setError('');
        setItems([]);
      }
      if (mode === 'more') setLoadingMore(true);

      try {
        const { data } = await api.get('/grievances/department-inbox', {
          params: { page, limit, expiringWithinHours: windowHours, ...(statusFilter ? { status: statusFilter } : {}) },
        });
        if (gen !== resetGen.current) return;
        setTotal(data.total);
        setItems((prev) => {
          if (mode !== 'more') return data.grievances;
          const seen = new Set(prev.map((g) => g._id));
          return [...prev, ...data.grievances.filter((g) => !seen.has(g._id))];
        });
      } catch (err) {
        if (gen !== resetGen.current) return;
        if (mode === 'reset') setError(getErrorMessage(err));
        else if (mode === 'more') notify('error', getErrorMessage(err));
      } finally {
        if (gen === resetGen.current) {
          if (mode === 'reset') setLoading(false);
          if (mode === 'more') setLoadingMore(false);
        }
      }
    },
    [statusFilter, windowHours, notify]
  );

  useEffect(() => {
    loadInbox('reset');
  }, [loadInbox]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && itemsLen.current < 100) loadInbox('refresh');
    }, POLL_MS);
    return () => clearInterval(id);
  }, [loadInbox]);

  const handleUpdated = (id, result) => {
    setItems((prev) =>
      prev.map((g) =>
        g._id === id
          ? {
              ...g,
              status: result.status,
              progressPercentage: result.progressPercentage,
              resolutionProofImages: result.resolutionProofImages,
              commentCount: result.commentCount,
              slaState: result.status === 'Resolved' ? 'closed' : g.slaState === 'closed' ? 'on_track' : g.slaState,
            }
          : g
      )
    );
    loadInbox('refresh'); // re-sort with fresh SLA data from the server
  };

  // The server already sorts overdue -> expiring -> on track -> closed; group while keeping that order.
  const groups = useMemo(() => {
    const order = ['overdue', 'expiring', 'on_track', 'closed'];
    return order
      .map((key) => ({ key, list: items.filter((g) => g.slaState === key) }))
      .filter((grp) => grp.list.length > 0);
  }, [items]);

  const sectionTitle = {
    overdue: ['🔴 Overdue — act now', 'The SLA deadline has already passed'],
    expiring: [`🟠 Expiring within ${windowHours}h`, 'Deadline is close'],
    on_track: ['🟢 On track', 'Within SLA'],
    closed: ['✅ Resolved', 'Completed tickets'],
  };

  const overdueCount = items.filter((g) => g.slaState === 'overdue').length;
  const expiringCount = items.filter((g) => g.slaState === 'expiring').length;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              🏢 {user?.department?.name ? `${user.department.name} Department` : 'Department'} Inbox
            </h1>
            <p className="text-xs text-slate-500">
              {user?.name ? `Signed in as ${user.name}` : 'Department Head'} • updates automatically
            </p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </header>

      <Toast notice={notice} />

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        {/* Summary + filters */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs font-medium text-slate-500">Total in inbox</p>
            <p className="text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className={`rounded-xl p-4 shadow-sm ring-1 ${overdueCount ? 'bg-red-50 ring-red-200' : 'bg-white ring-slate-200'}`}>
            <p className="text-xs font-medium text-slate-500">Overdue</p>
            <p className={`text-2xl font-bold ${overdueCount ? 'text-red-600' : 'text-slate-900'}`}>{overdueCount}</p>
          </div>
          <div className={`rounded-xl p-4 shadow-sm ring-1 ${expiringCount ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-slate-200'}`}>
            <p className="text-xs font-medium text-slate-500">Expiring within {windowHours}h</p>
            <p className={`text-2xl font-bold ${expiringCount ? 'text-amber-600' : 'text-slate-900'}`}>{expiringCount}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s || 'all'} value={s}>
                  {s || 'All'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Flag as expiring when due within
            <select
              value={windowHours}
              onChange={(e) => setWindowHours(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              {WINDOW_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h} hours
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* List */}
        {loading && (
          <div className="space-y-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse space-y-3 rounded-xl border border-slate-200 bg-white p-5">
                <div className="h-4 w-1/3 rounded bg-slate-200" />
                <div className="h-5 w-2/3 rounded bg-slate-200" />
                <div className="h-3 w-full rounded bg-slate-200" />
                <div className="h-2.5 w-full rounded bg-slate-200" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center text-sm text-red-700">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => loadInbox('reset')}
              className="mt-3 rounded-lg bg-red-600 px-4 py-1.5 font-medium text-white hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Your inbox is empty. 🎉
          </div>
        )}

        {!loading &&
          groups.map((grp) => (
            <section key={grp.key} aria-label={sectionTitle[grp.key][0]} className="space-y-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                  {sectionTitle[grp.key][0]} ({grp.list.length})
                </h2>
                <span className="text-xs text-slate-500">{sectionTitle[grp.key][1]}</span>
              </div>
              {grp.list.map((g) => (
                <InboxTicket key={g._id} g={g} now={now} notify={notify} onUpdated={handleUpdated} />
              ))}
            </section>
          ))}

        {!loading && items.length > 0 && items.length < total && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => loadInbox('more')}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingMore && <Spinner />} Load more ({total - items.length} remaining)
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default function DeptDashboard({ onLogout }) {
  return (
    <RoleGate allowedRoles={['authority']} label="Department Head dashboard" onLogout={onLogout}>
      <Inbox onLogout={onLogout} />
    </RoleGate>
  );
}