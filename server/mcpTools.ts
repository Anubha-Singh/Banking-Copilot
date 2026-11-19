import crypto from 'node:crypto';
import type {
  McpAuditEvent,
  McpToolDefinition,
  PendingDisputeConfirmation,
  PolicyCheckResult,
} from '../src/types/banking.ts';
import {
  createDisputeRecord,
  findTransactionById,
  formatINR,
  getDisputes,
  getProfile,
  getTransactions,
  recordAuditEvent,
} from './bankingDb.ts';

export const MCP_TOOL_MANIFEST: McpToolDefinition[] = [
  {
    name: 'get_account_balance',
    permission: 'READ',
    description:
      'Read-only lookup returning customer account metadata, masked account number, and live INR available balance.',
    parametersSummary: '() — no arguments',
    guardrails: ['Read-only scope verified (zero core ledger mutation)'],
  },
  {
    name: 'get_recent_transactions',
    permission: 'READ',
    description:
      'Read-only ledger query returning recent debit/credit transactions with settlement status, UTR/AUTH references, and active dispute links.',
    parametersSummary: '(limit?: number)',
    guardrails: ['Read-only scope verified (zero core ledger mutation)'],
  },
  {
    name: 'raise_card_dispute',
    permission: 'WRITE',
    description:
      'Write tool that files a formal card chargeback dispute against a settled transaction after passing backend guardrails and explicit user confirmation.',
    parametersSummary: '(transaction_id: string, reason: string, confirmed_by_user: boolean)',
    guardrails: [
      'Settlement Status Check: rejects PENDING authorizations (ERR_PENDING_TXN)',
      'HITL Confirmation Gate: blocks write until confirmed_by_user === true (REQUIRES_CONFIRMATION)',
      'Duplicate Dispute Guard: prevents double-filing against an already disputed transaction',
    ],
  },
];

export interface McpExecutionOptions {
  source: 'GEMINI_COPILOT' | 'USER_HITL_CONFIRM' | 'DIRECT_MCP_RPC';
  /**
   * Defense-in-depth backend guardrail:
   * When invoked autonomously inside the LLM loop (allowWriteConfirmation = false),
   * the backend refuses to accept an unverified confirmed_by_user=true directly from the model
   * and enforces the HITL REQUIRES_CONFIRMATION gate so the user MUST approve via the UI action card.
   */
  allowWriteConfirmation?: boolean;
}

export interface McpExecutionResult {
  toolName: McpToolDefinition['name'];
  payload: Record<string, unknown>;
  auditEvent: McpAuditEvent;
  pendingConfirmation?: PendingDisputeConfirmation;
}

export function executeMcpTool(
  toolName: string,
  rawArgs: Record<string, unknown> = {},
  options: McpExecutionOptions = { source: 'DIRECT_MCP_RPC', allowWriteConfirmation: true }
): McpExecutionResult {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();

  if (toolName === 'get_account_balance') {
    const profile = getProfile();
    const disputes = getDisputes();
    const responsePayload: Record<string, unknown> = {
      ok: true,
      customer_name: profile.name,
      customer_id: profile.customer_id,
      account_type: profile.account_type,
      account_number_ending: profile.account_last4,
      account_masked: profile.account_masked,
      ifsc: profile.ifsc,
      linked_card: `${profile.card_tier} •••• ${profile.card_last4}`,
      currency: profile.currency,
      current_balance: profile.balance,
      formatted_balance: profile.formatted_balance,
      active_disputes_count: disputes.length,
    };

    const policyChecks: PolicyCheckResult[] = [
      {
        id: 'tool_scope',
        name: 'Tool Scope Enforcement',
        status: 'PASSED',
        detail: 'READ-ONLY scope validated; no core banking state mutated.',
      },
    ];

    const auditEvent: McpAuditEvent = {
      id: `MCP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      timestamp,
      source: options.source,
      toolName: 'get_account_balance',
      permission: 'READ',
      requestPayload: rawArgs,
      responsePayload,
      outcome: 'SUCCESS',
      durationMs: Math.max(1, Date.now() - startedAt),
      policyChecks,
    };

    recordAuditEvent(auditEvent);
    return { toolName: 'get_account_balance', payload: responsePayload, auditEvent };
  }

  if (toolName === 'get_recent_transactions') {
    const requestedLimit =
      typeof rawArgs.limit === 'number' && Number.isFinite(rawArgs.limit) && rawArgs.limit > 0
        ? Math.floor(rawArgs.limit)
        : undefined;
    const transactions = getTransactions(requestedLimit);
    const disputes = getDisputes();

    const responsePayload: Record<string, unknown> = {
      ok: true,
      count: transactions.length,
      currency: 'INR',
      transactions: transactions.map((t) => ({
        ...t,
        formatted_amount: formatINR(t.amount),
      })),
      active_disputes: disputes,
    };

    const policyChecks: PolicyCheckResult[] = [
      {
        id: 'tool_scope',
        name: 'Tool Scope Enforcement',
        status: 'PASSED',
        detail: `READ-ONLY ledger query returned ${transactions.length} record(s).`,
      },
    ];

    const auditEvent: McpAuditEvent = {
      id: `MCP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      timestamp,
      source: options.source,
      toolName: 'get_recent_transactions',
      permission: 'READ',
      requestPayload: requestedLimit ? { limit: requestedLimit } : {},
      responsePayload,
      outcome: 'SUCCESS',
      durationMs: Math.max(1, Date.now() - startedAt),
      policyChecks,
    };

    recordAuditEvent(auditEvent);
    return { toolName: 'get_recent_transactions', payload: responsePayload, auditEvent };
  }

  if (toolName === 'raise_card_dispute') {
    const transactionId = String(rawArgs.transaction_id ?? '').trim().toUpperCase();
    const reason = String(rawArgs.reason ?? '').trim() || 'Duplicate or unauthorized charge';
    const rawConfirmed = Boolean(rawArgs.confirmed_by_user);

    // Enforce backend HITL integrity: autonomous LLM turns cannot self-attest user confirmation.
    const effectiveConfirmed =
      options.allowWriteConfirmation === false ? false : rawConfirmed;

    const requestPayload = {
      transaction_id: transactionId,
      reason,
      confirmed_by_user: effectiveConfirmed,
    };

    const txn = findTransactionById(transactionId);

    if (!txn) {
      const responsePayload: Record<string, unknown> = {
        ok: false,
        code: 'ERR_TXN_NOT_FOUND',
        error: `ERR_TXN_NOT_FOUND: Transaction '${transactionId || 'UNKNOWN'}' was not found in the core ledger.`,
      };
      const auditEvent: McpAuditEvent = {
        id: `MCP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        timestamp,
        source: options.source,
        toolName: 'raise_card_dispute',
        permission: 'WRITE',
        requestPayload,
        responsePayload,
        outcome: 'BLOCKED',
        errorCode: 'ERR_TXN_NOT_FOUND',
        durationMs: Math.max(1, Date.now() - startedAt),
        policyChecks: [
          {
            id: 'tool_scope',
            name: 'Tool Scope Enforcement',
            status: 'PASSED',
            detail: 'WRITE tool intercepted by backend guardrail pipeline.',
          },
          {
            id: 'settlement_status',
            name: 'Settlement Status Check',
            status: 'BLOCKED',
            detail: `Transaction ID '${transactionId || 'UNKNOWN'}' does not exist in customer ledger.`,
          },
        ],
      };
      recordAuditEvent(auditEvent);
      return { toolName: 'raise_card_dispute', payload: responsePayload, auditEvent };
    }

    if (txn.dispute_id) {
      const responsePayload: Record<string, unknown> = {
        ok: false,
        code: 'ERR_ALREADY_DISPUTED',
        error: `ERR_ALREADY_DISPUTED: Transaction ${txn.id} already has an open dispute (${txn.dispute_id}).`,
        transaction: txn,
      };
      const auditEvent: McpAuditEvent = {
        id: `MCP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        timestamp,
        source: options.source,
        toolName: 'raise_card_dispute',
        permission: 'WRITE',
        requestPayload,
        responsePayload,
        outcome: 'BLOCKED',
        errorCode: 'ERR_ALREADY_DISPUTED',
        durationMs: Math.max(1, Date.now() - startedAt),
        policyChecks: [
          {
            id: 'tool_scope',
            name: 'Tool Scope Enforcement',
            status: 'PASSED',
            detail: 'WRITE tool intercepted by backend guardrail pipeline.',
          },
          {
            id: 'duplicate_guard',
            name: 'Duplicate Dispute Guard',
            status: 'BLOCKED',
            detail: `Blocked duplicate filing; ${txn.id} is already linked to ${txn.dispute_id}.`,
          },
        ],
      };
      recordAuditEvent(auditEvent);
      return { toolName: 'raise_card_dispute', payload: responsePayload, auditEvent };
    }

    // DOMAIN GUARDRAIL #1: Settlement Status Check (Backend Code Enforcement)
    if (txn.status === 'PENDING') {
      const errorMessage =
        'ERR_PENDING_TXN: Cannot dispute pending authorization; wait for settlement.';
      const responsePayload: Record<string, unknown> = {
        ok: false,
        code: 'ERR_PENDING_TXN',
        error: errorMessage,
        transaction: {
          id: txn.id,
          merchant: txn.merchant,
          amount: txn.amount,
          formatted_amount: formatINR(txn.amount),
          status: txn.status,
          date: txn.date,
          reference_id: txn.reference_id,
        },
      };

      const policyChecks: PolicyCheckResult[] = [
        {
          id: 'tool_scope',
          name: 'Tool Scope Enforcement',
          status: 'PASSED',
          detail: 'WRITE tool routed through mandatory compliance policy engine.',
        },
        {
          id: 'settlement_status',
          name: 'Settlement Status Check',
          status: 'BLOCKED',
          detail: `${txn.id} (${txn.merchant}, ${formatINR(txn.amount)}) has status PENDING. Rejected with ERR_PENDING_TXN.`,
        },
        {
          id: 'hitl_confirmation',
          name: 'HITL Confirmation Gate',
          status: 'SKIPPED',
          detail: 'Halted prior to user confirmation due to failed Settlement Status Check.',
        },
      ];

      const auditEvent: McpAuditEvent = {
        id: `MCP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        timestamp,
        source: options.source,
        toolName: 'raise_card_dispute',
        permission: 'WRITE',
        requestPayload,
        responsePayload,
        outcome: 'BLOCKED',
        errorCode: 'ERR_PENDING_TXN',
        durationMs: Math.max(1, Date.now() - startedAt),
        policyChecks,
      };

      recordAuditEvent(auditEvent);
      return { toolName: 'raise_card_dispute', payload: responsePayload, auditEvent };
    }

    // DOMAIN GUARDRAIL #2: HITL Confirmation Gate (Backend Code Enforcement)
    if (effectiveConfirmed === false) {
      const confirmationId = `CNF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const pendingConfirmation: PendingDisputeConfirmation = {
        confirmationId,
        transaction_id: txn.id,
        merchant: txn.merchant,
        amount: txn.amount,
        date: txn.date,
        status: txn.status,
        category: txn.category,
        reference_id: txn.reference_id,
        reason,
        state: 'PENDING_USER_ACTION',
      };

      const responsePayload: Record<string, unknown> = {
        ok: false,
        code: 'REQUIRES_CONFIRMATION',
        status: 'REQUIRES_CONFIRMATION',
        message:
          'Dispute not created yet. Explicit customer confirmation via the action card is required before executing this WRITE action.',
        transaction: {
          id: txn.id,
          merchant: txn.merchant,
          amount: txn.amount,
          formatted_amount: formatINR(txn.amount),
          status: txn.status,
          date: txn.date,
          category: txn.category,
          reference_id: txn.reference_id,
        },
        proposed_reason: reason,
        confirmation_id: confirmationId,
      };

      const policyChecks: PolicyCheckResult[] = [
        {
          id: 'tool_scope',
          name: 'Tool Scope Enforcement',
          status: 'PASSED',
          detail: 'WRITE tool routed through mandatory compliance policy engine.',
        },
        {
          id: 'settlement_status',
          name: 'Settlement Status Check',
          status: 'PASSED',
          detail: `${txn.id} verified as POSTED (${txn.reference_id}). Eligible for dispute.`,
        },
        {
          id: 'hitl_confirmation',
          name: 'HITL Confirmation Gate',
          status: 'GATED',
          detail:
            'confirmed_by_user is false. Returning REQUIRES_CONFIRMATION to render explicit approval card.',
        },
      ];

      const auditEvent: McpAuditEvent = {
        id: `MCP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        timestamp,
        source: options.source,
        toolName: 'raise_card_dispute',
        permission: 'WRITE',
        requestPayload,
        responsePayload,
        outcome: 'REQUIRES_CONFIRMATION',
        errorCode: 'REQUIRES_CONFIRMATION',
        durationMs: Math.max(1, Date.now() - startedAt),
        policyChecks,
      };

      recordAuditEvent(auditEvent);
      return {
        toolName: 'raise_card_dispute',
        payload: responsePayload,
        auditEvent,
        pendingConfirmation,
      };
    }

    // All backend guardrails passed — persist dispute in Core Banking DB
    const dispute = createDisputeRecord(txn.id, reason);
    const responsePayload: Record<string, unknown> = {
      ok: true,
      code: 'DISPUTE_CREATED',
      message: `Dispute ${dispute.dispute_id} submitted for ${txn.id} (${txn.merchant}, ${formatINR(txn.amount)}).`,
      dispute,
    };

    const policyChecks: PolicyCheckResult[] = [
      {
        id: 'tool_scope',
        name: 'Tool Scope Enforcement',
        status: 'PASSED',
        detail: 'WRITE tool authorized for Core Banking dispute submission.',
      },
      {
        id: 'settlement_status',
        name: 'Settlement Status Check',
        status: 'PASSED',
        detail: `${txn.id} confirmed POSTED (${txn.reference_id}).`,
      },
      {
        id: 'hitl_confirmation',
        name: 'HITL Confirmation Gate',
        status: 'PASSED',
        detail: 'confirmed_by_user === true verified via explicit customer approval.',
      },
    ];

    const auditEvent: McpAuditEvent = {
      id: `MCP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      timestamp,
      source: options.source,
      toolName: 'raise_card_dispute',
      permission: 'WRITE',
      requestPayload,
      responsePayload,
      outcome: 'SUCCESS',
      durationMs: Math.max(1, Date.now() - startedAt),
      policyChecks,
    };

    recordAuditEvent(auditEvent);
    return { toolName: 'raise_card_dispute', payload: responsePayload, auditEvent };
  }

  throw new Error(`Unsupported MCP tool: ${toolName}`);
}
