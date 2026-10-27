/**
 * DeanDashboard.jsx - Executive view (admin)
 *  - Critical alerts banner for tickets with >= 10 upvotes
 *  - SLA-breached / escalated tickets across all departments (with an Escalate action)
 *  - Analytics: total complaints, average resolution time, SLA compliance, department performance
 *
 * Data comes from GET /api/grievances/dean-overview.
 * Assumes React 17+, Vite, Tailwind, axios. Login must store `token` and `user` in localStorage.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  CATEGORY_ICONS,
  CATEGORY_STYLES,
  CRITICAL_THRESHOLD,
  formatHours,
  getErrorMessage,
  getStoredUser,
  STATUS_STYLES,
  timeAgo,
  useNotice,
  useNow,
  useSession,
} from '../utils/common';
import { ProgressBar, RoleGate, SlaInfo, Spinner, Toast } from '../components/Common';

const POLL_MS = 60000;
const CLOCK_MS = 30000;
const CRITICAL_PREVIEW = 3;

const rateTone = (pct) => {
  if (pct === null || pct === undefined) return 'text-slate-400';
  if (pct >= 80) return 'text-emerald-600';
  if (pct >= 50) return 'text-amber-600';
  return 'text-red-600';
};

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function StatCard({ icon, label, value, sub, tone = 'text-slate-900', ring = 'ring-slate-200', bg = 'bg-white' }) {
  return (
    <div className={`rounded-2xl p-5 shadow-sm ring-1 ${bg} ${ring}`}>
      <p className="flex items-center gap-2 text-sm font-medium text-slate-500">
        <span aria-hidden="true">{icon}</span> {label}
      </p>
      <p className={`mt-2 text-3xl font-bold ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function MiniBar({ pct, color = 'bg-indigo-500' }) {
  const value = Math.min(Math.max(pct || 0, 0), 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-9 text-xs font-medium text-slate-600">{value}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket card used by both the critical banner and the breached list
// ---------------------------------------------------------------------------
function ExecTicket({ g, now, onEscalate, compact = false }) {
  const [formOpen, setFormOpen] = useState(false);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  const isEscalated = g.status === 'Escalated';
  const overdue = g.targetCompletionDate && new Date(g.targetCompletionDate).getTime() < now;
  const highUpvotes = g.upvoteCount >= CRITICAL_THRESHOLD;

  const confirm = async () => {
    setBusy(true);
    const ok = await onEscalate(g._id, remark);
    setBusy(false);
    if (ok) {
      setFormOpen(false);
      setRemark('');
    }
  };

  return (
    <article
      className={`rounded-xl border border-l-4 bg-white p-4 shadow-sm ${
        isEscalated ? 'border-l-red-600' : overdue ? 'border-l-orange-500' : 'border-l-red-400'
      } border-slate-200`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className={`rounded-full px-2.5 py-1 ${g.priority === 'Immediate' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
          {g.priority === 'Immediate' ? '🔴 Immediate' : '🔵 Routine'}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${CATEGORY_STYLES[g.category] || 'bg-slate-100 text-slate-700'}`}>
          {CATEGORY_ICONS[g.category] || '📌'} {g.category}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${STATUS_STYLES[g.status] || STATUS_STYLES.Pending}`}>{g.status}</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
          🏢 {g.assignedDepartment?.name || 'Unassigned'}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${highUpvotes ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
          👍 {g.upvoteCount}
        </span>
        {!highUpvotes && g.isCriticalAlert && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">🚨 Flagged critical</span>}
      </div>

      <h3 className="font-semibold text-slate-900">{g.title}</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        {g.student?.name ? `${g.student.name}${g.isAnonymous ? ' (anonymous to others)' : ''}` : 'Student'} • filed{' '}
        {timeAgo(g.createdAt)}
      </p>
      {!compact && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{g.description}</p>}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-end">
        <ProgressBar value={g.progressPercentage} status={g.status} />
        <SlaInfo grievance={g} now={now} />
      </div>

      <div className="mt-3">
        {isEscalated ? (
          <span className="text-xs font-semibold text-red-600">⬆️ Already escalated to the department</span>
        ) : !formOpen ? (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            ⬆️ Escalate
          </button>
        ) : (
          <div className="space-y-2 rounded-lg bg-red-50 p-3">
            <label htmlFor={`esc-${g._id}`} className="block text-xs font-medium text-red-800">
              Instruction for the department (optional, shown as an Official Remark)
            </label>
            <textarea
              id={`esc-${g._id}`}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="e.g. Resolve within 24 hours and report back to my office."
              className="w-full resize-y rounded-lg border border-red-200 bg-white px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busy && <Spinner />} Confirm escalation
              </button>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={busy}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Overview({ onLogout }) {
  const user = useMemo(getStoredUser, []);
  const now = useNow(CLOCK_MS);
  const { notice, notify } = useNotice();
  const logout = useSession(onLogout);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filter, setFilter] = useState('all'); // all | escalated | overdue
  const [showAllCritical, setShowAllCritical] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.get('/grievances/dean-overview');
      setData(res.data);
      setLastUpdated(Date.now());
      setError('');
    } catch (err) {
      if (!silent) setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const escalate = useCallback(
    async (id, remark) => {
      const payload = { status: 'Escalated' };
      if (remark.trim()) payload.remarks = remark.trim();
      try {
        await api.put(`/grievances/${id}/progress`, payload);
        notify('success', 'Ticket escalated to the department');
        await load(true);
        return true;
      } catch (err) {
        notify('error', getErrorMessage(err));
        return false;
      }
    },
    [load, notify]
  );

  const breached = data?.breached || [];
  const escalatedCount = breached.filter((g) => g.status === 'Escalated').length;
  const overdueCount = breached.length - escalatedCount;
  const filteredBreached = breached.filter((g) =>
    filter === 'escalated' ? g.status === 'Escalated' : filter === 'overdue' ? g.status !== 'Escalated' : true
  );

  const critical = data?.critical || [];
  const visibleCritical = showAllCritical ? critical : critical.slice(0, CRITICAL_PREVIEW);
  const summary = data?.summary;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">🏛️ Dean&apos;s Executive Dashboard</h1>
            <p className="text-xs text-slate-500">
              {user?.name ? `Signed in as ${user.name}` : 'Dean'}
              {lastUpdated ? ` • updated ${timeAgo(lastUpdated)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {refreshing ? <Spinner /> : '↻'} Refresh
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <Toast notice={notice} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => load(false)}
              className="mt-3 rounded-lg bg-red-600 px-4 py-1.5 font-medium text-white hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            {/* Critical alerts banner */}
            {critical.length > 0 ? (
              <section
                role="alert"
                aria-label="Critical alerts"
                className="rounded-2xl border border-red-300 bg-gradient-to-r from-red-50 to-orange-50 p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-red-800">
                      🚨 {summary.critical} Critical {summary.critical === 1 ? 'Alert' : 'Alerts'}
                    </h2>
                    <p className="text-sm text-red-700">
                      Tickets that reached {data.criticalThreshold ?? CRITICAL_THRESHOLD}+ upvotes (or were flagged critical) and are not resolved yet.
                    </p>
                  </div>
                  {critical.length > CRITICAL_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setShowAllCritical((v) => !v)}
                      className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-300 hover:bg-red-100"
                    >
                      {showAllCritical ? 'Show fewer' : `Show all ${critical.length}`}
                    </button>
                  )}
                </div>
                <div className="mt-4 space-y-3">
                  {visibleCritical.map((g) => (
                    <ExecTicket key={g._id} g={g} now={now} onEscalate={escalate} compact />
                  ))}
                </div>
                {summary.critical > critical.length && (
                  <p className="mt-3 text-xs text-red-700">Showing the top {critical.length} of {summary.critical} alerts.</p>
                )}
              </section>
            ) : (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800">
                ✅ No critical alerts right now. No open ticket has reached {data.criticalThreshold ?? CRITICAL_THRESHOLD} upvotes.
              </div>
            )}

            {/* Analytics cards */}
            <section aria-label="Analytics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon="📋"
                label="Total Complaints"
                value={summary.total}
                sub={`${summary.open} open • ${summary.resolved} resolved (${summary.resolutionRate}%)`}
              />
              <StatCard
                icon="⏱️"
                label="Avg. Resolution Time"
                value={formatHours(summary.avgResolutionHours)}
                sub={summary.avgResolutionHours === null ? 'No resolved tickets yet' : `Across ${summary.resolved} resolved tickets`}
              />
              <StatCard
                icon="🎯"
                label="SLA Compliance"
                value={summary.slaComplianceRate === null ? '—' : `${summary.slaComplianceRate}%`}
                tone={rateTone(summary.slaComplianceRate)}
                sub="Resolved on or before the deadline"
              />
              <StatCard
                icon="⚠️"
                label="SLA Breached"
                value={summary.overdue}
                tone={summary.overdue ? 'text-red-600' : 'text-slate-900'}
                bg={summary.overdue ? 'bg-red-50' : 'bg-white'}
                ring={summary.overdue ? 'ring-red-200' : 'ring-slate-200'}
                sub={`${summary.escalated} currently escalated`}
              />
            </section>

            {/* Department performance */}
            <section aria-label="Department performance" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Department performance</h2>
              <p className="mb-4 text-xs text-slate-500">Departments with the most overdue tickets are listed first.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 font-semibold">Department</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                      <th className="px-3 py-2 text-right font-semibold">Open</th>
                      <th className="px-3 py-2 font-semibold">Resolved</th>
                      <th className="px-3 py-2 text-right font-semibold">Overdue</th>
                      <th className="px-3 py-2 text-right font-semibold">Escalated</th>
                      <th className="px-3 py-2 text-right font-semibold">Avg. time</th>
                      <th className="py-2 pl-3 text-right font-semibold">SLA met</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.departments.map((d) => (
                      <tr key={d.departmentId || 'unassigned'} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pr-3 font-medium text-slate-900">{d.name}</td>
                        <td className="px-3 py-3 text-right">{d.total}</td>
                        <td className="px-3 py-3 text-right">{d.open}</td>
                        <td className="px-3 py-3">
                          <MiniBar pct={d.resolutionRate} color="bg-emerald-500" />
                        </td>
                        <td className={`px-3 py-3 text-right font-semibold ${d.overdue ? 'text-red-600' : 'text-slate-400'}`}>
                          {d.overdue}
                        </td>
                        <td className={`px-3 py-3 text-right font-semibold ${d.escalated ? 'text-orange-600' : 'text-slate-400'}`}>
                          {d.escalated}
                        </td>
                        <td className="px-3 py-3 text-right">{formatHours(d.avgResolutionHours)}</td>
                        <td className={`py-3 pl-3 text-right font-semibold ${rateTone(d.slaComplianceRate)}`}>
                          {d.slaComplianceRate === null ? '—' : `${d.slaComplianceRate}%`}
                        </td>
                      </tr>
                    ))}
                    {data.departments.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-500">
                          No departments found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Escalated / SLA breached */}
            <section aria-label="Escalated and SLA-breached tickets" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Escalated &amp; SLA-breached tickets</h2>
                  <p className="text-xs text-slate-500">All departments • escalated first, then the most overdue.</p>
                </div>
                <div role="tablist" aria-label="Filter breached tickets" className="inline-flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                  {[
                    ['all', `All (${breached.length})`],
                    ['escalated', `Escalated (${escalatedCount})`],
                    ['overdue', `Overdue (${overdueCount})`],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={filter === key}
                      onClick={() => setFilter(key)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                        filter === key ? 'bg-red-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredBreached.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                  {breached.length === 0 ? 'No SLA breaches or escalations. 🎉' : 'No tickets in this view.'}
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {filteredBreached.map((g) => (
                    <ExecTicket key={g._id} g={g} now={now} onEscalate={escalate} />
                  ))}
                </div>
              )}
              {data.breachedTotal > breached.length && (
                <p className="text-center text-xs text-slate-500">
                  Showing {breached.length} of {data.breachedTotal} tickets.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default function DeanDashboard({ onLogout }) {
  return (
    <RoleGate allowedRoles={['admin']} label="Dean's dashboard" onLogout={onLogout}>
      <Overview onLogout={onLogout} />
    </RoleGate>
  );
}