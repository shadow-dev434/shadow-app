'use client';

// Dashboard admin della beta (Task 23 Fase 2): triage segnalazioni,
// pulse giornaliero aggregato, questionari, engagement. Volutamente
// essenziale: è lo strumento del rituale di triage mattutino (spec §A5).

import { useCallback, useEffect, useState } from 'react';
import { Bug, Loader2, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const STATUSES = ['new', 'triaged', 'in_progress', 'fixed', 'wont_fix', 'duplicate'] as const;
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

const STATUS_LABELS: Record<string, string> = {
  new: 'Nuova',
  triaged: 'Triagata',
  in_progress: 'In lavorazione',
  fixed: 'Risolta',
  wont_fix: 'Non si fa',
  duplicate: 'Duplicato',
};

const SEVERITY_LABELS: Record<string, string> = {
  blocking: '🛑 Bloccante',
  annoying: '😤 Fastidioso',
  cosmetic: '🎨 Estetico',
};

interface AdminReport {
  id: string;
  area: string;
  description: string;
  expected: string | null;
  severityUser: string;
  reproducibility: string;
  context: string;
  appVersion: string | null;
  status: string;
  priority: string | null;
  adminNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  user: { email: string; name: string | null };
}

interface PulseDay {
  day: string;
  count: number;
  avgUseful: number | null;
  avgFocus: number | null;
  avgControl: number | null;
  avgProcrastination: number | null;
}

interface Summary {
  reports: Record<string, number>;
  engagement: { totalUsers: number; active1d: number; active7d: number };
  pulse: { days: PulseDay[]; texts: { day: string; friction?: string; suggestion?: string }[] };
  assessments: {
    id: string;
    userEmail: string;
    instrument: string;
    wave: string;
    totalScore: number;
    completedAt: string | null;
    administeredAt: string;
  }[];
}

export function AdminBetaView() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [repRes, sumRes] = await Promise.all([
        fetch('/api/admin/beta/bug-reports'),
        fetch('/api/admin/beta/summary'),
      ]);
      if (!repRes.ok || !sumRes.ok) throw new Error('fetch failed');
      const repData = await repRes.json();
      const sumData = await sumRes.json();
      setReports(repData.reports ?? []);
      setSummary(sumData);
    } catch {
      setLoadError('Caricamento fallito. Le tabelle beta esistono? (migration)');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchReport = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      const res = await fetch('/api/admin/beta/bug-reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (res.ok) {
        const { report } = await res.json();
        setReports((prev) => prev.map((r) => (r.id === id ? { ...r, ...report } : r)));
      }
    },
    []
  );

  const visibleReports =
    statusFilter === 'all' ? reports : reports.filter((r) => r.status === statusFilter);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center gap-3">
          <Bug size={20} className="text-amber-500" />
          <h1 className="text-lg font-semibold flex-1">Shadow Beta — Admin</h1>
          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Ricarica"
          >
            <RefreshCw size={16} />
          </button>
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-12 justify-center">
            <Loader2 size={16} className="animate-spin" /> Caricamento…
          </div>
        )}
        {loadError && <p className="text-sm text-red-400">{loadError}</p>}

        {!loading && summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label="Tester totali" value={summary.engagement.totalUsers} />
            <Stat label="Attivi oggi" value={summary.engagement.active1d} />
            <Stat label="Attivi 7gg" value={summary.engagement.active7d} />
            <Stat
              label="Segnalazioni aperte"
              value={(summary.reports.new ?? 0) + (summary.reports.in_progress ?? 0) + (summary.reports.triaged ?? 0)}
            />
          </div>
        )}

        {!loading && (
          <Tabs defaultValue="reports">
            <TabsList>
              <TabsTrigger value="reports">Segnalazioni</TabsTrigger>
              <TabsTrigger value="pulse">Pulse</TabsTrigger>
              <TabsTrigger value="assessments">Questionari</TabsTrigger>
            </TabsList>

            <TabsContent value="reports" className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-zinc-400">Filtro:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-sm"
                >
                  <option value="all">Tutte ({reports.length})</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]} ({reports.filter((r) => r.status === s).length})
                    </option>
                  ))}
                </select>
              </div>

              {visibleReports.length === 0 && (
                <p className="text-sm text-zinc-500 py-6 text-center">Nessuna segnalazione.</p>
              )}

              {visibleReports.map((r) => (
                <ReportCard key={r.id} report={r} onPatch={patchReport} />
              ))}
            </TabsContent>

            <TabsContent value="pulse" className="space-y-4">
              {summary && summary.pulse.days.length === 0 && (
                <p className="text-sm text-zinc-500 py-6 text-center">Nessun pulse ancora.</p>
              )}
              {summary && summary.pulse.days.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-zinc-400 text-left border-b border-zinc-800">
                        <th className="py-2 pr-3">Giorno</th>
                        <th className="py-2 pr-3">N</th>
                        <th className="py-2 pr-3">Utilità</th>
                        <th className="py-2 pr-3">Focus</th>
                        <th className="py-2 pr-3">Controllo</th>
                        <th className="py-2 pr-3">Procrastinazione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.pulse.days.map((d) => (
                        <tr key={d.day} className="border-b border-zinc-900">
                          <td className="py-1.5 pr-3">{d.day}</td>
                          <td className="py-1.5 pr-3">{d.count}</td>
                          <td className="py-1.5 pr-3">{d.avgUseful ?? '—'}</td>
                          <td className="py-1.5 pr-3">{d.avgFocus ?? '—'}</td>
                          <td className="py-1.5 pr-3">{d.avgControl ?? '—'}</td>
                          <td className="py-1.5 pr-3">{d.avgProcrastination ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {summary && summary.pulse.texts.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-zinc-300">Frizioni e suggerimenti</h3>
                  {summary.pulse.texts.map((t, i) => (
                    <div key={i} className="text-sm bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                      <span className="text-zinc-500 mr-2">{t.day}</span>
                      {t.friction && <span className="text-amber-300">😕 {t.friction}</span>}
                      {t.friction && t.suggestion && <span className="mx-1">·</span>}
                      {t.suggestion && <span className="text-emerald-300">💡 {t.suggestion}</span>}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="assessments">
              {summary && summary.assessments.length === 0 && (
                <p className="text-sm text-zinc-500 py-6 text-center">Nessun questionario ancora.</p>
              )}
              {summary && summary.assessments.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-zinc-400 text-left border-b border-zinc-800">
                        <th className="py-2 pr-3">Utente</th>
                        <th className="py-2 pr-3">Strumento</th>
                        <th className="py-2 pr-3">Wave</th>
                        <th className="py-2 pr-3">Punteggio</th>
                        <th className="py-2 pr-3">Completato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.assessments.map((a) => (
                        <tr key={a.id} className="border-b border-zinc-900">
                          <td className="py-1.5 pr-3">{a.userEmail}</td>
                          <td className="py-1.5 pr-3 uppercase">{a.instrument}</td>
                          <td className="py-1.5 pr-3">{a.wave}</td>
                          <td className="py-1.5 pr-3">{a.totalScore}</td>
                          <td className="py-1.5 pr-3">
                            {a.completedAt ? new Date(a.completedAt).toLocaleDateString('it-IT') : 'bozza'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function ReportCard({
  report,
  onPatch,
}: {
  report: AdminReport;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [notes, setNotes] = useState(report.adminNotes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);

  let contextPretty = report.context;
  try {
    contextPretty = JSON.stringify(JSON.parse(report.context), null, 2);
  } catch {
    // contesto non-JSON: si mostra raw
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span>{new Date(report.createdAt).toLocaleString('it-IT')}</span>
        <span className="px-1.5 py-0.5 bg-zinc-800 rounded">{report.area}</span>
        <span>{SEVERITY_LABELS[report.severityUser] ?? report.severityUser}</span>
        <span className="flex-1" />
        <span>{report.user.email}</span>
        {report.appVersion && <span>v{report.appVersion}</span>}
      </div>

      <p className="text-sm text-zinc-100">{report.description}</p>
      {report.expected && (
        <p className="text-sm text-zinc-400">Atteso: {report.expected}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={report.status}
          onChange={(e) => void onPatch(report.id, { status: e.target.value })}
          className="bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={report.priority ?? ''}
          onChange={(e) => void onPatch(report.id, { priority: e.target.value || null })}
          className="bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-sm"
        >
          <option value="">— priorità</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-500">
          Riproducibilità: {report.reproducibility}
        </span>
      </div>

      <details className="text-xs text-zinc-400">
        <summary className="cursor-pointer hover:text-zinc-200">Contesto tecnico</summary>
        <pre className="mt-2 bg-zinc-950 border border-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {contextPretty}
        </pre>
      </details>

      <div className="flex gap-2 items-start">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Nota interna…"
          rows={1}
          className="flex-1 resize-none bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <button
          type="button"
          disabled={savingNotes || notes === (report.adminNotes ?? '')}
          onClick={async () => {
            setSavingNotes(true);
            await onPatch(report.id, { adminNotes: notes || null });
            setSavingNotes(false);
          }}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 rounded-md text-sm transition-colors"
        >
          {savingNotes ? <Loader2 size={14} className="animate-spin" /> : 'Salva'}
        </button>
      </div>
    </div>
  );
}
