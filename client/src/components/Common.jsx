import { assetUrl, formatDateTime, formatDuration, getStoredUser, PROGRESS_COLORS } from '../utils/common';

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

export function Toast({ notice }) {
  if (!notice) return null;
  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
        notice.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
      }`}
    >
      {notice.text}
    </div>
  );
}

export function ProgressBar({ value, status }) {
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

export function ImageStrip({ label, urls }) {
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

/** SLA deadline / countdown line for a ticket. */
export function SlaInfo({ grievance, now }) {
  if (grievance.status === 'Resolved') {
    return (
      <div className="text-sm font-medium text-emerald-700">
        ✅ Resolved on {formatDateTime(grievance.resolvedAt || grievance.updatedAt)}
      </div>
    );
  }
  if (!grievance.targetCompletionDate) {
    return <div className="text-sm text-slate-500">⏳ No deadline set</div>;
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
      <span className="ml-2 text-xs text-slate-500">Target: {formatDateTime(grievance.targetCompletionDate)}</span>
    </div>
  );
}

function CenterCard({ message, cta, onClick }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow">
        <p className="text-slate-700">{message}</p>
        <button
          type="button"
          onClick={onClick}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {cta}
        </button>
      </div>
    </div>
  );
}

/**
 * Renders children only for a logged-in user with an allowed role.
 * (This is a UX guard only - the server enforces the real permissions.)
 */
export function RoleGate({ allowedRoles, label, onLogout, children }) {
  const goLogin = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (onLogout) onLogout();
    else window.location.assign('/login');
  };

  if (!localStorage.getItem('token')) {
    return <CenterCard message={`Please log in to view the ${label}.`} cta="Go to login" onClick={goLogin} />;
  }
  const user = getStoredUser();
  if (user?.role && !allowedRoles.includes(user.role)) {
    return (
      <CenterCard
        message={`The ${label} is not available for your account (${user.role}).`}
        cta="Log in with another account"
        onClick={goLogin}
      />
    );
  }
  return children;
}