import { useMemo, useState } from 'react';
import {
  ArrowRight,
  FileText,
  Minus,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDuration } from '../utils/scoring';
import type { StoredReport } from '../types/echo';

interface ReportsHistoryPageProps {
  reports: StoredReport[];
  onOpenReport: (report: StoredReport) => void;
  onDeleteReport: (id: string) => void;
  onClearAll: () => void;
  onStartLive: () => void;
  onStartInterview: () => void;
}

function getDisplayScore(report: StoredReport): number {
  if (report.kind === 'live') return report.scores.overall;
  return report.evaluation?.overallRubricScore ?? report.speechScores.overall;
}

interface TrendPoint {
  id: string;
  axisLabel: string;
  dateFull: string;
  title: string;
  mode: string;
  score: number;
  wpm: number;
}

function ScoreTrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TrendPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  return (
    <div className="rounded-lg border border-white/[0.12] bg-[#0B120E] px-3.5 py-2.5 shadow-xl space-y-1 max-w-[240px]">
      <div className="text-xs font-semibold text-white truncate">{pt.title}</div>
      <div className="text-[11px] text-[#83988C]">
        {pt.mode} · {pt.dateFull}
      </div>
      <div className="flex items-center justify-between gap-4 pt-1 border-t border-white/[0.07] font-mono tabular-nums text-xs">
        <span className="text-emerald-400 font-semibold">{pt.score}/100</span>
        <span className="text-[#B8C7BF]">{pt.wpm} WPM</span>
      </div>
    </div>
  );
}

export function ReportsHistoryPage({
  reports,
  onOpenReport,
  onDeleteReport,
  onClearAll,
  onStartLive,
  onStartInterview,
}: ReportsHistoryPageProps) {
  const [filter, setFilter] = useState<'all' | 'live' | 'interview'>('all');
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      if (filter !== 'all' && r.kind !== filter) return false;
      if (!q) return true;
      if (r.kind === 'live') {
        return (
          r.context.toLowerCase().includes(q) ||
          r.topic.toLowerCase().includes(q) ||
          r.transcript.toLowerCase().includes(q)
        );
      }
      return (
        r.role.toLowerCase().includes(q) ||
        r.difficulty.toLowerCase().includes(q) ||
        r.focus.toLowerCase().includes(q)
      );
    });
  }, [reports, filter, query]);

  const lastFiveTrendData = useMemo<TrendPoint[]>(() => {
    const recent = [...reports].slice(0, 5).reverse();
    return recent.map((r, idx) => {
      const d = new Date(r.createdAt);
      const shortDate = d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      const metrics = r.kind === 'live' ? r.metrics : r.aggregateMetrics;
      return {
        id: r.id,
        axisLabel: `S${idx + 1} · ${shortDate}`,
        dateFull: d.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        title: r.kind === 'live' ? r.topic : `${r.role} Mock Interview`,
        mode: r.kind === 'live' ? `Live · ${r.context}` : 'Mock Interview',
        score: getDisplayScore(r),
        wpm: metrics.wpm,
      };
    });
  }, [reports]);

  const scoreDelta = useMemo(() => {
    if (lastFiveTrendData.length < 2) return null;
    const first = lastFiveTrendData[0].score;
    const latest = lastFiveTrendData[lastFiveTrendData.length - 1].score;
    return latest - first;
  }, [lastFiveTrendData]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/[0.08]">
        <div>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight">
            Session Reports &amp; Progress
          </h1>
          <p className="text-xs text-[#83988C] mt-1">
            Stored locally in your browser (localStorage) · Export or delete anytime
          </p>
        </div>

        {reports.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClearAll();
                    setConfirmClear(false);
                  }}
                  className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/25 cursor-pointer"
                >
                  Confirm Delete All
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs text-[#9BB0A4] hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs text-[#94A89D] hover:text-rose-300 hover:border-rose-500/30 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Local History
              </button>
            )}
          </div>
        )}
      </div>

      {/* Speaking Score Improvement Trend Line Chart (Last 5 Sessions) */}
      {lastFiveTrendData.length > 0 && (
        <section className="rounded-xl border border-white/[0.09] bg-[#0C120F] p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Speaking Score Trend (Last {lastFiveTrendData.length}{' '}
                {lastFiveTrendData.length === 1 ? 'Session' : 'Sessions'})
              </h2>
              <p className="text-xs text-[#83988C] mt-0.5">
                {lastFiveTrendData.length === 1
                  ? 'Baseline session plotted — complete additional sessions to track your improvement curve'
                  : 'Chronological speaking score progression across your most recent 5 sessions'}
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs shrink-0">
              <div className="text-right">
                <div className="text-[11px] text-[#7D9186]">Latest Score</div>
                <div className="font-mono tabular-nums text-base font-semibold text-white">
                  {lastFiveTrendData[lastFiveTrendData.length - 1].score}/100
                </div>
              </div>

              {scoreDelta !== null && (
                <div className="pl-4 border-l border-white/[0.08] text-right">
                  <div className="text-[11px] text-[#7D9186]">Change</div>
                  <div
                    className={`inline-flex items-center gap-1 font-mono tabular-nums text-sm font-semibold ${
                      scoreDelta > 0
                        ? 'text-emerald-400'
                        : scoreDelta < 0
                        ? 'text-amber-400'
                        : 'text-[#9BB0A4]'
                    }`}
                  >
                    {scoreDelta > 0 ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : scoreDelta < 0 ? (
                      <TrendingDown className="h-3.5 w-3.5" />
                    ) : (
                      <Minus className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta} pts
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={lastFiveTrendData}
                margin={{ top: 12, right: 18, left: -12, bottom: 4 }}
              >
                <CartesianGrid
                  stroke="rgba(255,255,255,0.06)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="axisLabel"
                  tick={{ fill: '#82978B', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tickLine={false}
                  dy={6}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tick={{ fill: '#82978B', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine
                  y={75}
                  stroke="rgba(16, 185, 129, 0.32)"
                  strokeDasharray="4 4"
                  label={{
                    value: 'Target 75',
                    position: 'insideTopRight',
                    fill: '#6EE7B7',
                    fontSize: 10,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                />
                <Tooltip
                  content={<ScoreTrendTooltip />}
                  cursor={{ stroke: 'rgba(16, 185, 129, 0.25)', strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#10B981"
                  strokeWidth={2.5}
                  dot={{ r: 4.5, fill: '#070B09', stroke: '#10B981', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#10B981', stroke: '#070B09', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-[#0C120F] p-1 border border-white/[0.08] w-fit">
          {(
            [
              { id: 'all', label: 'All Sessions' },
              { id: 'live', label: 'Live Coaching' },
              { id: 'interview', label: 'Mock Interviews' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-[#17241D] text-white'
                  : 'text-[#84988D] hover:text-[#DCE7E0]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#6D8176]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by topic, role, or text..."
            className="w-full rounded-lg border border-white/[0.09] bg-[#0C120F] pl-9 pr-3 py-2 text-xs text-white placeholder-[#5F7368] focus:border-emerald-500/60 focus:outline-none"
          />
        </div>
      </div>

      {/* Reports Table / Empty State */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.1] bg-[#0B110E] p-12 text-center space-y-4">
          <FileText className="h-7 w-7 text-[#5A7064] mx-auto" />
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-white">
              {reports.length === 0 ? 'No saved reports yet' : 'No matching reports'}
            </h2>
            <p className="text-xs text-[#82978B] max-w-md mx-auto">
              {reports.length === 0
                ? 'Start a live speaking session or a mock interview to generate your first scored coaching report.'
                : 'Try clearing your search filter or switching tabs.'}
            </p>
          </div>
          {reports.length === 0 && (
            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={onStartLive}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#04120B] hover:bg-emerald-400 cursor-pointer"
              >
                Start Live Coaching
              </button>
              <button
                type="button"
                onClick={onStartInterview}
                className="rounded-lg border border-white/[0.12] bg-[#101814] px-4 py-2 text-xs font-medium text-[#DDE8E1] hover:bg-[#17221C] cursor-pointer"
              >
                Start Mock Interview
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0C120F]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] bg-[#090E0B] text-[11px] font-medium text-[#7F9489]">
                  <th className="py-3 px-4">Session</th>
                  <th className="py-3 px-4">Mode</th>
                  <th className="py-3 px-4 text-right">Pace</th>
                  <th className="py-3 px-4 text-right">Fillers</th>
                  <th className="py-3 px-4 text-right">Duration</th>
                  <th className="py-3 px-4 text-right">Score</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {filtered.map((report) => {
                  const score = getDisplayScore(report);
                  const metrics =
                    report.kind === 'live' ? report.metrics : report.aggregateMetrics;
                  const title =
                    report.kind === 'live'
                      ? report.topic
                      : `${report.role} (${report.answers.length} Qs)`;
                  const subtitle =
                    report.kind === 'live'
                      ? `${report.context} · ${new Date(report.createdAt).toLocaleDateString()}`
                      : `${report.difficulty} · ${new Date(report.createdAt).toLocaleDateString()}`;

                  return (
                    <tr
                      key={report.id}
                      className="group hover:bg-white/[0.025] transition-colors"
                    >
                      <td className="py-3.5 px-4 max-w-md">
                        <button
                          type="button"
                          onClick={() => onOpenReport(report)}
                          className="text-left block w-full cursor-pointer"
                        >
                          <div className="font-medium text-[#E7F1EB] truncate group-hover:text-emerald-300 transition-colors">
                            {title}
                          </div>
                          <div className="text-xs text-[#7D9186] mt-0.5">{subtitle}</div>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#9BB0A4] whitespace-nowrap">
                        {report.kind === 'live' ? 'Live Coaching' : 'Mock Interview'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-[#DCE7E0] whitespace-nowrap">
                        {metrics.wpm} WPM
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-[#DCE7E0] whitespace-nowrap">
                        {metrics.fillerCount} ({metrics.fillerRatePerMin}/m)
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-[#9BB0A4] whitespace-nowrap">
                        {formatDuration(metrics.durationSec)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-sm font-semibold text-emerald-400 whitespace-nowrap">
                        {score}/100
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenReport(report)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer"
                          >
                            Open
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete report"
                            onClick={() => onDeleteReport(report.id)}
                            className="p-1 text-[#6C8075] hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
