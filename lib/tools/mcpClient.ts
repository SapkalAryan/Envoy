// lib/tools/mcpClient.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { PlanStep, StepResult } from '../types';
import fs from 'fs/promises';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config', 'mcp-servers.json');

interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface MCPRegistry {
  mcpServers: Record<string, MCPServerConfig>;
}

const clients = new Map<string, Client>();

async function loadRegistry(): Promise<MCPRegistry> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as MCPRegistry;
  } catch (err) {
    console.error('[mcp] config load failed:', (err as Error).message);
    return { mcpServers: {} };
  }
}

async function getClient(serverName: string): Promise<Client> {
  const existing = clients.get(serverName);
  if (existing) return existing;

  const registry = await loadRegistry();
  const config = registry.mcpServers[serverName];

  if (!config) {
    const available = Object.keys(registry.mcpServers).join(', ');
    throw new Error(`MCP server "${serverName}" not configured. Available: ${available}`);
  }

  console.log(`[mcp] connecting to "${serverName}"`);

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
  });

  const client = new Client(
    { name: 'envoy-agent', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  clients.set(serverName, client);
  console.log(`[mcp] connected to "${serverName}"`);
  return client;
}

export async function runMcpStep(step: PlanStep): Promise<StepResult> {
  const server = String(step.params.server || '');
  const toolName = String(step.params.tool || '');
  const args = (step.params.args as Record<string, unknown>) || {};

  if (!server) throw new Error('mcp step requires params.server');

  const client = await getClient(server);

  if (!toolName) {
    const tools = await client.listTools();
    return {
      output: {
        server,
        availableTools: tools.tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      },
    };
  }

  console.log(`[mcp] calling ${server}.${toolName}`, args);

  const result = await client.callTool({
    name: toolName,
    arguments: args,
  });

  return {
    output: {
      server,
      tool: toolName,
      result: result.content,
    },
  };
}

export async function listAvailableServers(): Promise<string[]> {
  const registry = await loadRegistry();
  return Object.keys(registry.mcpServers);
}

export async function closeAllMcpClients(): Promise<void> {
  for (const [name, client] of clients.entries()) {
    try {
      await client.close();
      console.log(`[mcp] closed "${name}"`);
    } catch {}
  }
  clients.clear();
}