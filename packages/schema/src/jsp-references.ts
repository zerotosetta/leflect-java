export type JspReferenceLocation = {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
};

export type JspIncludeReference = {
  page: string;
  location: JspReferenceLocation;
  kind: "static" | "dynamic";
  targetPath?: string;
  candidatePaths?: string[];
  parameters: Array<{ name: string; value: string; location: JspReferenceLocation }>;
  evidence?: Array<{ description: string; path?: string; location?: JspReferenceLocation }>;
  unresolvedReason?: string;
};
