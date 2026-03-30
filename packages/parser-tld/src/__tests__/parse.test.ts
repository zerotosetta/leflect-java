import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import os from "os";
import path from "path";
import { mkdtemp, mkdir, writeFile } from "fs/promises";

import { loadTldRegistry, parseTld } from "../parse";

describe("parseTld", () => {
  it("extracts uri, handlers, and attribute schema", () => {
    const xml = `<?xml version="1.0"?>
<taglib>
  <uri>http://example.com/tags</uri>
  <tag>
    <name>hello</name>
    <tag-class>com.example.HelloTag</tag-class>
    <body-content>JSP</body-content>
    <dynamic-attributes>true</dynamic-attributes>
    <attribute>
      <name>value</name>
      <required>true</required>
      <rtexprvalue>true</rtexprvalue>
      <type>java.lang.String</type>
    </attribute>
  </tag>
</taglib>`;

    const result = parseTld(xml);

    expect(result.uri).toBe("http://example.com/tags");
    expect(result.tags).toEqual([
      {
        name: "hello",
        handlerClass: "com.example.HelloTag",
        bodyContent: "JSP",
        dynamicAttributes: true,
        attributes: [
          {
            name: "value",
            required: true,
            runtimeExpressionValue: true,
            type: "java.lang.String"
          }
        ]
      }
    ]);
  });

  it("loads registry entries from repo, configured paths, and jars with uri precedence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "leflect-tld-"));
    const repoPath = path.join(root, "WEB-INF", "repo.tld");
    const overridePath = path.join(root, "overrides", "override.tld");
    const extraJar = path.join(root, "lib", "extra.jar");

    await mkdir(path.dirname(repoPath), { recursive: true });
    await mkdir(path.dirname(overridePath), { recursive: true });
    await mkdir(path.dirname(extraJar), { recursive: true });

    await writeFile(
      repoPath,
      `<taglib><uri>http://example.com/tags</uri><tag><name>repo</name><tag-class>RepoTag</tag-class></tag></taglib>`
    );
    await writeFile(
      overridePath,
      `<taglib><uri>http://example.com/tags</uri><tag><name>override</name><tag-class>OverrideTag</tag-class></tag></taglib>`
    );

    const zip = new AdmZip();
    zip.addFile(
      "META-INF/extra.tld",
      Buffer.from(`<taglib><uri>http://example.com/extra</uri><tag><name>extra</name><tag-class>ExtraTag</tag-class></tag></taglib>`)
    );
    zip.addFile(
      "META-INF/tags.tld",
      Buffer.from(`<taglib><uri>http://example.com/tags</uri><tag><name>jar</name><tag-class>JarTag</tag-class></tag></taglib>`)
    );
    zip.writeZip(extraJar);

    const result = await loadTldRegistry({
      root,
      repoFiles: ["WEB-INF/repo.tld"],
      configuredPaths: [path.join(root, "overrides")],
      classpathEntries: [extraJar],
      autoLoad: true,
      uriMap: {
        "http://example.com/tags": "./overrides/override.tld"
      }
    });

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        uri: "http://example.com/tags",
        sourceKind: "uri-map",
        sourcePath: expect.stringContaining("override.tld"),
        tags: [expect.objectContaining({ handlerClass: "OverrideTag" })]
      }),
      expect.objectContaining({
        uri: "http://example.com/extra",
        sourceKind: "classpath",
        sourcePath: expect.stringContaining("extra.jar!/META-INF/extra.tld")
      })
    ]));
    expect(result.diagnostics.some((entry) => entry.code === "duplicate-uri")).toBe(true);
  });
});
