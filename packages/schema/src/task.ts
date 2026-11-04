import type { LineRange } from "./jsp";

export type TaskCodeOccurrence = {
  file: string;
  lineRange: LineRange;
  prefix: string;
  tagName: string;
  uri: string;
  handlerClass: string;
  raw: string;
  code?: string;
  state: "literal" | "dynamic" | "missing" | "empty";
  diagnostic?: string;
};

export type TaskCodeIndex = {
  schemaVersion: string;
  generatedAt: string;
  occurrences: TaskCodeOccurrence[];
  codes: string[];
  counts: {
    occurrences: number;
    literalOccurrences: number;
    distinctCodes: number;
    dynamicOccurrences: number;
    invalidOccurrences: number;
  };
};
