import { defineConfig } from "@leflect-java/core";

import { dynamicQueryPlugin } from "./leflect/plugins/dynamic-query-plugin";
import { interfacePlugin } from "./leflect/plugins/interface-plugin";

export default defineConfig({
  analysisOut: "./analysis",
  ignoreFile: "./.gitignore",
  entryFiles: {
    java: ["AccountController\\.java$"],
    jsp: ["WEB-INF/jsp/account/.+\\.jsp$"]
  },
  entries: [
    {
      id: "account.list",
      type: "virtual_page",
      label: "Account List",
      description: "A virtual page seed with fan-out JSPs plus deferred query and interface targets.",
      jsp: [
        "src/main/webapp/WEB-INF/jsp/common/header.jsp",
        "src/main/webapp/WEB-INF/jsp/account/list.jsp"
      ],
      java: ["src/main/java/com/acme/account/AccountController.java"],
      query: ["account.selectBalance"],
      interfaceSpecs: ["IF_ACCOUNT_BALANCE"],
      tags: ["legacy", "account"],
      variants: [
        {
          id: "account.list.mobile",
          label: "Account List Mobile",
          jsp: ["src/main/webapp/WEB-INF/jsp/account/list.jsp"],
          java: ["src/main/java/com/acme/account/AccountController.java"],
          tags: ["mobile"]
        }
      ]
    }
  ],
  plugins: [dynamicQueryPlugin(), interfacePlugin()],
  jsp: {
    astMode: "lightweight",
    webappRoot: "./src/main/webapp"
  }
});
