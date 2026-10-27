/**
 * StudentDashboard.jsx
 * Student portal for the AI-Assisted Grievance Redressal System.
 *
 * Assumes: React 17+, Vite, Tailwind CSS, axios.
 *   - API base URL: VITE_API_URL (default http://localhost:5000/api)
 *   - Login stores `token` and `user` (JSON from /api/auth/login) in localStorage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Config & constants
// ---------------------------------------------------------------------------
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const API_ORIGIN = API_BASE.replace(/\/api\/?$/, ''); // for /uploads/... image paths

const CRITICAL_THRESHOLD = 10; // upvotes needed to raise a Critical Alert
const PAGE_SIZE = 10;
const POLL_MS = 30000; // live refresh of the feed
const CLOCK_MS = 30000; // SLA countdown tick
const MAX_IMAGES = 5;
const MAX_IMAGE_MB = 5;
const DESC_PREVIEW = 220;
const OFFICIAL_REMARK_PREFIX = '[Official Remark] ';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const CATEGORIES = [
  { value: 'Mess & Dining', icon: '🍽️' },
  { value: 'Hostel', icon: '🏠' },
  { value: 'IT Infrastructure', icon: '💻' },
  { value: 'Academics', icon: '📚' },
  { value: 'Anti-Ragging & Safety', icon: '🛡️' },
];
const CATEGORY_ICONS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.icon]));
const CATEGORY_STYLES = {
  'Mess & Dining': 'bg-orange-100 text-orange-800',
  Hostel: 'bg-teal-100 text-teal-800',
  'IT Infrastructure': 'bg-sky-100 text-sky-800',
  Academics: 'bg-violet-100 text-violet-800',
  'Anti-Ragging & Safety': 'bg-rose-100 text-rose-800',
};

const TABS = [
  { key: 'Immediate', emoji: '🔴', label: 'Immediate', active: 'bg-red-600 text-white shadow', idle: 'text-red-700 hover:bg-red-50' },
  { key: 'Routine', emoji: '🔵', label: 'Routine', active: 'bg-blue-600 text-white shadow', idle: 'text-blue-700 hover:bg-blue-50' },
  { key: 'Resolved', emoji: '🟢', label: 'Resolved', active: 'bg-emerald-600 text-white shadow', idle: 'text-emerald-700 hover:bg-emerald-50' },
];

const STATUS_STYLES = {
  Pending: 'bg-slate-100 text-slate-700',
  'In Progress': 'bg-indigo-100 text-indigo-700',
  Resolved: 'bg-emerald-100 text-emerald-700',
  Escalated: 'bg-red-100 text-red-700',
};
const PROGRESS_COLORS = {
  Pending: 'bg-slate-400',
  'In Progress': 'bg-indigo-500',
  Resolved: 'bg-emerald-500',
  Escalated: 'bg-red-500',
};

// ---------------------------------------------------------------------------
// API client (JWT attached to every request)
// ---------------------------------------------------------------------------
const api = axios.create({ baseURL: API_BASE, timeout: 20000 });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user')) || null;
  } catch {
    return null;
  }
};

const getErrorMessage = (err) => {
  if (err?.response?.data?.message) return err.response.data.message;
  if (err?.request) return 'Cannot reach the server. Please check your connection and try again.';
  return err?.message || 'Something went wrong';
};

const assetUrl = (u) => (/^https?:\/\//i.test(u) ? u : `${API_ORIGIN}${u}`);

const formatDateTime = (d) =>
  d
    ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '';

const formatDuration = (ms) => {
  const totalMin = Math.max(Math.floor(ms / 60000), 0);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return m < 1 ? 'less than 1m' : `${m}m`;
};

const timeAgo = (d) => {
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/** Re-renders the component every `ms` so countdowns stay live. */
const useNow = (ms) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
};

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------
function Toggle({ checked, onChange, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
        checked ? 'bg-indigo-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function ProgressBar({ value, status }) {
  const pct = Math.min(Math.max(Number(value) || 0, 0), 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600">
        <span>Resolution progress</span>
        <span>{pct}%</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label="Resolution progress"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-all duration-700 ${PROGRESS_COLORS[status] || 'bg-indigo-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SlaInfo({ grievance, now }) {
  if (grievance.status === 'Resolved') {
    return (
      <div className="text-sm font-medium text-emerald-700">
        ✅ Resolved on {formatDateTime(grievance.resolvedAt || grievance.updatedAt)}
      </div>
    );
  }
  if (!grievance.targetCompletionDate) {
    return <div className="text-sm text-slate-500">⏳ No deadline set yet</div>;
  }

  const diff = new Date(grievance.targetCompletionDate).getTime() - now;
  let tone = 'text-slate-700';
  let text;
  if (diff < 0) {
    tone = 'font-semibold text-red-600';
    text = `⚠️ SLA overdue by ${formatDuration(-diff)}`;
  } else if (diff <= 2 * 60 * 60 * 1000) {
    tone = 'font-semibold text-amber-600';
    text = `⏰ ${formatDuration(diff)} left`;
  } else {
    text = `⏳ ${formatDuration(diff)} left`;
  }

  return (
    <div className="text-sm">
      <span className={tone}>{text}</span>
      <span className="ml-2 text-xs text-slate-500">
        Target: {formatDateTime(grievance.targetCompletionDate)}
      </span>
    </div>
  );
}

function ImageStrip({ label, urls }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-2">
        {urls.map((u) => (
          <a key={u} href={assetUrl(u)} target="_blank" rel="noopener noreferrer">
            <img
              src={assetUrl(u)}
              alt={label}
              loading="lazy"
              className="h-16 w-16 rounded-lg border border-slate-200 object-cover hover:opacity-80"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

function Spinner({ className = 'h-4 w-4' }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Comment / discussion thread (loaded lazily when a card is expanded)
// ---------------------------------------------------------------------------
function CommentThread({ grievanceId, currentUserId, onCountChange, notify }) {
  const [comments, setComments] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/grievances/${grievanceId}`);
        if (!cancelled) setComments(data.comments || []);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [grievanceId]);

  const handlePost = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const { data } = await api.post(`/grievances/${grievanceId}/comments`, { text: body });
      setComments((prev) => [...(prev || []), data.comment]);
      onCountChange(data.commentCount);
      setText('');
    } catch (err) {
      notify('error', getErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && comments === null && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Loading discussion…
        </p>
      )}
      {comments && comments.length === 0 && (
        <p className="text-sm text-slate-500">No comments yet. Start the discussion!</p>
      )}

      {comments && comments.length > 0 && (
        <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {comments.map((c) => {
            const author = c.user || {};
            const isStaff = author.role === 'authority' || author.role === 'admin';
            const isRemark = c.text.startsWith(OFFICIAL_REMARK_PREFIX);
            const body = isRemark ? c.text.slice(OFFICIAL_REMARK_PREFIX.length) : c.text;
            const isMe = currentUserId && String(author._id) === String(currentUserId);
            return (
              <li
                key={c._id}
                className={`rounded-lg border p-2.5 text-sm ${
                  isRemark ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-800">{isMe ? 'You' : author.name || 'User'}</span>
                  {isStaff && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-700">
                      {isRemark ? 'Official remark' : 'Staff'}
                    </span>
                  )}
                  <span>{timeAgo(c.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-slate-700">{body}</p>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={handlePost} className="mt-3 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder="Add a comment… (Hinglish / English)"
          aria-label="Add a comment"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={posting || !text.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {posting && <Spinner />} Post
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket card
// ---------------------------------------------------------------------------
function TicketCard({ g, now, currentUserId, onUpvote, onCommentCount, notify }) {
  const [showFull, setShowFull] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const isCritical = g.isCriticalAlert || g.upvoteCount >= CRITICAL_THRESHOLD;
  const isResolved = g.status === 'Resolved';
  const isMine = currentUserId && g.student && String(g.student._id) === String(currentUserId);
  const isLong = g.description.length > DESC_PREVIEW;
  const description =
    showFull || !isLong ? g.description : `${g.description.slice(0, DESC_PREVIEW).trimEnd()}…`;
  const remaining = Math.max(CRITICAL_THRESHOLD - g.upvoteCount, 0);

  return (
    <article
      className={`rounded-2xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5 ${
        isCritical && !isResolved ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'
      }`}
    >
      {/* Badges */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span
          title="Priority is assigned automatically by the AI"
          className={`rounded-full px-2.5 py-1 ${
            g.priority === 'Immediate' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
          }`}
        >
          {g.priority === 'Immediate' ? '🔴 Immediate' : '🔵 Routine'}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${CATEGORY_STYLES[g.category] || 'bg-slate-100 text-slate-700'}`}>
          {CATEGORY_ICONS[g.category] || '📌'} {g.category}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${STATUS_STYLES[g.status] || STATUS_STYLES.Pending}`}>
          {g.status}
        </span>
        {isMine && <span className="rounded-full bg-slate-800 px-2.5 py-1 text-white">Your complaint</span>}
        {g.isAnonymous && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">🕶️ Anonymous</span>}
      </div>

      {/* Title + meta */}
      <h3 className="text-lg font-semibold text-slate-900">{g.title}</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Posted by {g.student?.name || 'Anonymous'} • {formatDateTime(g.createdAt)} •{' '}
        {g.assignedDepartment?.name ? `Assigned to ${g.assignedDepartment.name}` : "Awaiting Dean's office triage"}
      </p>

      {/* Description */}
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">{description}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setShowFull((v) => !v)}
          className="mt-1 text-xs font-medium text-indigo-600 hover:underline"
        >
          {showFull ? 'Show less' : 'Read more'}
        </button>
      )}

      {/* Images */}
      <div className="mt-3 space-y-3">
        <ImageStrip label="Attached photos" urls={g.studentImages} />
        <ImageStrip label="Resolution proof" urls={g.resolutionProofImages} />
      </div>

      {/* Progress + SLA */}
      <div className="mt-4 space-y-2">
        <ProgressBar value={g.progressPercentage} status={g.status} />
        <SlaInfo grievance={g} now={now} />
      </div>

      {/* Critical alert */}
      {isCritical && !isResolved && (
        <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          🚨 Critical Alert — {g.upvoteCount} students face this issue. It has been flagged for urgent attention.
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onUpvote(g._id)}
            disabled={g.hasUpvoted || isResolved}
            aria-pressed={g.hasUpvoted}
            title={isResolved ? 'This complaint is already resolved' : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              g.hasUpvoted
                ? 'cursor-default border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'border-slate-300 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50'
            } disabled:opacity-70`}
          >
            <span>{g.hasUpvoted ? '✅ You face this too' : '👍 I Face This Too'}</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
              {g.upvoteCount}
            </span>
          </button>
          {!isCritical && !isResolved && (
            <span className="text-xs text-slate-500">
              {remaining} more {remaining === 1 ? 'upvote' : 'upvotes'} to raise a Critical Alert
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          💬 Discussion ({g.commentCount ?? 0}) <span aria-hidden="true">{showComments ? '▲' : '▼'}</span>
        </button>
      </div>

      {showComments && (
        <CommentThread
          grievanceId={g._id}
          currentUserId={currentUserId}
          onCountChange={(count) => onCommentCount(g._id, count)}
          notify={notify}
        />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Submission form
// ---------------------------------------------------------------------------
function SubmissionForm({ onSubmitted, notify }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [files, setFiles] = useState([]); // [{ id, file, preview }]
  const [submitting, setSubmitting] = useState(false);

  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  // free the object URLs when the form unmounts
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.preview)), []);

  const handleFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = ''; // allow picking the same file again
    if (picked.length === 0) return;

    const accepted = [];
    let problem = '';
    for (const file of picked) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        problem = `${file.name}: only JPG, PNG, WEBP or GIF images are allowed`;
      } else if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        problem = `${file.name} is larger than ${MAX_IMAGE_MB} MB`;
      } else {
        accepted.push({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
          file,
          preview: URL.createObjectURL(file),
        });
      }
    }

    const room = Math.max(MAX_IMAGES - files.length, 0);
    if (accepted.length > room) {
      accepted.slice(room).forEach((a) => URL.revokeObjectURL(a.preview));
      problem = `You can attach at most ${MAX_IMAGES} images`;
    }
    if (room > 0 && accepted.length > 0) setFiles((prev) => [...prev, ...accepted.slice(0, room)]);
    if (problem) notify('error', problem);
  };

  const removeFile = (id) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!title.trim() || !description.trim()) {
      notify('error', 'Please enter both a title and a description');
      return;
    }

    setSubmitting(true);
    try {
      // 1. upload images (if any) -> relative URLs
      let studentImages = [];
      if (files.length > 0) {
        const formData = new FormData();
        files.forEach((f) => formData.append('images', f.file));
        const { data } = await api.post('/uploads', formData, { timeout: 60000 });
        studentImages = data.urls;
      }

      // 2. create the grievance (NLP assigns priority, SLA and department)
      const payload = { title: title.trim(), description: description.trim(), isAnonymous, studentImages };
      if (category) payload.category = category;
      const { data } = await api.post('/grievances', payload);

      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setTitle('');
      setDescription('');
      setCategory('');
      setIsAnonymous(false);
      setFiles([]);
      onSubmitted(data);
    } catch (err) {
      notify('error', getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Raise a grievance</h2>
        <p className="text-xs text-slate-500">Hinglish ya English — jo comfortable ho, usme likho.</p>
      </div>

      <div>
        <label htmlFor="g-title" className="mb-1 block text-sm font-medium text-slate-700">
          Title
        </label>
        <input
          id="g-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={150}
          required
          placeholder="e.g. Hostel B washroom pipe leak ho raha hai"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-right text-xs text-slate-400">{title.length}/150</p>
      </div>

      <div>
        <label htmlFor="g-desc" className="mb-1 block text-sm font-medium text-slate-700">
          Description
        </label>
        <textarea
          id="g-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          required
          rows={5}
          placeholder="Problem detail me batao: kya hua, kahan, kab se..."
          className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="g-category" className="mb-1 block text-sm font-medium text-slate-700">
          Category
        </label>
        <select
          id="g-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">🤖 Let AI decide (recommended)</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.icon} {c.value}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">
          Photos <span className="font-normal text-slate-400">(optional, up to {MAX_IMAGES})</span>
        </span>
        <label
          htmlFor="g-images"
          className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
        >
          📷 Click to add images (JPG, PNG, WEBP, GIF · max {MAX_IMAGE_MB} MB each)
        </label>
        <input
          id="g-images"
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          multiple
          onChange={handleFiles}
          className="sr-only"
        />
        {files.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {files.map((f) => (
              <li key={f.id} className="relative">
                <img src={f.preview} alt={f.file.name} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  aria-label={`Remove ${f.file.name}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs text-white hover:bg-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg bg-slate-50 p-3">
        <label htmlFor="g-anon" className="cursor-pointer text-sm">
          <span className="block font-medium text-slate-800">Submit Anonymously</span>
          <span className="block text-xs text-slate-500">
            Your name is hidden from other students and department staff. Only the Dean&apos;s office can see it.
          </span>
        </label>
        <Toggle id="g-anon" checked={isAnonymous} onChange={setIsAnonymous} />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Spinner /> Submitting…
          </>
        ) : (
          'Submit Grievance'
        )}
      </button>
    </form>
  );
}

function SubmissionResult({ result, onClose }) {
  const priorityLabel = result.nlpPriority === 'Immediate' ? 'Immediate' : 'Routine';
  return (
    <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">✅ Your grievance has been registered</p>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="text-emerald-700 hover:text-emerald-900">
          ✕
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        <li>
          Category: <strong>{result.category}</strong>
        </li>
        <li>
          Priority: <strong>{priorityLabel}</strong>
        </li>
        <li>
          Target resolution: within <strong>{result.slaHours} hours</strong>
        </li>
        <li>
          Assigned to: <strong>{result.assignedDepartment || "Dean's office (manual triage)"}</strong>
        </li>
      </ul>
      {result.usedFallback && (
        <p className="mt-2 text-xs text-amber-700">
          The AI service was unavailable, so your complaint was queued for manual categorisation.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({ onLogout }) {
  const currentUser = useMemo(getStoredUser, []);
  const currentUserId = currentUser?.id || currentUser?._id || null;
  const now = useNow(CLOCK_MS);

  const [tab, setTab] = useState('Immediate');
  const [mineOnly, setMineOnly] = useState(false);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [tabCounts, setTabCounts] = useState({ Immediate: 0, Routine: 0, Resolved: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [lastResult, setLastResult] = useState(null);
  const [notice, setNotice] = useState(null);

  const noticeTimer = useRef(null);
  const resetGen = useRef(0);
  const itemsLen = useRef(0);
  useEffect(() => {
    itemsLen.current = items.length;
  }, [items]);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const notify = useCallback((type, text) => {
    setNotice({ type, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (onLogout) onLogout();
    else window.location.assign('/login');
  }, [onLogout]);

  // Expired / invalid token -> send the user back to login
  useEffect(() => {
    const id = api.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) handleLogout();
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, [handleLogout]);

  /**
   * mode 'reset'   : tab/filter changed -> show skeleton, replace list
   * mode 'refresh' : silent live update of what is already loaded
   * mode 'more'    : append the next page
   */
  const loadFeed = useCallback(
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
        setFeedError('');
        setItems([]);
      }
      if (mode === 'more') setLoadingMore(true);

      try {
        const { data } = await api.get('/grievances/student-feed', {
          params: { tab, page, limit, ...(mineOnly ? { mine: 'true' } : {}) },
        });
        if (gen !== resetGen.current) return; // superseded by a newer tab selection
        setTotal(data.total);
        setTabCounts(data.tabCounts);
        setItems((prev) => {
          if (mode !== 'more') return data.grievances;
          const seen = new Set(prev.map((g) => g._id));
          return [...prev, ...data.grievances.filter((g) => !seen.has(g._id))];
        });
      } catch (err) {
        if (gen !== resetGen.current) return;
        if (mode === 'reset') setFeedError(getErrorMessage(err));
        else if (mode === 'more') notify('error', getErrorMessage(err));
        // silent refresh failures are ignored; the next poll will retry
      } finally {
        if (gen === resetGen.current) {
          if (mode === 'reset') setLoading(false);
          if (mode === 'more') setLoadingMore(false);
        }
      }
    },
    [tab, mineOnly, notify]
  );

  // load on first render and whenever the tab / filter changes
  useEffect(() => {
    loadFeed('reset');
  }, [loadFeed]);

  // live updates: poll while the page is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && itemsLen.current < 100) loadFeed('refresh');
    }, POLL_MS);
    return () => clearInterval(id);
  }, [loadFeed]);

  const patchItem = useCallback((id, fn) => {
    setItems((prev) => prev.map((g) => (g._id === id ? fn(g) : g)));
  }, []);

  const handleSubmitted = (data) => {
    setLastResult(data.ai);
    notify('success', 'Grievance submitted successfully');
    // jump to the matching tab and show "my complaints" so the new ticket is visible
    const nextTab = data.grievance.priority === 'Immediate' ? 'Immediate' : 'Routine';
    if (tab === nextTab && mineOnly) loadFeed('reset');
    else {
      setTab(nextTab);
      setMineOnly(true);
    }
  };

  const handleUpvote = async (id) => {
    const original = items.find((g) => g._id === id);
    if (!original || original.hasUpvoted) return;

    // optimistic update
    patchItem(id, (g) => ({
      ...g,
      hasUpvoted: true,
      upvoteCount: g.upvoteCount + 1,
      isCriticalAlert: g.isCriticalAlert || g.upvoteCount + 1 >= CRITICAL_THRESHOLD,
    }));

    try {
      const { data } = await api.post(`/grievances/${id}/upvote`);
      patchItem(id, (g) => ({
        ...g,
        hasUpvoted: true,
        upvoteCount: data.upvoteCount,
        isCriticalAlert: data.isCriticalAlert,
      }));
      if (data.isCriticalAlert && !original.isCriticalAlert) {
        notify('success', '🚨 Critical Alert raised — this issue has been flagged for urgent attention');
      }
    } catch (err) {
      if (err.response?.status === 409) {
        // already upvoted elsewhere: keep the original count, just lock the button
        patchItem(id, () => ({ ...original, hasUpvoted: true }));
      } else {
        patchItem(id, () => original); // roll back
        notify('error', getErrorMessage(err));
      }
    }
  };

  const handleCommentCount = (id, count) => patchItem(id, (g) => ({ ...g, commentCount: count }));

  const emptyText = {
    Immediate: 'No open Immediate complaints right now. 🎉',
    Routine: 'No open Routine complaints right now.',
    Resolved: 'Nothing has been resolved yet.',
  }[tab];

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">🎓 Student Grievance Portal</h1>
            <p className="text-xs text-slate-500">
              {currentUser?.name ? `Welcome, ${currentUser.name}` : 'Welcome'} • updates automatically
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </header>

      {/* Toast */}
      {notice && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            notice.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {notice.text}
        </div>
      )}

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-5">
        {/* Left: form */}
        <aside className="space-y-4 lg:col-span-2 lg:sticky lg:top-4 lg:self-start">
          <SubmissionForm onSubmitted={handleSubmitted} notify={notify} />
          {lastResult && <SubmissionResult result={lastResult} onClose={() => setLastResult(null)} />}
        </aside>

        {/* Right: feed */}
        <section className="space-y-4 lg:col-span-3" aria-label="Grievance feed">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Filter complaints" className="inline-flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                    tab === t.key ? t.active : t.idle
                  }`}
                >
                  {t.emoji} {t.label}
                  <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-0.5 text-xs">{tabCounts[t.key] ?? 0}</span>
                </button>
              ))}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(e) => setMineOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Show only my complaints
            </label>
          </div>

          <div role="tabpanel" className="space-y-4">
            {loading && (
              <div className="space-y-4" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="animate-pulse space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="h-4 w-1/3 rounded bg-slate-200" />
                    <div className="h-5 w-2/3 rounded bg-slate-200" />
                    <div className="h-3 w-full rounded bg-slate-200" />
                    <div className="h-3 w-5/6 rounded bg-slate-200" />
                    <div className="h-2.5 w-full rounded bg-slate-200" />
                  </div>
                ))}
              </div>
            )}

            {!loading && feedError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center text-sm text-red-700">
                <p>{feedError}</p>
                <button
                  type="button"
                  onClick={() => loadFeed('reset')}
                  className="mt-3 rounded-lg bg-red-600 px-4 py-1.5 font-medium text-white hover:bg-red-700"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !feedError && items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                {mineOnly ? 'You have no complaints in this tab.' : emptyText}
              </div>
            )}

            {!loading &&
              items.map((g) => (
                <TicketCard
                  key={g._id}
                  g={g}
                  now={now}
                  currentUserId={currentUserId}
                  onUpvote={handleUpvote}
                  onCommentCount={handleCommentCount}
                  notify={notify}
                />
              ))}

            {!loading && items.length > 0 && items.length < total && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => loadFeed('more')}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {loadingMore && <Spinner />} Load more ({total - items.length} remaining)
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default export: guards against a missing login
// ---------------------------------------------------------------------------
export default function StudentDashboard({ onLogout }) {
  if (!localStorage.getItem('token')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow">
          <p className="text-slate-700">Please log in to view the Student Portal.</p>
          <button
            type="button"
            onClick={() => (onLogout ? onLogout() : window.location.assign('/login'))}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }
  return <Dashboard onLogout={onLogout} />;
}