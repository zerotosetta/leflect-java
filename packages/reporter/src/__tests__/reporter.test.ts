import os from "os";
import path from "path";
import { mkdtemp, readFile, writeFile, mkdir } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildReports,
  formatJavaUsagesResult,
  formatJspImpactResult,
  formatTagUsagesResult,
  queryJavaUsages,
  queryJspImpact,
  queryTagUsages,
  readReporterInput,
  writeReports
} from "../index";

describe("reporter", () => {
  it("builds reports from analysis artifacts", async () => {
    const analysisOut = await createAnalysisFixture();
    const input = await readReporterInput(analysisOut);
    const reports = buildReports(input);

    await writeReports(analysisOut, reports);

    expect(reports.summary.counts.classes).toBe(2);
    expect(reports.summary.counts.jspJavaEdges).toBe(3);
    expect(reports.summary.labels.classes.SERVICE).toBe(1);
    expect(reports.unresolved.edges).toHaveLength(1);
    expect(reports.unresolved.diagnostics).toHaveLength(3);
    expect(
      reports.unresolved.byPath.find(
        (entry) => entry.path === "src/main/webapp/WEB-INF/jsp/owners/findOwners.jsp"
      )
    ).toBeDefined();
    expect(reports.unresolved.diagnostics.some((entry) => entry.category === "jsp.taglib.uri.unresolved")).toBe(true);
    expect(reports.impactMarkdown).toContain("## JSP Impact");

    const summaryFile = await readFile(path.join(analysisOut, "report", "summary.json"), "utf8");
    const unresolvedFile = await readFile(
      path.join(analysisOut, "report", "unresolved.json"),
      "utf8"
    );
    const impactFile = await readFile(path.join(analysisOut, "report", "impact.md"), "utf8");

    expect(summaryFile).toContain("\"jspImpacts\"");
    expect(unresolvedFile).toContain("\"confidence\": \"unresolved\"");
    expect(unresolvedFile).toContain("\"category\": \"jsp.taglib.uri.unresolved\"");
    expect(impactFile).toContain("UserService");
  });

  it("answers jsp and class queries", async () => {
    const analysisOut = await createAnalysisFixture();
    const input = await readReporterInput(analysisOut);

    const jspImpact = queryJspImpact(input, "web/customerEdit.jsp");
    const javaUsages = queryJavaUsages(input, "UserService");
    const tagUsages = queryTagUsages(input, "FormTag");

    expect(jspImpact.javaTargets).toEqual(["UserService"]);
    expect(jspImpact.tagHandlers).toEqual(["FormTag"]);
    expect(javaUsages.jspCallers).toEqual(["web/customerEdit.jsp"]);
    expect(tagUsages.jspFiles).toEqual(["web/customerEdit.jsp"]);

    expect(formatJspImpactResult(jspImpact)).toContain("JSP: web/customerEdit.jsp");
    expect(formatJavaUsagesResult(javaUsages)).toContain("Class: UserService");
    expect(formatTagUsagesResult(tagUsages)).toContain("Tag handler: FormTag");
  });
});

async function createAnalysisFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "leflect-reporter-"));
  const analysisOut = path.join(root, "analysis");
  const indexDir = path.join(analysisOut, "index");
  const graphDir = path.join(analysisOut, "graph");
  const logsDir = path.join(analysisOut, "logs");

  await mkdir(indexDir, { recursive: true });
  await mkdir(graphDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  await writeJson(path.join(indexDir, "classes.json"), [
    { id: "UserService", name: "UserService", file: "src/UserService.java" },
    { id: "FormTag", name: "FormTag", file: "src/tag/FormTag.java" }
  ]);
  await writeJson(path.join(indexDir, "methods.json"), [
    { id: "UserService#find()", name: "find", classId: "UserService" }
  ]);
  await writeJson(path.join(indexDir, "jsp-docs.json"), [
    { path: "web/customerEdit.jsp" }
  ]);
  await writeJson(path.join(indexDir, "taglibs.json"), [
    { uri: "/WEB-INF/form.tld", tags: [{ name: "form", tagClass: "FormTag" }] }
  ]);
  await writeJson(path.join(indexDir, "reverse-index.json"), {
    handlerToJsp: {
      FormTag: ["web/customerEdit.jsp"]
    }
  });
  await writeJson(path.join(indexDir, "labels.json"), {
    schemaVersion: "1.0",
    generatedAt: "2026-03-08T00:00:00.000Z",
    classes: {
      UserService: ["SERVICE"],
      FormTag: ["TAG_HANDLER"]
    },
    methods: {
      "UserService#find()": ["SERVICE_METHOD"]
    },
    jsps: {
      "web/customerEdit.jsp": ["PAGE"]
    }
  });
  await writeFile(
    path.join(graphDir, "java-call.jsonl"),
    `${JSON.stringify({
      from: "Controller#save()",
      to: "UserService",
      type: "JAVA_CALL",
      confidence: "high"
    })}\n`
  );
  await writeFile(
    path.join(graphDir, "jsp-java.jsonl"),
    [
      {
        from: "web/customerEdit.jsp",
        to: "UserService",
        type: "JSP_SCRIPTLET_CALL",
        confidence: "low"
      },
      {
        from: "web/customerEdit.jsp",
        to: "FormTag",
        type: "JSP_USES_TAG",
        confidence: "high"
      },
      {
        from: "web/customerEdit.jsp",
        to: "unresolved:tag:c:missing:0",
        type: "JSP_USES_TAG",
        confidence: "unresolved"
      }
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n")
      .concat("\n")
  );
  await writeFile(
    path.join(logsDir, "jsp-parse-errors.jsonl"),
    `${JSON.stringify({
      stage: "jsp-parse",
      severity: "error",
      path: "src/main/webapp/WEB-INF/jsp/owners/findOwners.jsp",
      category: "jsp.taglib.uri.unresolved",
      summary: "Taglib URI could not be resolved",
      message: "The absolute uri: [http://www.springframework.org/tags] cannot be resolved in either web.xml or the jar files deployed with this application",
      hint: "Add the dependency JAR/TLD for this URI or declare the mapping in web.xml.",
      relatedUri: "http://www.springframework.org/tags",
      location: {
        line: 1,
        column: 15,
        endLine: 1,
        endColumn: 49
      },
      snippet: '<%@ taglib prefix=\"spring\" uri=\"http://www.springframework.org/tags\" %>'
    })}\n`
  );
  await writeFile(
    path.join(logsDir, "java-parse-errors.jsonl"),
    `${JSON.stringify({
      stage: "java-parse",
      severity: "error",
      path: "src/main/java/demo/Broken.java",
      category: "java.parse.problem",
      summary: "Java parse problem",
      message: "Parse error. Found \"}\", expected one of  \";\" \"@\" ...",
      hint: "Inspect the Java syntax near the reported location.",
      location: {
        line: 3,
        column: 3,
        endLine: 3,
        endColumn: 3
      },
      snippet: "}"
    })}\n`
  );

  return analysisOut;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(payload, null, 2));
}
