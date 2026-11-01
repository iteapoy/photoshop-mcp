#!/usr/bin/env node
/**
 * MCP HTTP bridge for photoshop-mcp.
 *
 * Why this exists
 * ---------------
 * WorkBuddy's own process cannot send Apple events (its Info.plist has no
 * NSAppleEventsUsageDescription), so every `tell application "Adobe Photoshop"`
 * fails with -10004 when the MCP server is spawned directly by WorkBuddy.
 *
 * This bridge is started from Terminal (or any process outside WorkBuddy's
 * tree). It spawns the real stdio MCP server as a child — so the osascript
 * calls inherit Terminal's TCC identity and Apple events work — and exposes
 * the whole tool set over Streamable HTTP at http://127.0.0.1:<port>/mcp,
 * which WorkBuddy can connect to as a custom connector:
 *
 *   { "mcpServers": { "photoshop": { "type": "http",
 *       "url": "http://127.0.0.1:38471/mcp" } } }
 *
 * No browser UI is involved. The UI (dist/ui/cli.js) is a separate, optional
 * chat client; the tools do not depend on it.
 *
 * Usage: node scripts/mcp-http-bridge.mjs [--port 38471] [--server <dist/index.js>]
 */

import { createServer } from 'node:http';
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const LOG_FILE = join(homedir(), '.photoshop-mcp', 'bridge.log');

// Same config the UI uses, so both surfaces hide the same unusable tools.
const FILTER_FILE = join(homedir(), '.photoshop-mcp', 'tool-filter.json');
const DEFAULT_DENYLIST = [
  'photoshop_generative_fill',
  'photoshop_generative_remove',
  'photoshop_generative_expand',
  'photoshop_generative_upscale',
  'photoshop_generate_image',
  'photoshop_sky_replacement',
  'photoshop_neural_filter',
  'photoshop_submit_feedback',
];
let denyCache = new Set(DEFAULT_DENYLIST);
let denyStamp = -1;

function loadDenylist() {
  let stamp = 0;
  try {
    stamp = statSync(FILTER_FILE).mtimeMs;
  } catch {
    stamp = 0;
  }
  if (stamp === denyStamp) return denyCache;
  let list = DEFAULT_DENYLIST;
  try {
    const raw = JSON.parse(readFileSync(FILTER_FILE, 'utf8'));
    if (Array.isArray(raw.denylist)) list = raw.denylist;
  } catch {
    /* keep defaults */
  }
  denyCache = new Set(list);
  denyStamp = stamp;
  return denyCache;
}

function parseArgs(argv) {
  const out = { port: 38471, server: join(REPO_ROOT, 'dist', 'index.js') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--server') out.server = resolve(argv[++i]);
  }
  return out;
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  process.stderr.write(line + '\n');
  try {
    appendFileSync(LOG_FILE, line + '\n');
  } catch {
    /* logging must never break the bridge */
  }
}

const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// 1. Spawn the real MCP server over stdio (this is the process that talks to PS)
// ---------------------------------------------------------------------------
const childEnv = { ...process.env };
// Keep the child quiet-ish but let MCP protocol traffic flow on stdout.
delete childEnv.MCP_HTTP_BRIDGE;

const childTransport = new StdioClientTransport({
  command: process.execPath,
  args: [args.server],
  env: childEnv,
  stderr: 'inherit',
});

const child = new Client({ name: 'photoshop-mcp-bridge', version: '1.0.0' }, { capabilities: {} });
await child.connect(childTransport);
log('spawned stdio MCP server:', args.server);

const info = child.getServerVersion();
log('upstream server:', JSON.stringify(info ?? {}));

// Cache the tool list so the bridge still answers if the child is busy.
let toolCache = [];
async function refreshTools() {
  const res = await child.listTools();
  const deny = loadDenylist();
  toolCache = (res.tools ?? []).filter((t) => !deny.has(t.name));
  return toolCache;
}
await refreshTools();
log(`upstream tools: ${toolCache.length}`);

child.onclose = () => log('upstream stdio server closed');
child.onerror = (err) => log('upstream error:', err?.message ?? String(err));

// ---------------------------------------------------------------------------
// 2. Build a fresh MCP Server per HTTP request (stateless mode) that forwards
//    everything to the child client.
// ---------------------------------------------------------------------------
function buildServer() {
  const server = new Server(
    { name: 'photoshop-mcp-bridge', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      return { tools: await refreshTools() };
    } catch (err) {
      log('listTools failed, serving cache:', err?.message ?? String(err));
      return { tools: toolCache };
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: toolArgs, _meta } = request.params;
    if (loadDenylist().has(name)) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool ${name} is disabled by ~/.photoshop-mcp/tool-filter.json (unsupported by this Photoshop build).`,
          },
        ],
        isError: true,
      };
    }
    try {
      const result = await child.callTool(
        { name, arguments: toolArgs ?? {}, _meta },
        undefined,
        { signal: extra?.signal, timeout: 15 * 60 * 1000 }
      );
      return result;
    } catch (err) {
      const message = err?.message ?? String(err);
      log(`callTool ${name} failed: ${message}`);
      return { content: [{ type: 'text', text: `Tool ${name} failed: ${message}` }], isError: true };
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    try {
      return await child.listPrompts();
    } catch {
      return { prompts: [] };
    }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return await child.getPrompt(request.params);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      return await child.listResources();
    } catch {
      return { resources: [] };
    }
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    try {
      return await child.listResourceTemplates();
    } catch {
      return { resourceTemplates: [] };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return await child.readResource(request.params);
  });

  return server;
}

// ---------------------------------------------------------------------------
// 3. Serve Streamable HTTP on loopback
// ---------------------------------------------------------------------------
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${args.port}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tools: toolCache.length, upstream: info ?? null }));
    return;
  }

  if (url.pathname !== '/mcp' && url.pathname !== '/mcp/') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }

  // Stateless: a new server+transport per request, no session state.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });

  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    log('http handler error:', err?.stack ?? String(err));
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: err?.message ?? 'bridge error' },
          id: null,
        })
      );
    }
  }
});

http.listen(args.port, '127.0.0.1', () => {
  log(`bridge ready: http://127.0.0.1:${args.port}/mcp  (health: /health)`);
  process.stdout.write(
    [
      '',
      'Photoshop MCP bridge is ready.',
      `  MCP endpoint : http://127.0.0.1:${args.port}/mcp`,
      `  Health check : http://127.0.0.1:${args.port}/health`,
      `  Upstream     : ${args.server}`,
      `  Tools        : ${toolCache.length}`,
      '',
      'Keep this window open. In WorkBuddy: 连接器 → 自定义连接器 → 信任 photoshop.',
      '',
    ].join('\n')
  );
});

http.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    log(`port ${args.port} already in use — another bridge is probably running`);
    process.exit(3);
  }
  log('http server error:', err?.message ?? String(err));
  process.exit(1);
});

async function shutdown(signal) {
  log(`shutting down (${signal})`);
  http.close();
  await child.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
