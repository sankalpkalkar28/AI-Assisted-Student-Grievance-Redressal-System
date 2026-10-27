/**
 * Shared client helpers used by DeptDashboard and DeanDashboard:
 * axios instance (JWT attached), formatters, constants and small hooks.
 */
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

export const CRITICAL_THRESHOLD = 10;
export const MAX_IMAGES = 5;
export const MAX_IMAGE_MB = 5;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const CATEGORY_ICONS = {
  'Mess & Dining': '🍽️',
  Hostel: '🏠',
  'IT Infrastructure': '💻',
  Academics: '📚',
  'Anti-Ragging & Safety': '🛡️',
};
export const CATEGORY_STYLES = {
  'Mess & Dining': 'bg-orange-100 text-orange-800',
  Hostel: 'bg-teal-100 text-teal-800',
  'IT Infrastructure': 'bg-sky-100 text-sky-800',
  Academics: 'bg-violet-100 text-violet-800',
  'Anti-Ragging & Safety': 'bg-rose-100 text-rose-800',
};
export const STATUS_STYLES = {
  Pending: 'bg-slate-100 text-slate-700',
  'In Progress': 'bg-indigo-100 text-indigo-700',
  Resolved: 'bg-emerald-100 text-emerald-700',
  Escalated: 'bg-red-100 text-red-700',
};
export const PROGRESS_COLORS = {
  Pending: 'bg-slate-400',
  'In Progress': 'bg-indigo-500',
  Resolved: 'bg-emerald-500',
  Escalated: 'bg-red-500',
};

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
export const api = axios.create({ baseURL: API_BASE, timeout: 20000 });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const uploadImages = async (files) => {
  const formData = new FormData();
  files.forEach((f) => formData.append('images', f));
  const { data } = await api.post('/uploads', formData, { timeout: 60000 });
  return data.urls;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user')) || null;
  } catch {
    return null;
  }
};

export const getErrorMessage = (err) => {
  if (err?.response?.data?.message) return err.response.data.message;
  if (err?.request) return 'Cannot reach the server. Please check your connection and try again.';
  return err?.message || 'Something went wrong';
};

export const assetUrl = (u) => (/^https?:\/\//i.test(u) ? u : `${API_ORIGIN}${u}`);

/** Same rule as the server: http(s) URL or a server-relative path. */
export const isSafeUrl = (u) => typeof u === 'string' && u.length <= 500 && /^(https?:\/\/|\/(?!\/))/i.test(u);

export const formatDateTime = (d) =>
  d
    ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '';

export const formatDuration = (ms) => {
  const totalMin = Math.max(Math.floor(ms / 60000), 0);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return m < 1 ? 'less than 1m' : `${m}m`;
};

/** 3.5 -> "3.5h", 0.4 -> "24m", 80 -> "3.3d", null -> "—" */
export const formatHours = (h) => {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.max(Math.round(h * 60), 1)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

export const timeAgo = (d) => {
  const min = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

/** Returns { valid, error } for a list of File objects picked by the user. */
export const filterImageFiles = (files) => {
  const valid = [];
  let error = '';
  for (const f of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(f.type)) error = `${f.name}: only JPG, PNG, WEBP or GIF images are allowed`;
    else if (f.size > MAX_IMAGE_MB * 1024 * 1024) error = `${f.name} is larger than ${MAX_IMAGE_MB} MB`;
    else valid.push(f);
  }
  return { valid, error };
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
/** Re-renders every `ms` so countdowns stay live. */
export const useNow = (ms) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
};

/** Toast state: { notice, notify(type, text) } - auto-dismisses after 5s. */
export const useNotice = () => {
  const [notice, setNotice] = useState(null);
  const timer = useRef(null);
  const notify = useCallback((type, text) => {
    setNotice({ type, text });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { notice, notify };
};

/** Returns logout(); also logs out automatically when the API answers 401. */
export const useSession = (onLogout) => {
  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (onLogout) onLogout();
    else window.location.assign('/login');
  }, [onLogout]);

  useEffect(() => {
    const id = api.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) logout();
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, [logout]);

  return logout;
};