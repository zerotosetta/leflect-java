"use strict";
const api = require("leflect-java");
require("./runtime-contract.cjs")(api, "CommonJS").then(result => {
  process.stdout.write(JSON.stringify(result));
}, error => {
  globalThis.__leflectPackageProbe.finish();
  console.error(error); process.exitCode = 1;
});
