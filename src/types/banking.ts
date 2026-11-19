export type TransactionStatus = 'POSTED' | 'PENDING';
export type TransactionType = 'DEBIT' | 'CREDIT';
export type ToolPermission = 'READ' | 'WRITE';

export interface CustomerProfile {
  customer_id: string;
  name: string;
  account_type: string;
  account_last4: string;
  account_masked: string;
  ifsc: string;
  card_last4: string;
  card_tier: string;
  currency: 'INR';
  balance: number;
  formatted_balance: string;
}

export interface Transaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  category: string;
  reference_id: string;
  notes?: string;
  dispute_id?: string;
  dispute_status?: 'SUBMITTED';
}

export interface DisputeRecord {
  dispute_id: string;
  transaction_id: string;
  merchant: string;
  amount: number;
  reference_id: string;
  reason: string;
  status: 'SUBMITTED';
  created_at: string;
  provisional_credit_eta: string;
}

export interface PolicyCheckResult {
  id: 'settlement_status' | 'hitl_confirmation' | 'tool_scope' | 'duplicate_guard';
  name: string;
  status: 'PASSED' | 'BLOCKED' | 'GATED' | 'SKIPPED';
  detail: string;
}

export interface McpToolDefinition {
  name: 'get_account_balance' | 'get_recent_transactions' | 'raise_card_dispute';
  permission: ToolPermission;
  description: string;
  parametersSummary: string;
  guardrails: string[];
}

export interface McpAuditEvent {
  id: string;
  timestamp: string;
  source: 'GEMINI_COPILOT' | 'USER_HITL_CONFIRM' | 'DIRECT_MCP_RPC';
  toolName: 'get_account_balance' | 'get_recent_transactions' | 'raise_card_dispute';
  permission: ToolPermission;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  outcome: 'SUCCESS' | 'BLOCKED' | 'REQUIRES_CONFIRMATION';
  errorCode?: string;
  durationMs: number;
  policyChecks: PolicyCheckResult[];
}

export interface PendingDisputeConfirmation {
  confirmationId: string;
  transaction_id: string;
  merchant: string;
  amount: number;
  date: string;
  status: TransactionStatus;
  category: string;
  reference_id: string;
  reason: string;
  state: 'PENDING_USER_ACTION' | 'CONFIRMED' | 'CANCELLED';
  dispute_id?: string;
  confirmed_at?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolNamesUsed?: string[];
  pendingConfirmation?: PendingDisputeConfirmation;
  errorBanner?: {
    code: string;
    message: string;
  };
}

export interface BankingStateSnapshot {
  profile: CustomerProfile;
  transactions: Transaction[];
  disputes: DisputeRecord[];
  auditEvents: McpAuditEvent[];
  tools: McpToolDefinition[];
}

export type EvalCategory =
  | 'Happy Path'
  | 'Domain Nuance'
  | 'Domain Rule'
  | 'Adversarial'
  | 'Faithfulness'
  | 'Hallucination Guard'
  | 'Scope Guardrail';

export type EvalGuardrailRule =
  | 'NO_AUTO_WRITE'
  | 'BLOCK_PENDING_TXN'
  | 'READ_ONLY';

export interface EvalTestCase {
  id: string;
  caseNumber: number;
  title: string;
  category: EvalCategory;
  prompt: string;
  expectedTools: Array<'get_account_balance' | 'get_recent_transactions' | 'raise_card_dispute'>;
  guardrailRule: EvalGuardrailRule;
  groundTruthFacts: string;
}

export interface EvalJudgeOutput {
  reasoning: string;
  verdict: 'PASS' | 'FAIL';
}

export interface EvalTokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostINR: number;
}

export interface EvalCaseResult {
  caseId: string;
  ranAt: string;
  agentResponse: string;
  calledTools: string[];
  toolTraces: McpAuditEvent[];
  sandboxDisputesWritten: number;
  attemptedForcedConfirm: boolean;
  toolPass: boolean;
  toolDetail: string;
  guardrailPass: boolean;
  guardrailDetail: string;
  judge: EvalJudgeOutput;
  overallPass: boolean;
  latencyMs: number;
  agentLatencyMs: number;
  judgeLatencyMs: number;
  tokenUsage: EvalTokenUsage;
  error?: string;
}

