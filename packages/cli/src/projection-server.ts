import fs from "fs/promises";
import http from "http";
import path from "path";
import { spawn } from "child_process";

import { buildProjectionGraph, loadProjectionFileDetail, loadProjectionSnapshot, ProjectionDirection } from "./projection";

export async function runProjectionServer(options: {
  appDir: string;
  config: {
    root: string;
    analysisOut: string;
  };
  configPath: string;
  host: string;
  port: number;
  mode: "development" | "production";
}): Promise<void> {
  const { appDir, config, host, port, mode } = options;
  const distDir = path.join(appDir, "dist");
  if (mode === "development" || !(await pathExists(path.join(distDir, "index.html")))) {
    await runViteBuild(appDir, config.root, config.analysisOut, options.configPath);
  }

  const snapshot = await loadProjectionSnapshot(config.analysisOut, path.basename(config.root));
  const server = http.createServer(async (request, response) => {
    try {
      if (!request.url) {
        sendJson(response, 400, { error: "Missing request url" });
        return;
      }

      const url = new URL(request.url, `http://${host}:${port}`);
      if (url.pathname === "/api/bootstrap") {
        sendJson(response, 200, {
          projectName: snapshot.projectName,
          analysisOut: snapshot.analysisOut,
          counts: {
            totalFiles: snapshot.files.length,
            javaFiles: snapshot.files.filter((entry) => entry.nodeType === "java").length,
            jspFiles: snapshot.files.filter((entry) => entry.nodeType === "jsp").length,
            edges: snapshot.edgeCount,
            classes: snapshot.summary.counts.classes,
            methods: snapshot.summary.counts.methods
          },
          defaultFile: snapshot.files.find((entry) => entry.nodeType === "jsp")?.path ?? snapshot.files[0]?.path,
          tabs: [{ id: "dependency-tree", label: "Dependency Tree" }]
        });
        return;
      }

      if (url.pathname === "/api/files") {
        sendJson(response, 200, { files: snapshot.files });
        return;
      }

      if (url.pathname === "/api/dependency-graph") {
        const targetPath = url.searchParams.get("path");
        if (!targetPath) {
          sendJson(response, 400, { error: "Query parameter 'path' is required" });
          return;
        }
        const depth = Number.parseInt(url.searchParams.get("depth") ?? "2", 10);
        const direction = parseDirection(url.searchParams.get("direction"));
        sendJson(response, 200, buildProjectionGraph(snapshot, targetPath, direction, Number.isFinite(depth) ? depth : 2));
        return;
      }

      if (url.pathname === "/api/file-detail") {
        const targetPath = url.searchParams.get("path");
        if (!targetPath) {
          sendJson(response, 400, { error: "Query parameter 'path' is required" });
          return;
        }
        sendJson(response, 200, await loadProjectionFileDetail(snapshot, targetPath));
        return;
      }

      await serveStatic(distDir, url.pathname, response);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      console.log(`Projection server using analysis output: ${config.analysisOut}`);
      console.log(`Projection app: ${appDir}`);
      console.log(`Open http://${host}:${port}`);
    });

    const shutdown = () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function runViteBuild(appDir: string, root: string, analysisOut: string, configPath: string): Promise<void> {
  const viteBin = resolveViteCliEntrypoint(appDir);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin, "build"], {
      cwd: appDir,
      stdio: "inherit",
      env: {
        ...process.env,
        LEFLECT_DASHBOARD_ROOT: root,
        LEFLECT_DASHBOARD_ANALYSIS_OUT: analysisOut,
        LEFLECT_DASHBOARD_CONFIG_PATH: configPath,
        LEFLECT_DASHBOARD_PROJECT: path.basename(root)
      }
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code && code !== 0) {
        reject(new Error(`Projection app build exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function serveStatic(distDir: string, pathname: string, response: http.ServerResponse): Promise<void> {
  const normalizedPath = pathname === "/" ? "index.html" : path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^\/+/, "");
  const candidate = path.join(distDir, normalizedPath);
  const isHtmlNavigation = !path.extname(normalizedPath);
  const filePath = await pathExists(candidate)
    ? candidate
    : isHtmlNavigation
      ? path.join(distDir, "index.html")
      : undefined;
  if (!filePath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const content = await fs.readFile(filePath);
  response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
  response.end(content);
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function resolveViteCliEntrypoint(appDir: string): string {
  return require.resolve("vite/bin/vite.js", { paths: [appDir] });
}

function parseDirection(value: string | null): ProjectionDirection {
  return value === "inbound" || value === "outbound" || value === "both" ? value : "both";
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
