import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Play,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type {
  DisputeRecord,
  McpAuditEvent,
  McpToolDefinition,
  PolicyCheckResult,
  Transaction,
} from '../types/banking';
import { formatINR, formatTimeShort } from '../utils/format';

export type InspectorTab = 'mcp' | 'ledger';

interface McpInspectorPanelProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  tools: McpToolDefinition[];
  auditEvents: McpAuditEvent[];
  transactions: Transaction[];
  disputes: DisputeRecord[];
  onRunDirectTool: (toolName: 'get_account_balance' | 'get_recent_transactions') => void;
  runningDirectTool: string | null;
}

type PolicyBoardStatus = 'STANDBY' | 'PASSED' | 'GATED' | 'BLOCKED';

interface PolicySummaryItem {
  id: 'settlement_status' | 'hitl_confirmation' | 'tool_scope';
  title: string;
  rule: string;
  status: PolicyBoardStatus;
  latestDetail: string;
}

function getOutcomeBadgeStyles(outcome: McpAuditEvent['outcome']) {
  if (outcome === 'SUCCESS') {
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  }
  if (outcome === 'REQUIRES_CONFIRMATION') {
    return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  }
  return 'bg-red-500/15 text-red-300 border-red-500/30';
}

function getPermissionBadgeStyles(permission: 'READ' | 'WRITE') {
  if (permission === 'READ') {
    return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
  }
  return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
}

function getPolicyStatusBadge(status: PolicyBoardStatus | PolicyCheckResult['status']) {
  switch (status) {
    case 'PASSED':
      return {
        label: 'PASSED',
        classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      };
    case 'GATED':
      return {
        label: 'GATED · HITL',
        classes: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      };
    case 'BLOCKED':
      return {
        label: 'BLOCKED',
        classes: 'bg-red-500/15 text-red-300 border-red-500/30',
      };
    case 'SKIPPED':
      return {
        label: 'SKIPPED',
        classes: 'bg-slate-700/60 text-slate-300 border-slate-600/60',
      };
    default:
      return {
        label: 'ACTIVE',
        classes: 'bg-slate-800 text-slate-300 border-slate-700',
      };
  }
}

export function McpInspectorPanel({
  activeTab,
  onTabChange,
  tools,
  auditEvents,
  transactions,
  disputes,
  onRunDirectTool,
  runningDirectTool,
}: McpInspectorPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [manifestOpen, setManifestOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const policyBoard = useMemo<PolicySummaryItem[]>(() => {
    const findLatestPolicy = (id: PolicyCheckResult['id']) => {
      for (const evt of auditEvents) {
        const found = evt.policyChecks.find((check) => check.id === id);
        if (found) return found;
      }
      return undefined;
    };

    const settlement = findLatestPolicy('settlement_status');
    const hitl = findLatestPolicy('hitl_confirmation');
    const scope = findLatestPolicy('tool_scope');

    return [
      {
        id: 'settlement_status',
        title: 'Settlement Status Check',
        rule: 'Rejects disputes on PENDING authorizations (ERR_PENDING_TXN)',
        status:
          settlement && settlement.status !== 'SKIPPED' ? settlement.status : 'STANDBY',
        latestDetail:
          settlement?.detail ??
          'Enforced in backend raise_card_dispute handler prior to any write.',
      },
      {
        id: 'hitl_confirmation',
        title: 'HITL Confirmation Gate',
        rule: 'Blocks WRITE unless confirmed_by_user === true (REQUIRES_CONFIRMATION)',
        status: hitl && hitl.status !== 'SKIPPED' ? hitl.status : 'STANDBY',
        latestDetail:
          hitl?.detail ??
          'Requires explicit cardholder approval via interactive confirmation card.',
      },
      {
        id: 'tool_scope',
        title: 'Tool Scope Enforcement',
        rule: 'Strict separation between READ-ONLY queries and WRITE mutations',
        status: scope && scope.status !== 'SKIPPED' ? scope.status : 'STANDBY',
        latestDetail:
          scope?.detail ?? '3 registered MCP tools active (2 READ, 1 WRITE).',
      },
    ];
  }, [auditEvents]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyJson = async (event: McpAuditEvent) => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            id: event.id,
            tool: event.toolName,
            permission: event.permission,
            outcome: event.outcome,
            request: event.requestPayload,
            response: event.responsePayload,
          },
          null,
          2
        )
      );
      setCopiedId(event.id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Clipboard may be unavailable in restricted contexts.
    }
  };

  return (
    <aside className="flex flex-col h-full bg-[#0E1525] text-slate-100 min-w-0">
      {/* Inspector Header + Segmented View Switcher */}
      <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-white tracking-wide truncate">
            Live MCP &amp; Guardrail Inspector
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            {auditEvents.length} tool execution{auditEvents.length === 1 ? '' : 's'} ·{' '}
            {tools.length} registered tools
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-md bg-slate-900 border border-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => onTabChange('mcp')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'mcp'
                ? 'bg-slate-700/80 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Inspector</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('ledger')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'ledger'
                ? 'bg-slate-700/80 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Core Ledger</span>
          </button>
        </div>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto custom-scroll-dark">
        {activeTab === 'mcp' ? (
          <div className="divide-y divide-slate-800/90">
            {/* Section 1: Active Banking Policy Checks */}
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-slate-300" />
                  <h3 className="font-display text-xs font-semibold text-slate-200 tracking-wide">
                    Active Banking Policy Checks
                  </h3>
                </div>
                <span className="text-[11px] text-slate-400">Backend enforced</span>
              </div>

              <div className="divide-y divide-slate-800/80 rounded-md border border-slate-800 bg-[#131C2E]">
                {policyBoard.map((policy) => {
                  const badge = getPolicyStatusBadge(policy.status);
                  return (
                    <div key={policy.id} className="px-3.5 py-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-100">
                          {policy.title}
                        </span>
                        <span
                          className={`font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-sm border whitespace-nowrap shrink-0 ${badge.classes}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-slate-400 leading-snug">
                        {policy.latestDetail}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section 2: Registered MCP Tools Manifest */}
            <div className="px-5 py-3.5">
              <button
                type="button"
                onClick={() => setManifestOpen((prev) => !prev)}
                className="w-full flex items-center justify-between gap-2 text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  {manifestOpen ? (
                    <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-200" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-200" />
                  )}
                  <span className="font-display text-xs font-semibold text-slate-200 tracking-wide">
                    Registered MCP Tool Schema ({tools.length})
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">/api/mcp</span>
              </button>

              {manifestOpen && (
                <div className="mt-3 divide-y divide-slate-800/80 rounded-md border border-slate-800 bg-[#131C2E]">
                  {tools.map((tool) => (
                    <div key={tool.name} className="px-3.5 py-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <code className="font-mono text-xs font-semibold text-slate-100 truncate">
                            {tool.name}
                          </code>
                          <span
                            className={`font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-sm border whitespace-nowrap shrink-0 ${getPermissionBadgeStyles(
                              tool.permission
                            )}`}
                          >
                            {tool.permission}
                          </span>
                        </div>

                        {tool.permission === 'READ' && (
                          <button
                            type="button"
                            disabled={runningDirectTool !== null}
                            onClick={() =>
                              onRunDirectTool(
                                tool.name as 'get_account_balance' | 'get_recent_transactions'
                              )
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                            <span>{runningDirectTool === tool.name ? 'Running' : 'Test'}</span>
                          </button>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-slate-400">
                        {tool.parametersSummary}
                      </p>
                      <p className="text-xs text-slate-300 leading-relaxed">{tool.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 3: Real-Time MCP Tool Execution Trace */}
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-xs font-semibold text-slate-200 tracking-wide">
                  Tool Execution Trace
                </h3>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  Newest first
                </span>
              </div>

              {auditEvents.length === 0 ? (
                <div className="rounded-md border border-slate-800 bg-[#131C2E] px-4 py-6 text-center space-y-2">
                  <p className="text-xs font-medium text-slate-200">
                    No MCP tool calls recorded yet
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Send a prompt in the Banking Copilot panel—such as asking about the duplicate
                    Zomato charge or disputing Uber—to inspect live function calls, JSON payloads,
                    and guardrail outcomes.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditEvents.map((evt, index) => {
                    const isExpanded = expandedIds[evt.id] ?? index === 0;
                    return (
                      <div
                        key={evt.id}
                        className="rounded-md border border-slate-800 bg-[#131C2E] overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => toggleExpand(evt.id)}
                          className="w-full px-3.5 py-3 text-left hover:bg-slate-800/40 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              )}
                              <code className="font-mono text-xs font-semibold text-white truncate">
                                {evt.toolName}
                              </code>
                              <span
                                className={`font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-sm border whitespace-nowrap shrink-0 ${getPermissionBadgeStyles(
                                  evt.permission
                                )}`}
                              >
                                {evt.permission}
                              </span>
                            </div>

                            <span
                              className={`font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-sm border whitespace-nowrap shrink-0 ${getOutcomeBadgeStyles(
                                evt.outcome
                              )}`}
                            >
                              {evt.errorCode ?? evt.outcome}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1.5 pl-5 font-mono tabular-nums">
                            <span>{evt.id}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatTimeShort(evt.timestamp)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{evt.durationMs}ms</span>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">
                              {evt.source === 'USER_HITL_CONFIRM'
                                ? 'HITL Approval'
                                : evt.source === 'DIRECT_MCP_RPC'
                                ? 'Direct RPC'
                                : 'Gemini Tool Call'}
                            </span>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-800/80 space-y-3">
                            {/* Per-invocation Policy Checks */}
                            <div className="space-y-1.5">
                              <p className="text-[11px] font-medium text-slate-400">
                                Policy Evaluation
                              </p>
                              <div className="space-y-1">
                                {evt.policyChecks.map((check) => {
                                  const badge = getPolicyStatusBadge(check.status);
                                  return (
                                    <div
                                      key={check.id}
                                      className="flex items-start justify-between gap-2 text-[11.5px] bg-slate-900/60 px-2.5 py-1.5 rounded border border-slate-800/80"
                                    >
                                      <div className="min-w-0">
                                        <span className="font-medium text-slate-200">
                                          {check.name}
                                        </span>
                                        <p className="text-slate-400 text-[11px] mt-0.5 leading-snug">
                                          {check.detail}
                                        </p>
                                      </div>
                                      <span
                                        className={`font-mono text-[10px] px-1.5 py-0.5 rounded-sm border whitespace-nowrap shrink-0 ${badge.classes}`}
                                      >
                                        {badge.label}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Request & Response JSON Payloads */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <p className="text-[11px] font-medium text-slate-400">
                                  Request Payload (JSON)
                                </p>
                                <button
                                  type="button"
                                  onClick={() => handleCopyJson(evt)}
                                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                                >
                                  {copiedId === evt.id ? (
                                    <>
                                      <Check className="w-3 h-3 text-emerald-400" />
                                      <span className="text-emerald-400">Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3" />
                                      <span>Copy JSON</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="font-mono text-[11px] leading-relaxed text-sky-200 bg-[#0A101D] border border-slate-800 rounded p-2.5 overflow-x-auto custom-scroll-dark">
                                {JSON.stringify(evt.requestPayload, null, 2)}
                              </pre>

                              <p className="text-[11px] font-medium text-slate-400 pt-1">
                                Response Payload (JSON)
                              </p>
                              <pre className="font-mono text-[11px] leading-relaxed text-slate-200 bg-[#0A101D] border border-slate-800 rounded p-2.5 overflow-x-auto max-h-56 custom-scroll-dark">
                                {JSON.stringify(evt.responsePayload, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Core Banking Database Ledger View */
          <div className="divide-y divide-slate-800/90">
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-xs font-semibold text-slate-200 tracking-wide">
                  Transaction Ledger ({transactions.length})
                </h3>
                <span className="font-mono text-[11px] text-slate-400">Session Persisted</span>
              </div>

              <div className="divide-y divide-slate-800/80 rounded-md border border-slate-800 bg-[#131C2E]">
                {transactions.map((txn) => (
                  <div key={txn.id} className="px-3.5 py-3 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white truncate">
                            {txn.merchant}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {txn.id}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {txn.category} · {txn.date}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <p
                          className={`font-mono text-xs font-semibold tabular-nums ${
                            txn.type === 'CREDIT' ? 'text-emerald-400' : 'text-slate-100'
                          }`}
                        >
                          {txn.type === 'CREDIT' ? '+' : '-'}
                          {formatINR(txn.amount)}
                        </p>
                        <p
                          className={`font-mono text-[10px] font-medium mt-0.5 ${
                            txn.status === 'PENDING' ? 'text-amber-300' : 'text-emerald-300'
                          }`}
                        >
                          {txn.status}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono text-slate-400">
                      <span>Ref: {txn.reference_id}</span>
                      {txn.dispute_id && (
                        <span className="px-1.5 py-0.5 rounded-sm bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
                          DISPUTED · {txn.dispute_id}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Active Disputes Registry */}
            <div className="px-5 py-4 space-y-3">
              <h3 className="font-display text-xs font-semibold text-slate-200 tracking-wide">
                Submitted Disputes ({disputes.length})
              </h3>

              {disputes.length === 0 ? (
                <div className="rounded-md border border-slate-800 bg-[#131C2E] px-4 py-5 text-center">
                  <p className="text-xs text-slate-400">
                    No disputes filed yet. Confirmed write actions appear here immediately.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/80 rounded-md border border-slate-800 bg-[#131C2E]">
                  {disputes.map((dsp) => (
                    <div key={dsp.dispute_id} className="px-3.5 py-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-emerald-300">
                          {dsp.dispute_id} · {dsp.transaction_id}
                        </span>
                        <span className="font-mono text-xs font-semibold text-white tabular-nums">
                          {formatINR(dsp.amount)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-200">{dsp.merchant}</p>
                      <p className="text-[11px] text-slate-400">{dsp.reason}</p>
                      <p className="font-mono text-[10.5px] text-slate-400 pt-0.5 tabular-nums">
                        Filed {formatTimeShort(dsp.created_at)} · Provisional credit ETA:{' '}
                        {dsp.provisional_credit_eta}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
