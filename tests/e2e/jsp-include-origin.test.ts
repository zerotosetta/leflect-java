import fs from "fs/promises";
import path from "path";

import { expect, it } from "vitest";

import { analyzeWorkspace } from "@leflect-java/cli";
import type { JspIncludeReference } from "@leflect-java/schema";
import { cleanupWorkspace, createFixtureWorkspace, readJsonFile } from "@leflect-java/testkit";

it("distinguishes JDBC resources from values read for a dynamic include", async () => {
  const workspace = await createFixtureWorkspace("custom-tag");
  try {
    const { root, analysisOut } = workspace;
    await fs.mkdir(path.join(root, "src/javax/servlet"), { recursive: true });
    await fs.mkdir(path.join(root, "src/demo"), { recursive: true });
    await fs.writeFile(path.join(root, "src/javax/servlet/ServletRequest.java"),
      "package javax.servlet; public interface ServletRequest { void setAttribute(String name, Object value); }");
    await fs.writeFile(path.join(root, "src/demo/View.java"), [
      "package demo;",
      "import java.sql.*;",
      "import javax.servlet.ServletRequest;",
      "public class View {",
      "  public static Connection open() { return null; }",
      "  public void show(ServletRequest request) throws Exception {",
      "    Connection connection = open();",
      "    String view = connection.prepareStatement(\"SELECT PATH FROM CMS\").executeQuery().getString(1);",
      "    request.setAttribute(\"view\", view);",
      "  }",
      "}"
    ].join("\n"));
    await fs.writeFile(path.join(root, "web/customerEdit.jsp"), '<jsp:include page="${view}"/>');
    await analyzeWorkspace({ root, analysisOut, jspAstMode: "lightweight" });
    const metadata = await readJsonFile<{ includeReferences: JspIncludeReference[] }>(
      path.join(analysisOut, "index/jsp/web/customerEdit.jsp.json")
    );
    const [include] = metadata.includeReferences;
    expect(include).toMatchObject({ kind: "dynamic", unresolvedReason: expect.stringContaining("runtime") });
    expect(include.targetPath).toBeUndefined();
    expect(include.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: "Resource from demo.View.open()", role: "resource", objectType: "java.sql.Connection", location: expect.objectContaining({ line: 7 }) }),
      expect.objectContaining({ description: "Database value through java.sql.ResultSet.getString", role: "value", location: expect.objectContaining({ line: 8 }) }),
      expect.objectContaining({ description: "Declaration of view", role: "declaration", variable: "view", location: expect.objectContaining({ line: 8 }) })
    ]));
    expect(include.evidence?.some(item => item.description === "Value from demo.View.open()")).toBe(false);
  } finally {
    await cleanupWorkspace(workspace);
  }
});
