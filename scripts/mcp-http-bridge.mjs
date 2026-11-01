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

import {
  buildGroupedTools,
  extractActionAndParams,
  loadGroupConfig,
  prepareArgs,
  resolveAction,
  schemaOf,
  actionOf,
  paramSignature,
  GROUPS_FILE,
} from './tool-groups.mjs';

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
  const out = { port: 38471, server: join(REPO_ROOT, 'dist', 'index.js'), grouped: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--server') out.server = resolve(argv[++i]);
    else if (a === '--grouped') out.grouped = true;
    else if (a === '--flat') out.grouped = false;
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

// ---------------------------------------------------------------------------
// 1b. Grouped surface: 120 flat tools -> 12 "category tool + action" tools.
//     Controlled by ~/.photoshop-mcp/tool-groups.json (hot reloaded) and the
//     --grouped / --flat flags.
// ---------------------------------------------------------------------------
function groupedModeEnabled() {
  if (args.grouped === true) return true;
  if (args.grouped === false) return false;
  return loadGroupConfig().enabled !== false;
}

let groupedMemo = null;
function groupedSurface() {
  const cfg = loadGroupConfig();
  const key = `${toolCache.map((t) => t.name).join('|')}#raw:${cfg.rawTool !== false}`;
  if (groupedMemo && groupedMemo.key === key) return groupedMemo;
  const built = buildGroupedTools(toolCache, cfg);
  const counts = {};
  for (const [name, map] of built.index) counts[name] = map.size;
  groupedMemo = { key, tools: built.tools, index: built.index, counts };
  log(
    `grouped surface: ${built.tools.length} tools covering ${Object.keys(counts).length} groups ` +
      `(${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ')})`
  );
  return groupedMemo;
}

function textError(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function forwardTool(name, toolArgs, meta, signal) {
  if (loadDenylist().has(name)) {
    return textError(
      `Tool ${name} is disabled by ~/.photoshop-mcp/tool-filter.json (unsupported by this Photoshop build).`
    );
  }
  try {
    return await child.callTool({ name, arguments: toolArgs ?? {}, _meta: meta }, undefined, {
      signal,
      timeout: 15 * 60 * 1000,
    });
  } catch (err) {
    const message = err?.message ?? String(err);
    log(`callTool ${name} failed: ${message}`);
    return textError(`Tool ${name} failed: ${message}`);
  }
}

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
      await refreshTools();
    } catch (err) {
      log('listTools failed, serving cache:', err?.message ?? String(err));
    }
    if (!groupedModeEnabled()) return { tools: toolCache };
    return { tools: groupedSurface().tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: toolArgs, _meta } = request.params;

    if (groupedModeEnabled()) {
      const surface = groupedSurface();

      if (name === 'photoshop_schema') {
        const wanted = toolArgs?.action ?? '';
        const tool = resolveAction(toolCache, wanted);
        if (!tool) {
          return textError(
            `Unknown action "${wanted}". Use "<group>/<action>" (e.g. "layer/get_layers") or the raw tool name.`
          );
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  action: actionOf(tool.name),
                  tool: tool.name,
                  signature: paramSignature(tool),
                  description: tool.description,
                  schema: schemaOf(tool),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (name === 'photoshop_call') {
        const target = resolveAction(toolCache, toolArgs?.tool);
        if (!target) {
          return textError(
            `Unknown tool "${toolArgs?.tool}". Call a group tool instead, or use photoshop_schema to look up the exact name.`
          );
        }
        const prepared = prepareArgs(target, toolArgs?.arguments ?? {});
        if (!prepared.ok) return textError(prepared.message);
        return forwardTool(target.name, prepared.args, _meta, extra?.signal);
      }

      const actions = surface.index.get(name);
      if (actions) {
        const { action, params } = extractActionAndParams(toolArgs);
        if (!action) {
          return textError(`Missing "action". Available: ${[...actions.keys()].join(', ')}`);
        }
        let tool = actions.get(action);
        if (!tool) {
          // Tolerate an action that belongs to a sibling group.
          tool = resolveAction(toolCache, action);
        }
        if (!tool) {
          return textError(
            `Unknown action "${action}" for ${name}. Available: ${[...actions.keys()].join(', ')}`
          );
        }
        const prepared = prepareArgs(tool, params);
        if (!prepared.ok) return textError(prepared.message);
        return forwardTool(tool.name, prepared.args, _meta, extra?.signal);
      }
    }

    return forwardTool(name, toolArgs, _meta, extra?.signal);
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
    const grouped = groupedModeEnabled();
    const surface = grouped ? groupedSurface() : null;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        mode: grouped ? 'grouped' : 'flat',
        exposed: surface ? surface.tools.length : toolCache.length,
        upstreamTools: toolCache.length,
        groups: surface ? surface.counts : undefined,
        config: GROUPS_FILE,
        upstream: info ?? null,
      })
    );
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
  const grouped = groupedModeEnabled();
  const surface = grouped ? groupedSurface() : null;
  log(`bridge ready: http://127.0.0.1:${args.port}/mcp  (health: /health)`);
  process.stdout.write(
    [
      '',
      'Photoshop MCP bridge is ready.',
      `  MCP endpoint : http://127.0.0.1:${args.port}/mcp`,
      `  Health check : http://127.0.0.1:${args.port}/health`,
      `  Upstream     : ${args.server}`,
      `  Tool surface : ${grouped ? `grouped (${surface.tools.length} tools / ${toolCache.length} upstream)` : `flat (${toolCache.length} tools)`}`,
      grouped ? `  Group config : ${GROUPS_FILE}  (edit to switch to flat: "enabled": false)` : '',
      '',
      'Keep this window open. In WorkBuddy: 连接器 → 自定义连接器 → 信任 photoshop.',
      '',
    ]
      .filter(Boolean)
      .join('\n')
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
