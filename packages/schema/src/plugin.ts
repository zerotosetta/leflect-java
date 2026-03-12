import type { LeflectConfig } from "./config";

export type LeflectPluginEnforce = "pre" | "normal" | "post";

export type AnalyzerHookTarget = "java" | "jsp" | "common";

export type PublicAstNode = Record<string, unknown>;

export type LeflectLogicalNodeType =
  | "ENTRY"
  | "VIRTUAL_PAGE"
  | "JSP"
  | "JAVA_CLASS"
  | "JAVA_METHOD"
  | "DYNAMIC_CALL"
  | "QUERY"
  | "INTERFACE_SPEC"
  | "TABLE"
  | "EXTERNAL_SYSTEM";

export type LeflectLogicalEdgeType =
  | "ENTRY_TO_JSP"
  | "ENTRY_TO_JAVA"
  | "JSP_INCLUDE"
  | "JSP_TO_JAVA"
  | "JAVA_IMPORT"
  | "JAVA_CALL"
  | "JAVA_TO_DYNAMIC"
  | "JAVA_TO_QUERY_DYNAMIC"
  | "JAVA_TO_INTERFACE_DYNAMIC"
  | "DYNAMIC_TO_JSP"
  | "DYNAMIC_TO_JAVA"
  | "DYNAMIC_TO_QUERY"
  | "DYNAMIC_TO_INTERFACE"
  | "QUERY_TO_TABLE"
  | "INTERFACE_TO_EXTERNAL";

export type NormalizedNodeSelector =
  | { by: "id"; id: string; type?: LeflectLogicalNodeType }
  | { by: "path"; path: string; type?: LeflectLogicalNodeType }
  | { by: "classpath"; classpath: string; type?: LeflectLogicalNodeType }
  | {
      by: "method";
      classpath: string;
      methodName: string;
      type?: Extract<LeflectLogicalNodeType, "JAVA_METHOD">;
    }
  | { by: "query"; queryId: string; type?: Extract<LeflectLogicalNodeType, "QUERY"> }
  | {
      by: "interface";
      interfaceId: string;
      type?: Extract<LeflectLogicalNodeType, "INTERFACE_SPEC">;
    }
  | {
      by: "external";
      externalId: string;
      type?: Extract<LeflectLogicalNodeType, "EXTERNAL_SYSTEM">;
    };

export type NormalizedNodeInput = {
  type: LeflectLogicalNodeType;
  id?: string;
  label?: string;
  path?: string;
  classpath?: string;
  methodName?: string;
  queryId?: string;
  interfaceId?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
};

export type NormalizedEdgeInput = {
  type: LeflectLogicalEdgeType | string;
  from: NormalizedNodeSelector;
  to: NormalizedNodeSelector;
  confidence?: number;
  metadata?: Record<string, unknown>;
  diagnostics?: string[];
};

export type HookResolveResult = {
  matched: boolean;
  stop?: boolean;
  nodes?: NormalizedNodeInput[];
  edges?: NormalizedEdgeInput[];
  diagnostics?: string[];
};

export type PluginLogger = {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
};

export type PluginSetupContext = {
  projectRoot: string;
  analysisOut: string;
  config: LeflectConfig;
  logger: PluginLogger;
};

export type PluginDisposeContext = PluginSetupContext;

export type HookMatchContext = {
  projectRoot: string;
  analysisOut: string;
  config: LeflectConfig;
  filePath: string;
  target: Exclude<AnalyzerHookTarget, "common">;
  pluginName: string;
};

export type HookResolveContext = HookMatchContext & {
  logger: PluginLogger;
};

export type AnalyzerHookDefinition = {
  id: string;
  target: AnalyzerHookTarget;
  when(node: PublicAstNode, ctx: HookMatchContext): boolean | Promise<boolean>;
  resolve(node: PublicAstNode, ctx: HookResolveContext): HookResolveResult | Promise<HookResolveResult>;
};

export type LeflectPlugin = {
  name: string;
  enforce?: LeflectPluginEnforce;
  version?: string;
  setup?(ctx: PluginSetupContext): void | Promise<void>;
  dispose?(ctx: PluginDisposeContext): void | Promise<void>;
  hooks?: AnalyzerHookDefinition[];
};
