import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import { GOLDEN_DATASET_V1_1, GOLDEN_DATASET_VERSION } from '../data/goldenDataset';
import type { EvalCaseResult, EvalCategory, EvalTestCase } from '../types/banking';
import { formatTimeShort } from '../utils/format';

type FilterGroup = 'ALL' | 'Happy Path' | 'Domain Nuance' | 'Adversarial' | 'Faithfulness' | 'Guards';

function getCategoryStyles(category: EvalCategory): string {
  switch (category) {
    case 'Happy Path':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'Domain Nuance':
    case 'Domain Rule':
      return 'bg-blue-50 text-blue-800 border-blue-200';
    case 'Adversarial':
      return 'bg-red-50 text-red-800 border-red-200';
    case 'Faithfulness':
      return 'bg-slate-100 text-slate-800 border-slate-300';
    case 'Hallucination Guard':
    case 'Scope Guardrail':
      return 'bg-amber-50 text-amber-800 border-amber-200';
  }
}

function matchesFilter(category: EvalCategory, filter: FilterGroup): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'Domain Nuance') {
    return category === 'Domain Nuance' || category === 'Domain Rule';
  }
  if (filter === 'Guards') {
    return category === 'Hallucination Guard' || category === 'Scope Guardrail';
  }
  return category === filter;
}

export function EvalSuiteView() {
  const [resultsByCase, setResultsByCase] = useState<Record<string, EvalCaseResult>>({});
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const [isRunningSuite, setIsRunningSuite] = useState(false);
  const [suiteProgress, setSuiteProgress] = useState<{ current: number; total: number; label: string }>({
    current: 0,
    total: GOLDEN_DATASET_V1_1.length,
    label: '',
  });
  const [filter, setFilter] = useState<FilterGroup>('ALL');
  const [inspectingCaseId, setInspectingCaseId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInspectingCaseId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const executeSingleCase = async (
    testCase: EvalTestCase
  ): Promise<{ result: EvalCaseResult | null; stopSuite?: boolean }> => {
    setRunningCaseId(testCase.id);
    setRunError(null);
    try {
      const res = await fetch('/api/eval/run-case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: testCase.id }),
      });

      const rawText = await res.text();
      let data: { result?: EvalCaseResult; error?: string; code?: string } = {};
      try {
        data = rawText ? (JSON.parse(rawText) as typeof data) : {};
      } catch {
        data = { error: `HTTP ${res.status}: Unexpected non-JSON response from server.` };
      }

      if (!res.ok) {
        const msg = data?.error || `Failed to run ${testCase.id} (HTTP ${res.status})`;
        setRunError(`${testCase.id}: ${msg}`);
        const isQuotaError = res.status === 429 || data?.code === 'RESOURCE_EXHAUSTED';
        return { result: null, stopSuite: isQuotaError };
      }

      const result = data.result ?? null;
      if (result) {
        setResultsByCase((prev) => ({ ...prev, [testCase.id]: result }));
      }
      return { result };
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Connection interrupted';
      setRunError(`Network error while executing ${testCase.id}: ${detail}`);
      return { result: null };
    } finally {
      setRunningCaseId(null);
    }
  };

  const handleRunFullSuite = async () => {
    if (isRunningSuite) {
      stopRequestedRef.current = true;
      return;
    }

    stopRequestedRef.current = false;
    setIsRunningSuite(true);
    setRunError(null);
    const total = GOLDEN_DATASET_V1_1.length;

    for (let i = 0; i < total; i++) {
      if (stopRequestedRef.current) break;
      const testCase = GOLDEN_DATASET_V1_1[i];
      setSuiteProgress({
        current: i + 1,
        total,
        label: `Case ${testCase.caseNumber}: ${testCase.title}`,
      });
      const outcome = await executeSingleCase(testCase);
      if (outcome.stopSuite) {
        break;
      }
      // Small pacing pause between sequential calls to stay well within API rate limits
      if (i < total - 1 && !stopRequestedRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }

    setIsRunningSuite(false);
    setSuiteProgress({ current: 0, total, label: '' });
  };

  const handleClearResults = () => {
    if (isRunningSuite || runningCaseId) return;
    setResultsByCase({});
    setInspectingCaseId(null);
    setRunError(null);
  };

  const completedResults = useMemo(
    () =>
      GOLDEN_DATASET_V1_1.map((c) => resultsByCase[c.id]).filter(
        (r): r is EvalCaseResult => Boolean(r)
      ),
    [resultsByCase]
  );

  const kpis = useMemo(() => {
    const count = completedResults.length;
    if (count === 0) {
      return {
        completed: 0,
        overallPassRate: null as number | null,
        passedCount: 0,
        guardrailSafetyRate: null as number | null,
        guardrailPassedCount: 0,
        unauthorizedWrites: 0,
        avgLatencyMs: null as number | null,
        avgCostINR: null as number | null,
        totalTokens: 0,
      };
    }

    const passedCount = completedResults.filter((r) => r.overallPass).length;
    const guardrailPassedCount = completedResults.filter((r) => r.guardrailPass).length;
    const unauthorizedWrites = completedResults.reduce(
      (sum, r) => sum + r.sandboxDisputesWritten,
      0
    );
    const avgLatencyMs = Math.round(
      completedResults.reduce((sum, r) => sum + r.latencyMs, 0) / count
    );
    const avgCostINR =
      completedResults.reduce((sum, r) => sum + r.tokenUsage.estimatedCostINR, 0) / count;
    const totalTokens = completedResults.reduce((sum, r) => sum + r.tokenUsage.totalTokens, 0);

    return {
      completed: count,
      overallPassRate: (passedCount / count) * 100,
      passedCount,
      guardrailSafetyRate: (guardrailPassedCount / count) * 100,
      guardrailPassedCount,
      unauthorizedWrites,
      avgLatencyMs,
      avgCostINR,
      totalTokens,
    };
  }, [completedResults]);

  const visibleCases = useMemo(
    () => GOLDEN_DATASET_V1_1.filter((c) => matchesFilter(c.category, filter)),
    [filter]
  );

  const inspectingCase = inspectingCaseId
    ? GOLDEN_DATASET_V1_1.find((c) => c.id === inspectingCaseId) ?? null
    : null;
  const inspectingResult = inspectingCaseId ? resultsByCase[inspectingCaseId] ?? null : null;

  const isGuardrailPerfect = kpis.guardrailSafetyRate === 100;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scroll bg-[#F8F9FB]">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        {/* Top Workspace Title & Dominant Action Bar */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-950">
              AI Eval &amp; Governance Suite
            </h2>
            <p className="text-sm text-slate-600">
              Golden Dataset {GOLDEN_DATASET_VERSION} · 9 banking &amp; adversarial benchmarks ·
              Layer 1 deterministic assertions + Layer 2 structured Gemini judge
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {completedResults.length > 0 && !isRunningSuite && (
              <button
                type="button"
                onClick={handleClearResults}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear Results</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleRunFullSuite}
              disabled={!isRunningSuite && runningCaseId !== null}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 ${
                isRunningSuite
                  ? 'bg-red-700 text-white hover:bg-red-800'
                  : 'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50'
              }`}
            >
              {isRunningSuite ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Eval Run</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Run Full Eval Suite (9 Cases)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Progress Bar when executing Full Suite */}
        {isRunningSuite && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 space-y-2">
            <div className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2 text-slate-800 font-medium min-w-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700 shrink-0" />
                <span className="truncate">
                  Evaluating {suiteProgress.label} ({suiteProgress.current} of{' '}
                  {suiteProgress.total})
                </span>
              </div>
              <span className="font-mono text-slate-600 tabular-nums shrink-0">
                {Math.round(((suiteProgress.current - 1) / suiteProgress.total) * 100)}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-blue-700 transition-all duration-300"
                style={{
                  width: `${Math.max(
                    6,
                    Math.round((suiteProgress.current / suiteProgress.total) * 100)
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {runError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 flex items-center justify-between gap-3">
            <span>{runError}</span>
            <button
              type="button"
              onClick={() => setRunError(null)}
              className="text-red-700 hover:text-red-900 cursor-pointer"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 4 Top Executive KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* KPI 1: Overall Pass Rate */}
          <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs font-medium text-slate-500">Overall Pass Rate</p>
            <p className="font-mono text-2xl font-semibold text-slate-950 tabular-nums mt-1.5">
              {kpis.overallPassRate !== null ? `${kpis.overallPassRate.toFixed(1)}%` : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              {kpis.completed > 0
                ? `${kpis.passedCount} of ${kpis.completed} cases passed all layers`
                : 'Run suite to compute benchmark score'}
            </p>
          </div>

          {/* KPI 2: Guardrail Safety Rate (Highlight 100% in Emerald Green) */}
          <div
            className={`rounded-lg border px-5 py-4 ${
              isGuardrailPerfect
                ? 'border-emerald-300 bg-emerald-50/70'
                : kpis.guardrailSafetyRate !== null && kpis.guardrailSafetyRate < 100
                ? 'border-red-300 bg-red-50/60'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p
                className={`text-xs font-medium ${
                  isGuardrailPerfect ? 'text-emerald-900' : 'text-slate-500'
                }`}
              >
                Guardrail Safety Rate
              </p>
              {isGuardrailPerfect && (
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              )}
            </div>
            <p
              className={`font-mono text-2xl font-semibold tabular-nums mt-1.5 ${
                isGuardrailPerfect
                  ? 'text-emerald-700'
                  : kpis.guardrailSafetyRate !== null
                  ? 'text-red-700'
                  : 'text-slate-950'
              }`}
            >
              {kpis.guardrailSafetyRate !== null
                ? `${kpis.guardrailSafetyRate.toFixed(1)}%`
                : '—'}
            </p>
            <p
              className={`text-xs mt-1 tabular-nums ${
                isGuardrailPerfect ? 'text-emerald-800' : 'text-slate-500'
              }`}
            >
              {kpis.completed > 0
                ? `${kpis.guardrailPassedCount}/${kpis.completed} safe · ${kpis.unauthorizedWrites} unauthorized writes`
                : 'Target: 100% zero unauthorized writes'}
            </p>
          </div>

          {/* KPI 3: Avg Latency */}
          <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs font-medium text-slate-500">Avg Latency</p>
            <p className="font-mono text-2xl font-semibold text-slate-950 tabular-nums mt-1.5">
              {kpis.avgLatencyMs !== null
                ? `${kpis.avgLatencyMs.toLocaleString('en-IN')} ms`
                : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {kpis.completed > 0
                ? 'End-to-end agent tool loop + judge call'
                : 'Measured per isolated case execution'}
            </p>
          </div>

          {/* KPI 4: Avg Cost per Run (₹) */}
          <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs font-medium text-slate-500">Avg Cost per Run</p>
            <p className="font-mono text-2xl font-semibold text-slate-950 tabular-nums mt-1.5">
              {kpis.avgCostINR !== null ? `₹${kpis.avgCostINR.toFixed(4)}` : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              {kpis.completed > 0
                ? `${kpis.totalTokens.toLocaleString('en-IN')} total tokens across ${kpis.completed} run${
                    kpis.completed === 1 ? '' : 's'
                  }`
                : 'Estimated in INR from live token usage'}
            </p>
          </div>
        </div>

        {/* Category Filter Tabs + Table Summary */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {(
              [
                ['ALL', 'All (9)'],
                ['Happy Path', 'Happy Path'],
                ['Domain Nuance', 'Domain Nuance'],
                ['Adversarial', 'Adversarial'],
                ['Faithfulness', 'Faithfulness'],
                ['Guards', 'Safety Guards'],
              ] as Array<[FilterGroup, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === key
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="text-xs text-slate-500 font-mono tabular-nums">
            Showing {visibleCases.length} of {GOLDEN_DATASET_V1_1.length} benchmark cases ·
            Sandboxed Ledger (TXN-101–TXN-106)
          </span>
        </div>

        {/* Interactive Results Table */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90 text-[11.5px] font-semibold text-slate-600">
                  <th className="py-3 px-4 w-[28%]">Test Case &amp; Prompt</th>
                  <th className="py-3 px-3 w-[12%]">Category</th>
                  <th className="py-3 px-3 w-[18%]">Layer 1: Deterministic</th>
                  <th className="py-3 px-3 w-[24%]">Layer 2: LLM Judge</th>
                  <th className="py-3 px-3 w-[10%] text-right">Latency / Cost</th>
                  <th className="py-3 px-4 w-[8%] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {visibleCases.map((testCase) => {
                  const result = resultsByCase[testCase.id];
                  const isRunningThis = runningCaseId === testCase.id;

                  return (
                    <tr
                      key={testCase.id}
                      className="hover:bg-slate-50/70 transition-colors align-top"
                    >
                      {/* Test Case & Prompt */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-slate-500 tabular-nums">
                            #{testCase.caseNumber}
                          </span>
                          <span className="font-display font-semibold text-slate-950 text-[13px]">
                            {testCase.title}
                          </span>
                        </div>
                        <p className="text-slate-600 mt-1 leading-relaxed">
                          &ldquo;{testCase.prompt}&rdquo;
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1.5 font-mono">
                          Expected: {testCase.expectedTools.join(', ')} · {testCase.guardrailRule}
                        </p>
                      </td>

                      {/* Category Badge */}
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-block font-mono text-[10.5px] font-medium px-2 py-0.5 rounded-sm border whitespace-nowrap ${getCategoryStyles(
                            testCase.category
                          )}`}
                        >
                          {testCase.category}
                        </span>
                      </td>

                      {/* Layer 1: Deterministic Tool + Guardrail */}
                      <td className="py-3.5 px-3">
                        {isRunningThis ? (
                          <div className="inline-flex items-center gap-1.5 text-blue-700 font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Executing...</span>
                          </div>
                        ) : result ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border whitespace-nowrap ${
                                  result.toolPass
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-red-50 text-red-800 border-red-200'
                                }`}
                              >
                                TOOLS: {result.toolPass ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border whitespace-nowrap ${
                                  result.guardrailPass
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-red-50 text-red-800 border-red-200'
                                }`}
                              >
                                GUARD: {result.guardrailPass ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Not run yet</span>
                        )}
                      </td>

                      {/* Layer 2: LLM Judge Verdict + 1-sentence reasoning */}
                      <td className="py-3.5 px-3">
                        {isRunningThis ? (
                          <span className="text-slate-500">Awaiting structured judge...</span>
                        ) : result ? (
                          <div className="space-y-1">
                            <div className="inline-flex items-center gap-1.5">
                              {result.judge.verdict === 'PASS' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-700 shrink-0" />
                              )}
                              <span
                                className={`font-mono text-[10.5px] font-semibold px-1.5 py-0.5 rounded-sm border ${
                                  result.judge.verdict === 'PASS'
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-red-50 text-red-800 border-red-200'
                                }`}
                              >
                                {result.judge.verdict}
                              </span>
                            </div>
                            <p className="text-[11.5px] text-slate-700 leading-snug">
                              {result.judge.reasoning}
                            </p>
                          </div>
                        ) : (
                          <p className="text-[11.5px] text-slate-500 leading-snug">
                            {testCase.groundTruthFacts}
                          </p>
                        )}
                      </td>

                      {/* Latency & Cost */}
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                        {result ? (
                          <div className="space-y-0.5">
                            <p className="text-slate-900 font-medium">
                              {result.latencyMs.toLocaleString('en-IN')} ms
                            </p>
                            <p className="text-[11px] text-slate-500">
                              ₹{result.tokenUsage.estimatedCostINR.toFixed(4)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex flex-col items-end gap-1.5">
                          <button
                            type="button"
                            disabled={isRunningSuite || runningCaseId !== null}
                            onClick={() => executeSingleCase(testCase)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {isRunningThis ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            <span>{result ? 'Re-run' : 'Run'}</span>
                          </button>

                          {result && (
                            <button
                              type="button"
                              onClick={() => setInspectingCaseId(testCase.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Inspect Trace</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Expandable "Inspect Full Trace" Slide-Over Drawer */}
      {inspectingCase && inspectingResult && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close trace drawer backdrop"
            onClick={() => setInspectingCaseId(null)}
            className="fixed inset-0 bg-slate-950/50 cursor-default"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Full trace for ${inspectingCase.title}`}
            className="relative z-10 w-full max-w-2xl h-full bg-[#0E1525] text-slate-100 border-l border-slate-800 flex flex-col shadow-2xl"
          >
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                  <span>{inspectingCase.id}</span>
                  <span aria-hidden="true">·</span>
                  <span>{inspectingCase.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{formatTimeShort(inspectingResult.ranAt)}</span>
                </div>
                <h3 className="font-display text-base font-semibold text-white mt-1">
                  {inspectingCase.title}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setInspectingCaseId(null)}
                aria-label="Close drawer"
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto custom-scroll-dark px-6 py-5 space-y-5 text-xs">
              {/* Summary Strip */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border border-slate-800 bg-[#131C2E] px-3.5 py-2.5">
                  <p className="text-slate-400 text-[11px]">Overall Verdict</p>
                  <p
                    className={`font-mono text-sm font-semibold mt-0.5 ${
                      inspectingResult.overallPass ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {inspectingResult.overallPass ? 'PASS' : 'FAIL'}
                  </p>
                </div>
                <div className="rounded-md border border-slate-800 bg-[#131C2E] px-3.5 py-2.5">
                  <p className="text-slate-400 text-[11px]">Latency (Agent / Judge)</p>
                  <p className="font-mono text-sm font-semibold text-white tabular-nums mt-0.5">
                    {inspectingResult.agentLatencyMs}ms / {inspectingResult.judgeLatencyMs}ms
                  </p>
                </div>
                <div className="rounded-md border border-slate-800 bg-[#131C2E] px-3.5 py-2.5">
                  <p className="text-slate-400 text-[11px]">Tokens &amp; Est. Cost</p>
                  <p className="font-mono text-sm font-semibold text-white tabular-nums mt-0.5">
                    {inspectingResult.tokenUsage.totalTokens.toLocaleString('en-IN')} · ₹
                    {inspectingResult.tokenUsage.estimatedCostINR.toFixed(4)}
                  </p>
                </div>
              </div>

              {/* Prompt & Ground Truth */}
              <div className="rounded-md border border-slate-800 bg-[#131C2E] p-4 space-y-3">
                <div>
                  <p className="text-[11px] font-medium text-slate-400">User Prompt</p>
                  <p className="text-slate-100 mt-1 leading-relaxed">{inspectingCase.prompt}</p>
                </div>
                <div className="pt-3 border-t border-slate-800">
                  <p className="text-[11px] font-medium text-slate-400">
                    Ground Truth Checkpoints
                  </p>
                  <p className="text-slate-300 mt-1 leading-relaxed">
                    {inspectingCase.groundTruthFacts}
                  </p>
                </div>
              </div>

              {/* Agent Final Response */}
              <div className="rounded-md border border-slate-800 bg-[#131C2E] p-4 space-y-2">
                <p className="text-[11px] font-medium text-slate-400">Model Final Response</p>
                <div className="text-slate-100 leading-relaxed whitespace-pre-wrap text-[13px]">
                  {inspectingResult.agentResponse}
                </div>
              </div>

              {/* Layer 1 & Layer 2 Evaluation Breakdown */}
              <div className="rounded-md border border-slate-800 bg-[#131C2E] divide-y divide-slate-800">
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">
                      Layer 1: Deterministic Assertions
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      Sandbox Disputes Written: {inspectingResult.sandboxDisputesWritten}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-[11.5px]">
                    <p
                      className={
                        inspectingResult.toolPass ? 'text-emerald-300' : 'text-red-300'
                      }
                    >
                      <span className="font-mono font-semibold">
                        [{inspectingResult.toolPass ? 'PASS' : 'FAIL'}]
                      </span>{' '}
                      {inspectingResult.toolDetail}
                    </p>
                    <p
                      className={
                        inspectingResult.guardrailPass ? 'text-emerald-300' : 'text-red-300'
                      }
                    >
                      <span className="font-mono font-semibold">
                        [{inspectingResult.guardrailPass ? 'PASS' : 'FAIL'}]
                      </span>{' '}
                      {inspectingResult.guardrailDetail}
                    </p>
                  </div>
                </div>

                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">
                      Layer 2: Structured LLM Judge JSON
                    </span>
                    <span
                      className={`font-mono text-[10.5px] font-semibold px-1.5 py-0.5 rounded-sm border ${
                        inspectingResult.judge.verdict === 'PASS'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-red-500/15 text-red-300 border-red-500/30'
                      }`}
                    >
                      {inspectingResult.judge.verdict}
                    </span>
                  </div>
                  <pre className="font-mono text-[11px] leading-relaxed text-slate-200 bg-[#0A101D] border border-slate-800 rounded p-3 overflow-x-auto">
                    {JSON.stringify(inspectingResult.judge, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Raw MCP Tool Calls */}
              <div className="space-y-2.5">
                <p className="font-semibold text-slate-200">
                  Raw MCP Tool Calls ({inspectingResult.toolTraces.length})
                </p>

                {inspectingResult.toolTraces.length === 0 ? (
                  <div className="rounded-md border border-slate-800 bg-[#131C2E] p-4 text-slate-400">
                    No MCP tool calls were executed during this case.
                  </div>
                ) : (
                  inspectingResult.toolTraces.map((trace) => (
                    <div
                      key={trace.id}
                      className="rounded-md border border-slate-800 bg-[#131C2E] p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <code className="font-mono font-semibold text-white">
                            {trace.toolName}
                          </code>
                          <span
                            className={`font-mono text-[10px] px-1.5 py-0.5 rounded-sm border ${
                              trace.permission === 'READ'
                                ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            }`}
                          >
                            {trace.permission}
                          </span>
                        </div>
                        <span className="font-mono text-[10.5px] text-slate-300">
                          {trace.errorCode ?? trace.outcome} · {trace.durationMs}ms
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-[11px] text-slate-400">Request Payload</p>
                        <pre className="font-mono text-[11px] text-sky-200 bg-[#0A101D] border border-slate-800 rounded p-2.5 overflow-x-auto">
                          {JSON.stringify(trace.requestPayload, null, 2)}
                        </pre>

                        <p className="text-[11px] text-slate-400 pt-1">Response Payload</p>
                        <pre className="font-mono text-[11px] text-slate-200 bg-[#0A101D] border border-slate-800 rounded p-2.5 overflow-x-auto max-h-52 custom-scroll-dark">
                          {JSON.stringify(trace.responsePayload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
