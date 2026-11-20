import express from 'express';
import {
  formatINR,
  getAuditEvents,
  getDisputes,
  getProfile,
  getTransactions,
  resetBankingStore,
} from './bankingDb.ts';
import {
  formatGeminiError,
  runCopilotTurn,
  type CopilotHistoryItem,
} from './copilot.ts';
import { runEvalCaseById } from './evalEngine.ts';
import { executeMcpTool, MCP_TOOL_MANIFEST } from './mcpTools.ts';
import { GOLDEN_DATASET_V1_1, GOLDEN_DATASET_VERSION } from '../src/data/goldenDataset.ts';

export function createApiApp() {
  const app = express();

  // Safely support both standard Express streaming bodies and pre-parsed Vercel serverless bodies
  const jsonParser = express.json({ limit: '1mb' });
  app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      next();
      return;
    }
    if (typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        // Let route validation handle malformed body
      }
      next();
      return;
    }
    jsonParser(req, res, next);
  });

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-express',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Core Banking State Snapshot
  app.get('/api/banking/state', (_req, res) => {
    res.json({
      profile: getProfile(),
      transactions: getTransactions(),
      disputes: getDisputes(),
      auditEvents: getAuditEvents(),
      tools: MCP_TOOL_MANIFEST,
    });
  });

  // Reset Session State (restores initial Core Banking DB & clears disputes/traces)
  app.post('/api/banking/reset', (_req, res) => {
    const reset = resetBankingStore();
    res.json({
      ...reset,
      tools: MCP_TOOL_MANIFEST,
    });
  });

  // MCP Tool Manifest Discovery
  app.get('/api/mcp/tools', (_req, res) => {
    res.json({
      protocol: 'mcp-banking-v1',
      tools: MCP_TOOL_MANIFEST,
    });
  });

  // MCP Audit Events Stream
  app.get('/api/mcp/events', (_req, res) => {
    res.json({
      events: getAuditEvents(),
    });
  });

  // Direct MCP JSON-RPC Style Execution Endpoint
  app.post('/api/mcp', (req, res) => {
    try {
      const { tool, arguments: toolArgs } = (req.body ?? {}) as {
        tool?: string;
        arguments?: Record<string, unknown>;
      };

      if (!tool || typeof tool !== 'string') {
        res.status(400).json({
          ok: false,
          error: 'Missing required field "tool" in MCP request payload.',
        });
        return;
      }

      const result = executeMcpTool(tool, toolArgs ?? {}, {
        source: 'DIRECT_MCP_RPC',
        allowWriteConfirmation: true,
      });

      res.json({
        tool: result.toolName,
        result: result.payload,
        auditEvent: result.auditEvent,
        pendingConfirmation: result.pendingConfirmation,
        state: {
          profile: getProfile(),
          transactions: getTransactions(),
          disputes: getDisputes(),
          auditEvents: getAuditEvents(),
          tools: MCP_TOOL_MANIFEST,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'MCP execution failed';
      res.status(400).json({ ok: false, error: message });
    }
  });

  // Gemini Copilot Chat Turn Endpoint
  app.post('/api/copilot/chat', async (req, res) => {
    try {
      const { message, history } = (req.body ?? {}) as {
        message?: string;
        history?: CopilotHistoryItem[];
      };

      if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Message text is required.' });
        return;
      }

      const turn = await runCopilotTurn(message.trim(), Array.isArray(history) ? history : []);

      res.json({
        reply: turn.reply,
        toolEvents: turn.toolEvents,
        pendingConfirmation: turn.pendingConfirmation,
        errorBanner: turn.errorBanner,
        state: {
          profile: getProfile(),
          transactions: getTransactions(),
          disputes: getDisputes(),
          auditEvents: getAuditEvents(),
          tools: MCP_TOOL_MANIFEST,
        },
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      console.error('[copilot/chat] Error:', formatted.code, formatted.message);
      res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // Explicit HITL Dispute Confirmation Endpoint (executes WRITE tool with confirmed_by_user: true)
  app.post('/api/copilot/confirm-dispute', (req, res) => {
    try {
      const { transaction_id, reason } = (req.body ?? {}) as {
        transaction_id?: string;
        reason?: string;
      };

      if (!transaction_id || typeof transaction_id !== 'string') {
        res.status(400).json({ error: 'transaction_id is required to confirm dispute.' });
        return;
      }

      const execution = executeMcpTool(
        'raise_card_dispute',
        {
          transaction_id,
          reason: reason || 'Duplicate merchant charge confirmed by cardholder',
          confirmed_by_user: true,
        },
        {
          source: 'USER_HITL_CONFIRM',
          allowWriteConfirmation: true,
        }
      );

      const dispute = execution.payload.dispute as
        | {
            dispute_id: string;
            transaction_id: string;
            merchant: string;
            amount: number;
            provisional_credit_eta: string;
          }
        | undefined;

      const assistantReply =
        execution.auditEvent.outcome === 'SUCCESS' && dispute
          ? `Your dispute **${dispute.dispute_id}** has been formally submitted for **${dispute.merchant}** (${dispute.transaction_id}, **${formatINR(dispute.amount)}**). Provisional credit review is scheduled within **${dispute.provisional_credit_eta}**, and the transaction has been flagged in your Core Banking ledger.`
          : String(
              execution.payload.error ||
                execution.payload.message ||
                'Unable to complete the dispute submission.'
            );

      res.json({
        ok: execution.auditEvent.outcome === 'SUCCESS',
        result: execution.payload,
        auditEvent: execution.auditEvent,
        reply: assistantReply,
        state: {
          profile: getProfile(),
          transactions: getTransactions(),
          disputes: getDisputes(),
          auditEvents: getAuditEvents(),
          tools: MCP_TOOL_MANIFEST,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to confirm dispute';
      res.status(500).json({ error: message });
    }
  });

  // AI Eval & Governance Suite Endpoints (Golden Dataset v1.1)
  app.get('/api/eval/dataset', (_req, res) => {
    res.json({
      version: GOLDEN_DATASET_VERSION,
      cases: GOLDEN_DATASET_V1_1,
    });
  });

  app.post('/api/eval/run-case', async (req, res) => {
    try {
      const { caseId } = (req.body ?? {}) as { caseId?: string };
      if (!caseId || typeof caseId !== 'string') {
        res.status(400).json({ error: 'caseId is required.' });
        return;
      }
      const result = await runEvalCaseById(caseId);
      res.json({ result });
    } catch (err) {
      const formatted = formatGeminiError(err);
      console.error('[eval/run-case] Error:', formatted.code, formatted.message);
      res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // Return clean JSON 404 for unknown /api/* routes instead of falling through to HTML
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`,
    });
  });

  return app;
}
