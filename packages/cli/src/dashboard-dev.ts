import { spawn, type ChildProcess } from "child_process";
import path from "path";

import { runProjectionServer } from "./projection-server";

type DashboardDevOptions = {
  appDir: string;
  config: {
    root: string;
    analysisOut: string;
  };
  configPath: string;
  host: string;
  apiPort: number;
  frontendPort: number;
};

export async function runDashboardDev(options: DashboardDevOptions): Promise<void> {
  const viteChild = startViteDevServer(options);
  const apiOrigin = `http://${options.host}:${options.apiPort}`;
  let tearingDown = false;

  const teardown = (): void => {
    if (tearingDown) {
      return;
    }
    tearingDown = true;

    if (viteChild.exitCode === null && !viteChild.killed) {
      viteChild.kill("SIGTERM");
    }
  };

  process.once("SIGINT", teardown);
  process.once("SIGTERM", teardown);

  try {
    console.log(`Dashboard dev UI: http://${options.host}:${options.frontendPort}`);
    console.log(`Dashboard dev API proxy: ${apiOrigin}`);

    const serverPromise = runProjectionServer({
      appDir: options.appDir,
      config: options.config,
      configPath: options.configPath,
      host: options.host,
      port: options.apiPort,
      mode: "production",
      serveUi: false
    });

    const viteExitPromise = waitForChildExit(viteChild, "Vite dev server");

    const winner = await Promise.race([
      serverPromise.then(() => ({ kind: "server" as const })),
      viteExitPromise.then((code) => ({ kind: "vite" as const, code }))
    ]);

    if (winner.kind === "vite") {
      throw new Error(`Vite dev server exited with code ${winner.code ?? 0}`);
    }

    await viteExitPromise;
  } finally {
    teardown();
  }
}

function startViteDevServer(options: DashboardDevOptions): ChildProcess {
  const vitePackagePath = require.resolve("vite/package.json", { paths: [options.appDir] });
  const viteBin = path.join(path.dirname(vitePackagePath), "bin", "vite.js");
  const apiOrigin = `http://${options.host}:${options.apiPort}`;

  return spawn(
    process.execPath,
    [viteBin, "dev", "--host", options.host, "--port", String(options.frontendPort)],
    {
      cwd: options.appDir,
      stdio: "inherit",
      env: {
        ...process.env,
        LEFLECT_DASHBOARD_API_ORIGIN: apiOrigin,
        LEFLECT_DASHBOARD_ROOT: options.config.root,
        LEFLECT_DASHBOARD_ANALYSIS_OUT: options.config.analysisOut,
        LEFLECT_DASHBOARD_CONFIG_PATH: options.configPath,
        LEFLECT_DASHBOARD_PROJECT: path.basename(options.config.root)
      }
    }
  );
}

function waitForChildExit(child: ChildProcess, label: string): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    child.once("error", (error) => {
      reject(new Error(`${label} failed to start: ${error.message}`));
    });

    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(null);
        return;
      }
      resolve(code);
    });
  });
}
