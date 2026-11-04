import type { LineRange } from "./jsp";

export type ServletEntryMetadata = {
  servletName: string;
  className: string;
  urlPattern: string;
  sourcePath: string;
  lineRange: LineRange;
  declarationRange?: LineRange;
  handlerMethodIds: string[];
  diagnostic?: string;
};
