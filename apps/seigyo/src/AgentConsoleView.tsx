import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Check,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { Proposal } from "@seigyo/contracts";
import { api } from "./api";
import {
  getAgentConsoleSnapshot,
  resolvePendingApproval,
  setAgentConsoleDismissLock,
  subscribeAgentConsole,
} from "./agentConsole";

type ApprovalResponse = {
  proposalId: string;
  token: string;
  expiresAt: number;
};

type ConsoleNotice = (
  tone: "success" | "danger" | "info",
  title: string,
  message: string,
) => void;

const readable = (value: string): string =>
  value.replaceAll("_", " ").replaceAll("-", " ");

function ApprovalCheckpoint({
  proposal,
  expiresAt,
  reload,
  notify,
}: {
  proposal: Proposal;
  expiresAt: number;
  reload(): Promise<void>;
  notify: ConsoleNotice;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const firstButton =
      dialogRef.current?.querySelector<HTMLButtonElement>("button");
    firstButton?.focus();
    const interval = window.setInterval(
      () =>
        setSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))),
      1000,
    );
    return () => {
      window.clearInterval(interval);
      previousFocus.current?.focus();
    };
  }, [expiresAt]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const buttons = [
      ...(dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (buttons.length === 0) return;
    const first = buttons[0] as HTMLButtonElement;
    const last = buttons.at(-1) as HTMLButtonElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const approve = async () => {
    setBusy("approve");
    try {
      const approval = await api.approve<ApprovalResponse>(proposal.id);
      sessionStorage.setItem(`approval:${proposal.id}`, approval.token);
      resolvePendingApproval(proposal.id, {
        proposal: { ...proposal, status: "approved" },
        decision: "approved",
      });
      notify(
        "success",
        "Exact action approved",
        "Permission was granted. The agent can continue with this exact action.",
      );
      await reload();
    } catch (error) {
      notify(
        "danger",
        "Approval failed",
        error instanceof Error ? error.message : "Unknown error",
      );
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy("reject");
    try {
      await api.reject(proposal.id);
      resolvePendingApproval(proposal.id, {
        ok: false,
        error: {
          code: "USER_REJECTED",
          message: "The human rejected the proposed intervention.",
        },
      });
      notify("info", "Proposal rejected", "No service state was changed.");
      await reload();
    } catch (error) {
      notify(
        "danger",
        "Rejection failed",
        error instanceof Error ? error.message : "Unknown error",
      );
      setBusy(null);
    }
  };

  return (
    <motion.div
      layout
      ref={dialogRef}
      className="agent-approval"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="agent-approval-title"
      aria-describedby="agent-approval-description"
      onKeyDown={trapFocus}
    >
      <div className="agent-console-head">
        <span className="agent-console-icon">
          <ShieldCheck size={17} />
        </span>
        <div>
          <span className="eyebrow">Human checkpoint</span>
          <h2 id="agent-approval-title">Approve exact intervention</h2>
        </div>
        <span className="agent-expiry">
          {Math.floor(secondsLeft / 60)}:
          {String(secondsLeft % 60).padStart(2, "0")}
        </span>
      </div>
      <p id="agent-approval-description" className="agent-approval-rationale">
        {proposal.rationale}
      </p>
      <dl className="agent-approval-grid">
        <div>
          <dt>Action</dt>
          <dd>{readable(proposal.action.type)}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{readable(proposal.action.targetService)}</dd>
        </div>
        <div>
          <dt>Expected effect</dt>
          <dd>{proposal.predictedImpact.summary}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{proposal.predictedImpact.risk}</dd>
        </div>
      </dl>
      <div className="agent-evidence">
        <span>Evidence</span>
        <p>{proposal.evidenceRefs.slice(0, 3).join(" · ")}</p>
      </div>
      <div className="agent-approval-actions">
        <button
          className="button button-primary"
          disabled={busy !== null}
          onClick={approve}
        >
          {busy === "approve" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Check size={15} />
          )}
          Approve exact action
        </button>
        <button
          className="button button-ghost"
          disabled={busy !== null}
          onClick={reject}
        >
          {busy === "reject" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <XCircle size={15} />
          )}
          Reject
        </button>
      </div>
    </motion.div>
  );
}

export function AgentConsole({
  reload,
  notify,
}: {
  reload(): Promise<void>;
  notify: ConsoleNotice;
}) {
  const state = useSyncExternalStore(
    subscribeAgentConsole,
    getAgentConsoleSnapshot,
    getAgentConsoleSnapshot,
  );
  const reduceMotion = useReducedMotion();
  const consoleRef = useRef<HTMLElement>(null);
  const approval = state.approvals[0];
  const active = state.calls.find((call) => call.state === "running");
  const recent = state.calls
    .filter(
      (call) => call.state !== "running" && call.callId !== active?.callId,
    )
    .slice(0, 2);

  useEffect(() => {
    const element = consoleRef.current;
    if (!element || !state.visible) {
      document.documentElement.style.setProperty(
        "--agent-console-height",
        "0px",
      );
      return;
    }
    const update = () =>
      document.documentElement.style.setProperty(
        "--agent-console-height",
        `${element.getBoundingClientRect().height + 12}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty(
        "--agent-console-height",
        "0px",
      );
    };
  }, [approval, state.visible]);

  return (
    <div className="agent-console-layer">
      <AnimatePresence mode="wait">
        {state.visible && (
          <motion.aside
            ref={consoleRef}
            key={approval ? `approval-${approval.proposal.id}` : "activity"}
            className={`agent-console ${approval ? "awaiting-approval" : "showing-activity"}`}
            onMouseEnter={() => setAgentConsoleDismissLock("pointer", true)}
            onMouseLeave={() => setAgentConsoleDismissLock("pointer", false)}
            onFocus={() => setAgentConsoleDismissLock("focus", true)}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setAgentConsoleDismissLock("focus", false);
            }}
            initial={
              reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }
            }
            transition={{
              duration: reduceMotion ? 0.08 : 0.2,
              ease: "easeOut",
            }}
          >
            {approval ? (
              <ApprovalCheckpoint
                proposal={approval.proposal}
                expiresAt={approval.localExpiresAt}
                reload={reload}
                notify={notify}
              />
            ) : (
              <div role="status" aria-live="polite" aria-atomic="true">
                <div className="agent-console-head">
                  <span className="agent-console-icon active">
                    {active ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <CheckCircle2 size={17} />
                    )}
                  </span>
                  <div>
                    <span className="eyebrow">WebMCP</span>
                    <h2>{active ? "Agent working" : "Agent activity"}</h2>
                  </div>
                  <span className="agent-live">
                    {active ? "Live" : "Complete"}
                  </span>
                </div>
                {active && (
                  <div className="agent-active-call">
                    <strong>{active.label}</strong>
                    <span className="agent-progress" />
                  </div>
                )}
                {recent.length > 0 && (
                  <div className="agent-recent">
                    {recent.map((call) => (
                      <div key={call.callId}>
                        {call.state === "complete" ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <XCircle size={14} />
                        )}
                        <span>{call.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
