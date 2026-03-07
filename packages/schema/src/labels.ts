export type ClassLabel =
  | "SERVICE"
  | "DAO"
  | "CONTROLLER"
  | "TAG_HANDLER"
  | "UTIL"
  | "DTO"
  | "UNKNOWN";

export type MethodLabel =
  | "SERVICE_METHOD"
  | "TAG_ENTRYPOINT"
  | "ACCESSOR"
  | "UNKNOWN";

export type JspLabel = "PAGE" | "FRAGMENT" | "AJAX_VIEW" | "UNKNOWN";

export type LabelsIndex = {
  schemaVersion: string;
  generatedAt: string;
  classes: Record<string, ClassLabel[]>;
  methods: Record<string, MethodLabel[]>;
  jsps: Record<string, JspLabel[]>;
};
