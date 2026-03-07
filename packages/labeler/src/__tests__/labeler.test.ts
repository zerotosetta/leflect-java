import os from "os";
import path from "path";
import { mkdtemp } from "fs/promises";

import { describe, expect, it } from "vitest";

import { buildLabelsIndex, labelClass, labelJsp, labelMethod, readLabelsIndex, writeLabelsIndex } from "../index";

describe("labeler", () => {
  it("applies class, method, and jsp labels", () => {
    const classLabels = labelClass({
      id: "com.example.UserService",
      name: "UserService",
      file: "src/com/example/UserService.java"
    });

    expect(classLabels).toEqual(["SERVICE"]);
    expect(
      labelMethod(
        { id: "com.example.UserService#find()", name: "find", classId: "com.example.UserService" },
        classLabels
      )
    ).toEqual(["SERVICE_METHOD"]);
    expect(labelJsp({ path: "domain-user/view/customerEdit.jsp" })).toEqual(["PAGE"]);
  });

  it("builds and writes labels index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "leflect-labels-"));
    const outputPath = path.join(root, "analysis", "index", "labels.json");
    const index = buildLabelsIndex({
      classes: [
        { id: "com.example.FormTag", name: "FormTag", file: "src/tag/FormTag.java", extendsTypes: ["TagSupport"] }
      ],
      methods: [
        { id: "com.example.FormTag#doStartTag()", name: "doStartTag", classId: "com.example.FormTag" }
      ],
      jsps: [{ path: "common/include/_form.jsp" }]
    });

    await writeLabelsIndex(outputPath, index);
    const loaded = await readLabelsIndex(outputPath);

    expect(loaded.classes["com.example.FormTag"]).toContain("TAG_HANDLER");
    expect(loaded.methods["com.example.FormTag#doStartTag()"]).toContain("TAG_ENTRYPOINT");
    expect(loaded.jsps["common/include/_form.jsp"]).toEqual(["FRAGMENT"]);
  });
});
