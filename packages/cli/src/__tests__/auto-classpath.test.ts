import AdmZip from "adm-zip";
import os from "os";
import path from "path";
import { mkdtemp, mkdir, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  collectJavaImportQueries,
  discoverSystemClasspathEntries,
  extractMissingClassQueries,
  extractMissingTaglibUriQueries
} from "../auto-classpath";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("auto classpath discovery", () => {
  it("extracts missing class and taglib uri queries from parse problems", () => {
    const problems = [
      {
        message: "java.lang.NoClassDefFoundError: org/springframework/validation/Errors",
        detail: "The absolute uri: [http://www.springframework.org/tags] cannot be resolved"
      },
      {
        rawCause: "java.lang.ClassNotFoundException: org.apache.taglibs.standard.tag.rt.core.ForEachTag"
      }
    ];

    expect(extractMissingClassQueries(problems)).toEqual([
      "org.apache.taglibs.standard.tag.rt.core.ForEachTag",
      "org.springframework.validation.Errors"
    ]);
    expect(extractMissingTaglibUriQueries(problems)).toEqual([
      "http://www.springframework.org/tags"
    ]);
  });

  it("collects import queries from Java source files", async () => {
    const root = await tempDir("leflect-auto-cp-");
    const source = path.join(root, "src", "App.java");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import org.springframework.validation.Errors;",
        "import static demo.Util.run;",
        "import java.util.List;",
        "import demo.internal.*;"
      ].join("\n")
    );

    const queries = await collectJavaImportQueries(root, ["src/App.java"]);

    expect(queries).toEqual([
      "demo.Util",
      "java.util.List",
      "org.springframework.validation.Errors"
    ]);
  });

  it("finds jars by missing class and taglib uri", async () => {
    const searchRoot = await tempDir("leflect-auto-cp-");
    const classJar = path.join(searchRoot, "org", "springframework", "spring-context", "spring-context.jar");
    const tldJar = path.join(searchRoot, "org", "springframework", "spring-webmvc", "spring-webmvc.jar");

    await mkdir(path.dirname(classJar), { recursive: true });
    await mkdir(path.dirname(tldJar), { recursive: true });

    const classZip = new AdmZip();
    classZip.addFile("org/springframework/validation/Errors.class", Buffer.from(""));
    classZip.writeZip(classJar);

    const tldZip = new AdmZip();
    tldZip.addFile(
      "META-INF/spring.tld",
      Buffer.from("<taglib><uri>http://www.springframework.org/tags</uri></taglib>")
    );
    tldZip.writeZip(tldJar);

    const discovered = await discoverSystemClasspathEntries({
      searchRoots: [searchRoot],
      classQueries: ["org.springframework.validation.Errors"],
      taglibUriQueries: ["http://www.springframework.org/tags"]
    });

    expect(discovered).toEqual([classJar, tldJar]);
  });
});
