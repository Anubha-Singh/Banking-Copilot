import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  BankingStateSnapshot,
  ChatMessage,
  PendingDisputeConfirmation,
} from './types/banking';
import { CopilotChatPanel } from './components/CopilotChatPanel';
import { EvalSuiteView } from './components/EvalSuiteView';
import { McpInspectorPanel, type InspectorTab } from './components/McpInspectorPanel';

type ActiveWorkspaceView = 'copilot' | 'eval';

function createWelcomeMessage(): ChatMessage {
  return {
    id: 'msg-welcome',
    role: 'assistant',
    content:
      'Good evening, Ananya. I am connected to your Savings Account (`•••• 4821`) through verified Core Banking MCP tools.\n\nYou can ask me to check your balance, inspect recent transactions, investigate duplicate charges, or initiate a card dispute. Every write action is protected by live backend settlement and confirmation guardrails.',
    timestamp: new Date().toISOString(),
  };
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveWorkspaceView>('copilot');
  const [bankingState, setBankingState] = useState<BankingStateSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createWelcomeMessage()]);
  const [isSending, setIsSending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('mcp');
  const [mobilePane, setMobilePane] = useState<'copilot' | 'inspector'>('copilot');
  const [runningDirectTool, setRunningDirectTool] = useState<string | null>(null);

  const fetchInitialState = useCallback(async () => {
    try {
      const res = await fetch('/api/banking/state');
      if (!res.ok) return;
      const data = (await res.json()) as BankingStateSnapshot;
      setBankingState(data);
    } catch {
      // Keep UI resilient if server is temporarily restarting.
    }
  }, []);

  useEffect(() => {
    fetchInitialState();
  }, [fetchInitialState]);

  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    const historyForApi = messages
      .filter((m) => m.id !== 'msg-welcome')
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);

    try {
      const res = await fetch('/api/copilot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: historyForApi,
        }),
      });

      const rawText = await res.text();
      let data: {
        error?: string;
        reply?: string;
        state?: BankingStateSnapshot;
        toolEvents?: Array<{ toolName: string }>;
        pendingConfirmation?: PendingDisputeConfirmation;
        errorBanner?: { code: string; message: string };
      } = {};
      try {
        data = rawText ? (JSON.parse(rawText) as typeof data) : {};
      } catch {
        data = { error: `HTTP ${res.status}: Unexpected response from server.` };
      }

      if (!res.ok) {
        const errMessage =
          typeof data?.error === 'string'
            ? data.error
            : `Unable to reach Engagement Banking Copilot backend (HTTP ${res.status}).`;
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: `I encountered an error while processing your request: ${errMessage}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (data.state) {
        setBankingState(data.state as BankingStateSnapshot);
      }

      const toolNamesUsed: string[] = Array.isArray(data.toolEvents)
        ? Array.from(
            new Set(
              (data.toolEvents as Array<{ toolName: string }>).map((e) => e.toolName)
            )
          )
        : [];

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply ?? 'No response returned by the Banking Copilot.',
        timestamp: new Date().toISOString(),
        toolNamesUsed,
        pendingConfirmation: data.pendingConfirmation,
        errorBanner: data.errorBanner,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `neterr-${Date.now()}`,
          role: 'assistant',
          content:
            'Network connection to the Banking Copilot server failed. Please verify the server is running and try again.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleConfirmDispute = async (confirmation: PendingDisputeConfirmation) => {
    setConfirmingId(confirmation.confirmationId);
    try {
      const res = await fetch('/api/copilot/confirm-dispute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: confirmation.transaction_id,
          reason: confirmation.reason,
        }),
      });

      const data = await res.json();
      if (data.state) {
        setBankingState(data.state as BankingStateSnapshot);
      }

      const disputeId = data?.result?.dispute?.dispute_id as string | undefined;

      setMessages((prev) => [
        ...prev.map((msg) => {
          if (msg.pendingConfirmation?.confirmationId !== confirmation.confirmationId) {
            return msg;
          }
          return {
            ...msg,
            pendingConfirmation: {
              ...msg.pendingConfirmation,
              state: data.ok ? ('CONFIRMED' as const) : ('CANCELLED' as const),
              dispute_id: disputeId,
              confirmed_at: new Date().toISOString(),
            },
          };
        }),
        {
          id: `confirm-${Date.now()}`,
          role: 'assistant',
          content:
            data.reply ||
            (data.ok
              ? 'Your card dispute has been confirmed and recorded.'
              : 'The dispute could not be submitted.'),
          timestamp: new Date().toISOString(),
          toolNamesUsed: ['raise_card_dispute'],
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `confirm-err-${Date.now()}`,
          role: 'assistant',
          content:
            'Unable to submit the confirmed dispute right now. Please retry in a moment.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setConfirmingId(null);
    }
  };

  const handleCancelDispute = (confirmationId: string) => {
    setMessages((prev) => [
      ...prev.map((msg) => {
        if (msg.pendingConfirmation?.confirmationId !== confirmationId) {
          return msg;
        }
        return {
          ...msg,
          pendingConfirmation: {
            ...msg.pendingConfirmation,
            state: 'CANCELLED' as const,
          },
        };
      }),
      {
        id: `cancel-${Date.now()}`,
        role: 'assistant',
        content:
          'Understood — I have cancelled the dispute authorization request. No changes were written to your account.',
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  const handleRunDirectTool = async (
    toolName: 'get_account_balance' | 'get_recent_transactions'
  ) => {
    setRunningDirectTool(toolName);
    try {
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolName, arguments: {} }),
      });
      const data = await res.json();
      if (data.state) {
        setBankingState(data.state as BankingStateSnapshot);
      }
    } finally {
      setRunningDirectTool(null);
    }
  };

  const handleResetSession = async () => {
    setIsResetting(true);
    try {
      const res = await fetch('/api/banking/reset', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as BankingStateSnapshot;
        setBankingState(data);
        setMessages([createWelcomeMessage()]);
      }
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[#F8F9FB]">
      {/* Top Bar Contract: 3 clean single-line zones */}
      <header className="h-14 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Brand Title */}
        <h1 className="font-display text-base font-bold tracking-tight text-slate-950 whitespace-nowrap shrink-0">
          Engagement Banking Copilot
        </h1>

        {/* Zone 2: Primary Workspace Navigation Tabs */}
        <nav
          aria-label="Primary navigation"
          className="flex items-center gap-6 text-sm font-medium overflow-x-auto"
        >
          <button
            type="button"
            onClick={() => setActiveView('copilot')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeView === 'copilot'
                ? 'text-slate-950 underline underline-offset-8 decoration-2 decoration-blue-700'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Banking Copilot
          </button>
          <button
            type="button"
            onClick={() => setActiveView('eval')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeView === 'eval'
                ? 'text-slate-950 underline underline-offset-8 decoration-2 decoration-blue-700'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            AI Eval &amp; Governance Suite (v1.1)
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleResetSession}
            disabled={isResetting || isSending}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
            <span>Reset Session</span>
          </button>
        </div>
      </header>

      {activeView === 'copilot' ? (
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Mobile Pane Switcher for Split-Screen */}
          <div className="lg:hidden px-4 py-2 bg-white border-b border-slate-200 flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setMobilePane('copilot')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                mobilePane === 'copilot'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Copilot Chat
            </button>
            <button
              type="button"
              onClick={() => setMobilePane('inspector')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                mobilePane === 'inspector'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              MCP Inspector &amp; Ledger
            </button>
          </div>

          {/* Split-Screen Executive Workspace: 60% Copilot Chat / 40% Live MCP & Guardrail Inspector */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            <div
              className={`${
                mobilePane === 'copilot' ? 'flex' : 'hidden'
              } lg:flex lg:w-[60%] h-full min-h-0 flex-col`}
            >
              <CopilotChatPanel
                profile={bankingState?.profile ?? null}
                activeDisputeCount={bankingState?.disputes.length ?? 0}
                messages={messages}
                isSending={isSending}
                confirmingId={confirmingId}
                onSendMessage={handleSendMessage}
                onConfirmDispute={handleConfirmDispute}
                onCancelDispute={handleCancelDispute}
              />
            </div>

            <div
              className={`${
                mobilePane === 'inspector' ? 'flex' : 'hidden'
              } lg:flex lg:w-[40%] h-full min-h-0 flex-col`}
            >
              <McpInspectorPanel
                activeTab={inspectorTab}
                onTabChange={setInspectorTab}
                tools={bankingState?.tools ?? []}
                auditEvents={bankingState?.auditEvents ?? []}
                transactions={bankingState?.transactions ?? []}
                disputes={bankingState?.disputes ?? []}
                onRunDirectTool={handleRunDirectTool}
                runningDirectTool={runningDirectTool}
              />
            </div>
          </div>
        </main>
      ) : (
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <EvalSuiteView />
        </main>
      )}
    </div>
  );
}
