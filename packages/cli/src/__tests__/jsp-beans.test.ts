import fs from "fs/promises";
import os from "os";
import path from "path";

import AdmZip from "adm-zip";
import { parseJsp } from "@leflect-java/parser-jsp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeJspBeans } from "../jsp-beans";

const docs = [{
  path: "views/test.jsp",
  document: parseJsp('<%-- <jsp:useBean class="skip.Hidden"/> --%>\n<div><jsp:useBean id="now" class="java.util.Date" scope="request"/></div>').document
}];

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-jsp-beans-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("describeJspBeans", () => {
  it("uses the project's Maven target and reports the archive entry used for the API description", async () => {
    const zip = new AdmZip();
    zip.addFile("java/util/Date.java", Buffer.from("package java.util;\n/** Represents an instant with {@code millisecond} precision. */\npublic class Date {}"));
    const archive = path.join(root, "src.zip");
    zip.writeZip(archive);
    await fs.writeFile(path.join(root, "pom.xml"), "<project><properties><maven.compiler.target>1.8</maven.compiler.target></properties></project>");

    const actions = await describeJspBeans(docs, { root, jdkSourceArchive: "src.zip" });

    expect(actions.get(docs[0].path)).toMatchObject([{
      id: "now",
      scope: "request",
      className: "java.util.Date",
      lineRange: { startLine: 2 },
      apiDescriptionStatus: "available",
      api: {
        javaVersion: "8",
        description: "Represents an instant with millisecond precision.",
        source: `${archive}!/java/util/Date.java`
      }
    }]);
  });

  it("retains the action and type when the configured JDK is for another version", async () => {
    const zip = new AdmZip();
    zip.addFile("java.base/java/util/Date.java", Buffer.from("/** Wrong JDK version. */\npublic class Date {}"));
    await fs.mkdir(path.join(root, "lib"));
    zip.writeZip(path.join(root, "lib", "src.zip"));
    await fs.writeFile(path.join(root, "release"), 'JAVA_VERSION="25.0.2"');

    const actions = await describeJspBeans(docs, { root, javaVersion: "8", jdkSourceArchive: "lib/src.zip" });

    expect(actions.get(docs[0].path)).toMatchObject([{
      className: "java.util.Date",
      actionDescription: expect.stringContaining("JSP scope"),
      apiDescriptionStatus: "source-unavailable"
    }]);
    expect(actions.get(docs[0].path)?.[0].api).toBeUndefined();
  });
});
