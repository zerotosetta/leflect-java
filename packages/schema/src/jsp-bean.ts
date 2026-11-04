import type { LineRange } from "./jsp";

export type JspBeanAction = {
  id?: string;
  className?: string;
  scope?: string;
  lineRange: LineRange;
  actionDescription: string;
  api?: {
    javaVersion: string;
    description: string;
    source: string;
  };
  apiDescriptionStatus: "available" | "source-unavailable" | "type-unavailable";
};
