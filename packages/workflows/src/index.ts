export const WORKFLOW_CONTRACT_VERSION = "1.0.0" as const;

export type WorkflowRuntime = "python-langgraph";
export type WorkflowStatus = "queued" | "running" | "completed" | "failed";

export interface WorkflowDispatch {
  workflowId: string;
  runtime: WorkflowRuntime;
  contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
  runId: string;
  input: Record<string, unknown>;
}

export interface WorkflowResult {
  workflowId: string;
  runId: string;
  status: WorkflowStatus;
  output?: Record<string, unknown>;
  error?: { message: string; code?: string };
}

export const WORKFLOW_RUNTIME = "python-langgraph" as const;

export function createWorkflowDispatch(input: Omit<WorkflowDispatch, "contractVersion">): WorkflowDispatch {
  return {
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    ...input,
  };
}
