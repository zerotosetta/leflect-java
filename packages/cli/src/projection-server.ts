import fs from "fs/promises";
import http from "http";
import path from "path";
import { spawn } from "child_process";

import {
  buildProjectionGraph,
  loadProjectionEntry,
  loadProjectionSnapshot,
  loadProjectionFileDetail,
  loadProjectionTreeAncestors,
  queryProjectionEntries,
  queryProjectionFiles,
  queryProjectionTreeChildren
} from "./projection";
import { loadProjectionAstGraph } from "./projection-ast";

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
  serveUi?: boolean;
}): Promise<void> {
  const { appDir, config, host, port, mode } = options;
  const serveUi = options.serveUi ?? true;
  const distDir = path.join(appDir, "dist");
  if (serveUi && (mode === "development" || !(await pathExists(path.join(distDir, "index.html"))))) {
    await runViteBuild(appDir, config.root, config.analysisOut, options.configPath);
  }

  const snapshot = await loadProjectionSnapshot(config.analysisOut, path.basename(config.root), config.root);
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
            entries: snapshot.entries.length,
            edges: snapshot.edgeCount,
            classes: snapshot.summary.counts.classes,
            methods: snapshot.summary.counts.methods
          },
          defaultEntryId: snapshot.defaultEntryId,
          defaultFile:
            snapshot.entries.find((entry) => entry.id === snapshot.defaultEntryId)?.focusPath ??
            snapshot.files.find((entry) => entry.nodeType === "jsp")?.path ??
            snapshot.files[0]?.path,
          tabs: [
            { id: "dependency-tree", label: "Dependency Tree" },
            { id: "tree-view", label: "Tree View" },
            { id: "entries", label: "Entries" }
          ]
        });
        return;
      }

      if (url.pathname === "/api/entries") {
        const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
        sendJson(
          response,
          200,
          queryProjectionEntries(snapshot, {
            offset: Number.isFinite(offset) ? offset : 0,
            limit: Number.isFinite(limit) ? limit : 100,
            search: url.searchParams.get("search") ?? undefined
          })
        );
        return;
      }

      if (url.pathname === "/api/entry-detail") {
        const entry = loadProjectionEntry(snapshot, {
          id: url.searchParams.get("id") ?? undefined,
          focusPath: url.searchParams.get("focusPath") ?? undefined
        });
        if (!entry) {
          sendJson(response, 404, { error: "Entry not found" });
          return;
        }
        sendJson(response, 200, { entry });
        return;
      }

      if (url.pathname === "/api/files") {
        const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "200", 10);
        const nodeType = url.searchParams.get("nodeType");
        sendJson(
          response,
          200,
          queryProjectionFiles(snapshot, {
            offset: Number.isFinite(offset) ? offset : 0,
            limit: Number.isFinite(limit) ? limit : 200,
            nodeType: nodeType === "java" || nodeType === "jsp" ? nodeType : "all",
            search: url.searchParams.get("search") ?? undefined,
            classpathPrefix: url.searchParams.get("classpathPrefix") ?? undefined
          })
        );
        return;
      }

      if (url.pathname === "/api/tree") {
        const mode = url.searchParams.get("mode");
        if (mode !== "classpath" && mode !== "directory") {
          sendJson(response, 400, { error: "Query parameter 'mode' must be 'classpath' or 'directory'" });
          return;
        }

        const nodeType = url.searchParams.get("nodeType");
        sendJson(
          response,
          200,
          queryProjectionTreeChildren(snapshot, {
            mode,
            parentId: url.searchParams.get("parentId") ?? undefined,
            nodeType: nodeType === "java" || nodeType === "jsp" ? nodeType : "all",
            search: url.searchParams.get("search") ?? undefined
          })
        );
        return;
      }

      if (url.pathname === "/api/tree-ancestors") {
        const mode = url.searchParams.get("mode");
        const targetPath = url.searchParams.get("path");
        if (mode !== "classpath" && mode !== "directory") {
          sendJson(response, 400, { error: "Query parameter 'mode' must be 'classpath' or 'directory'" });
          return;
        }
        if (!targetPath) {
          sendJson(response, 400, { error: "Query parameter 'path' is required" });
          return;
        }
        sendJson(response, 200, loadProjectionTreeAncestors(snapshot, { mode, path: targetPath }));
        return;
      }

      if (url.pathname === "/api/dependency-graph") {
        const targetPath = url.searchParams.get("path");
        const entryId = url.searchParams.get("entryId") ?? undefined;
        if (!targetPath && !entryId) {
          sendJson(response, 400, { error: "Query parameter 'path' or 'entryId' is required" });
          return;
        }
        const rawDepth = url.searchParams.get("depth");
        const parsedDepth = rawDepth ? Number.parseInt(rawDepth, 10) : Number.NaN;
        const rawMaxNodes = url.searchParams.get("maxNodes");
        const parsedMaxNodes = rawMaxNodes ? Number.parseInt(rawMaxNodes, 10) : Number.NaN;
        const edgeKinds = (url.searchParams.get("edgeKinds") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        sendJson(
          response,
          200,
          buildProjectionGraph(snapshot, {
            focusPath: targetPath ?? undefined,
            entryId,
            depth: Number.isFinite(parsedDepth) ? parsedDepth : undefined,
            maxNodes: Number.isFinite(parsedMaxNodes) ? parsedMaxNodes : undefined,
            edgeKinds: edgeKinds.length > 0 ? edgeKinds as Array<"call" | "import" | "type" | "tag"> : undefined
          })
        );
        return;
      }

      if (url.pathname === "/api/ast-graph") {
        const targetPath = url.searchParams.get("path");
        if (!targetPath) {
          sendJson(response, 400, { error: "Query parameter 'path' is required" });
          return;
        }
        sendJson(
          response,
          200,
          await loadProjectionAstGraph(snapshot, {
            focusPath: targetPath,
            includeExternal: url.searchParams.get("includeExternal") === "true"
          })
        );
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

      if (!serveUi) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
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
      if (serveUi) {
        console.log(`Projection server using analysis output: ${config.analysisOut}`);
        console.log(`Projection app: ${appDir}`);
        console.log(`Open http://${host}:${port}`);
        return;
      }

      console.log(`Projection API server using analysis output: ${config.analysisOut}`);
      console.log(`Projection app source: ${appDir}`);
      console.log(`API endpoint http://${host}:${port}`);
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
  const vitePackagePath = require.resolve("vite/package.json", { paths: [appDir] });
  return path.join(path.dirname(vitePackagePath), "bin", "vite.js");
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
