import { randomUUID } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

import type { SourceResolutionLoggingConfig } from "@leflect-java/schema";

type LogFields = Record<string, unknown>;
export type LogLevel = "info" | "warn" | "error";
export type McpSystemLogger = (event: string, fields?: LogFields, level?: LogLevel) => void;

const maxPayloadBytes = 1024 * 1024;
const maxQueuedBytes = 4 * 1024 * 1024;

export class SourceMcpLog {
  private readonly sessionId = randomUUID();
  private pending = Promise.resolve();
  private queuedBytes = 0;
  private dropped = 0;
  private failed = false;
  private closed = false;

  private constructor(private readonly file: FileHandle, private readonly includePayloads: boolean) {}

  static async open(config: SourceResolutionLoggingConfig, configPath: string): Promise<SourceMcpLog | undefined> {
    try {
      const [configStat, logStat] = await Promise.all([
        fs.stat(configPath, { bigint: true }),
        fs.stat(config.path, { bigint: true }).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code === "ENOENT") return undefined;
          throw cause;
        })
      ]);
      const configAlias = logStat && logStat.ino !== 0n && logStat.dev === configStat.dev && logStat.ino === configStat.ino;
      if (!path.relative(configPath, config.path) || configAlias) {
        throw new Error("The log file path points to the MCP configuration file.");
      }
      if (logStat && !logStat.isFile()) throw new Error("The log destination must be a regular file.");
      await fs.mkdir(path.dirname(config.path), { recursive: true, mode: 0o700 });
      const file = await fs.open(config.path, "a+", 0o600);
      try {
        const { size } = await file.stat();
        if (size) {
          const lastByte = Buffer.alloc(1);
          const { bytesRead } = await file.read(lastByte, 0, 1, size - 1);
          if (bytesRead && lastByte[0] !== 0x0a) await file.write("\n");
        }
      } catch (cause) {
        await file.close().catch(() => undefined);
        throw cause;
      }
      return new SourceMcpLog(file, config.includePayloads === true);
    } catch (cause) {
      warn(cause);
      return undefined;
    }
  }

  system(context: LogFields = {}): McpSystemLogger {
    return (event, { detail, detailTruncated, ...fields } = {}, level = "info") => {
      this.record(event, { ...context, ...fields, ...(this.includePayloads ? { detail, detailTruncated } : {}) }, level);
    };
  }

  rpc(direction: "in" | "out", line: string, context: LogFields, level: LogLevel = "info"): void {
    const bytes = Buffer.byteLength(line);
    const payload = !this.includePayloads ? {} :
      bytes <= maxPayloadBytes ? { payload: line } : { payloadOmitted: "size" };
    this.record("rpc", { ...context, direction, bytes, ...payload }, level);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pending;
    if (this.dropped && !this.failed) {
      await this.append(this.encode("logging.dropped", { records: this.dropped }, "warn"));
    }
    await this.file.close().catch((cause) => this.fail(cause));
  }

  private record(event: string, fields: LogFields, level: LogLevel): void {
    if (this.failed || this.closed) return;
    try {
      const data = this.encode(event, fields, level);
      if (this.queuedBytes + data.length > maxQueuedBytes) {
        this.dropped += 1;
        return;
      }
      this.queuedBytes += data.length;
      this.pending = this.pending.then(async () => {
        if (!this.failed) await this.append(data);
        this.queuedBytes -= data.length;
      });
    } catch (cause) {
      this.fail(cause);
    }
  }

  private encode(event: string, fields: LogFields, level: LogLevel): Buffer {
    return Buffer.from(JSON.stringify({
      ...fields, schemaVersion: 1, time: new Date().toISOString(), sessionId: this.sessionId, event, level
    }) + "\n");
  }

  private async append(data: Buffer): Promise<void> {
    try {
      for (let offset = 0; offset < data.length;) {
        const { bytesWritten } = await this.file.write(data, offset, data.length - offset, null);
        if (bytesWritten === 0) throw new Error("The log write did not make progress.");
        offset += bytesWritten;
      }
    } catch (cause) {
      this.fail(cause);
    }
  }

  private fail(cause: unknown): void {
    if (this.failed) return;
    this.failed = true;
    warn(cause);
  }
}

function warn(cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`[leflect-mcp-log] Logging unavailable: ${message.replace(/[\r\n]/g, " ")}\n`);
}
