import { defineConfig } from "@leflect-java/core";

export default defineConfig({
  analysisOut: "./analysis",
  ignoreFile: "./.gitignore",
  labelsOut: "./analysis/index/labels.json",
  classpathDiscovery: {
    enabled: true,
    maxRetries: 5
  },
  entryFiles: {
    jsp: [
      "^kfs-web/src/main/webapp/jsp/.+\\.jsp$",
      "^kfs-web/src/main/webapp/WEB-INF/jsp/.+\\.jsp$"
    ]
  },
  entries: [
    {
      id: "kfs.fp.disbursement-voucher",
      type: "virtual_page",
      label: "KFS FP Disbursement Voucher",
      description: "Representative Financial Processing document screen.",
      jsp: ["kfs-web/src/main/webapp/jsp/fp/DisbursementVoucher.jsp"],
      tags: ["kfs", "fp", "document"]
    },
    {
      id: "kfs.ar.customer-invoice",
      type: "virtual_page",
      label: "KFS AR Customer Invoice",
      description: "Representative Accounts Receivable document screen.",
      jsp: ["kfs-web/src/main/webapp/jsp/module/ar/CustomerInvoiceDocument.jsp"],
      tags: ["kfs", "ar", "document"]
    },
    {
      id: "kfs.tem.travel-reimbursement",
      type: "virtual_page",
      label: "KFS TEM Travel Reimbursement",
      description: "Representative Travel and Entertainment document screen.",
      jsp: ["kfs-web/src/main/webapp/jsp/module/tem/TravelReimbursement.jsp"],
      tags: ["kfs", "tem", "document"]
    }
  ],
  java: {
    mavenCommand: "./.leflect/mvn-kfs-web.sh"
  },
  jsp: {
    astMode: "jasper",
    webappRoot: "./kfs-web/src/main/webapp",
    generatedJavaOut: "./analysis/generated-jsp-java",
    astOut: "./analysis/jsp-ast",
    mavenCommand: "./.leflect/mvn-kfs-web.sh"
  }
});
