import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode, McpError, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { isAllowedCrateTool } from "./allowlist.js";

export interface CrateProxyOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface CrateProxy {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: unknown): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** A stdio MCP client to Crate that shows and forwards allowlisted tools only. */
export function createCrateProxy(opts: CrateProxyOptions): CrateProxy {
  const timeout = opts.timeoutMs;
  let current: Promise<Client> | undefined;

  function spawn(): Promise<Client> {
    const client = new Client({ name: "aircheck-bridge", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      // No API keys reach the child, so no key-gated Crate server can switch on. (The SDK also
      // passes LOGNAME, SHELL, TERM and USER; none is a credential.)
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/", NODE_ENV: "production" },
      // ponytail: Crate's stderr is dropped so its own logging cannot put arguments in journald (Hard Rule 8).
      stderr: "ignore",
    });
    const ready = client.connect(transport, { timeout }).then(() => client);
    // Respawn: forget a child that exits or fails to start; the next call spawns a fresh one.
    const forget = () => {
      if (current === ready) current = undefined;
    };
    client.onclose = forget;
    ready.catch(() => {
      forget();
      void transport.close();
    });
    return ready;
  }

  const client = () => (current ??= spawn());

  return {
    async listTools() {
      const c = await client();
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do {
        const page = await c.listTools(cursor ? { cursor } : undefined, { timeout });
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return tools.filter((t) => isAllowedCrateTool(t.name));
    },

    async callTool(name, args) {
      if (!isAllowedCrateTool(name)) throw new McpError(ErrorCode.InvalidParams, `Tool ${name} is not available`);
      const c = await client();
      // The SDK rejects with an McpError (RequestTimeout) and cancels the call if Crate hangs.
      const result = await c.callTool({ name, arguments: args as Record<string, unknown> | undefined }, undefined, {
        timeout,
      });
      return result as CallToolResult;
    },

    async close() {
      const c = current;
      current = undefined;
      await (await c?.catch(() => undefined))?.close();
    },
  };
}
