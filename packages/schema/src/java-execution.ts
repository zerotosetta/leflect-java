/** Source-level execution facts. This is separate from the legacy orderedSteps contract. */
export type JavaExecutionModel = {
  version: 2;
  orderedSteps: JavaExecutionStep[];
  flowGraph: {
    entryNodeId: string;
    exitNodeIds: string[];
    nodes: Array<Record<string, unknown> & { id: string }>;
    edges: Array<Record<string, unknown> & { from: string; to: string }>;
    conditions?: Array<Record<string, unknown>>;
  };
  symbols: Array<Record<string, unknown> & { id: string }>;
  states: Array<Record<string, unknown>>;
  coverage: Record<string, unknown>;
};

export type JavaExecutionStep = Record<string, unknown> & {
  id: string;
  kind: string;
  snippet?: string;
  flowNodeId?: string;
  lineRange?: { startLine?: number; startColumn?: number; endLine?: number; endColumn?: number };
  guardRefs?: string[];
  guards?: Array<Record<string, unknown>>;
  effects?: Array<Record<string, unknown>>;
  declaration?: Record<string, unknown>;
};
