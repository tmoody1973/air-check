// Stands in for crate-cli in tests. Written from scratch; no Crate code is copied.
import { writeFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const schema = { type: "object", properties: { q: { type: "string" } } };
const tools = [
  "musicbrainz_echo",
  "telegraph_post",
  "musicbrainz_sleep",
  "musicbrainz_exit",
  "bandcamp_get_artist_page",
  "bandcamp_search_bandcamp",
  "bandcamp_get_fan_collection",
].map((name) => ({
  name,
  description: `fake ${name}`,
  inputSchema: schema,
}));

const server = new Server({ name: "fake-crate", version: "0.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const text = (t) => ({ content: [{ type: "text", text: t }] });
  switch (name) {
    case "musicbrainz_echo":
      return text(JSON.stringify({ args, discogs: process.env.DISCOGS_KEY ?? null, pid: process.pid }));
    case "telegraph_post":
      writeFileSync("telegraph-called", "yes"); // relative to the cwd the proxy gives the child
      return text("posted");
    case "bandcamp_get_artist_page":
    case "bandcamp_search_bandcamp":
    case "bandcamp_get_fan_collection":
      writeFileSync(`${name}-called`, "yes");
      return text("fetched");
    case "musicbrainz_sleep":
      await new Promise((r) => setTimeout(r, 10_000));
      return text("slept");
    case "musicbrainz_exit":
      process.exit(1);
  }
  throw new Error(`unknown tool ${name}`);
});
await server.connect(new StdioServerTransport());
