import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The MCP script talks to a fake ittracks server here: it only needs the two action routes.
const catalog = {
	apiVersion: 1,
	actions: [
		{
			name: 'describe',
			version: 1,
			kind: 'read',
			title: 'Describe',
			description: 'What is tracked.',
			scope: 'read',
			input: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {} }
		},
		{
			name: 'values',
			version: 1,
			kind: 'read',
			title: 'Values',
			description: 'Raw values.',
			scope: 'read',
			input: { type: 'object', properties: { format: { type: 'string', enum: ['json', 'csv'] } } }
		},
		{
			name: 'log_value',
			version: 1,
			kind: 'write',
			title: 'Log a value',
			description: 'Adds a value.',
			scope: 'log',
			input: { type: 'object', properties: { habit: { type: 'string' }, value: { type: 'number' } }, required: ['habit', 'value'] }
		}
	]
};

const seen: { path: string; auth: string | undefined; client: string | undefined; body: unknown }[] = [];
let server: Server;
let base = '';

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const body = raw ? JSON.parse(raw) : undefined;
			seen.push({ path: req.url ?? '', auth: req.headers.authorization, client: req.headers['x-ittracks-client'] as string, body });
			res.setHeader('content-type', 'application/json');
			if (req.headers.authorization !== 'Bearer itk_test') {
				res.statusCode = 401;
				return res.end(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'That key is not valid.' } }));
			}
			if (req.url === '/api/v1/actions') return res.end(JSON.stringify({ ok: true, result: catalog }));
			if (req.url === '/api/v1/actions/describe') return res.end(JSON.stringify({ ok: true, result: { habits: [{ id: 'h1', name: 'Water' }] } }));
			if (req.url === '/api/v1/actions/values')
				return res.end(JSON.stringify({ ok: true, result: { rows: 2, csv: 'ref,date,value\nlog:a,2026-11-20,3\nlog:b,2026-11-21,5\n' } }));
			if (req.url === '/api/v1/actions/log_value') {
				res.statusCode = 404;
				return res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'No habit called Tea.' } }));
			}
			res.statusCode = 404;
			res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Unknown action.' } }));
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** Starts the script and returns a function that sends one message and waits for its answer. */
function start(env: Record<string, string>) {
	const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ['static/ittracks-mcp.mjs'], {
		env: { PATH: process.env.PATH ?? '', ...env }
	});
	let buffer = '';
	const waiting: ((v: unknown) => void)[] = [];
	child.stdout.on('data', (chunk) => {
		buffer += chunk;
		let i;
		while ((i = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, i);
			buffer = buffer.slice(i + 1);
			waiting.shift()?.(JSON.parse(line));
		}
	});
	const ask = (msg: unknown) =>
		new Promise<any>((resolve) => {
			waiting.push(resolve);
			child.stdin.write(typeof msg === 'string' ? msg + '\n' : JSON.stringify(msg) + '\n');
		});
	const tell = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n');
	return { ask, tell, stop: () => child.kill() };
}

describe('ittracks MCP server', () => {
	it('initializes, lists tools from the catalog and calls them with the key', async () => {
		const mcp = start({ ITTRACKS_URL: base + '/', ITTRACKS_KEY: 'itk_test' });
		try {
			const init = await mcp.ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
			expect(init.result.protocolVersion).toBe('2025-06-18');
			expect(init.result.serverInfo.name).toBe('ittracks');
			expect(init.result.capabilities.tools).toBeTruthy();
			expect(init.result.instructions).toContain('describe');
			mcp.tell({ jsonrpc: '2.0', method: 'notifications/initialized' });

			const unknownVersion = await mcp.ask({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
			expect(unknownVersion.result.protocolVersion).toBe('2025-06-18');

			const list = await mcp.ask({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
			const tools = list.result.tools;
			expect(tools.map((t: { name: string }) => t.name)).toEqual(['describe', 'values', 'log_value']);
			for (const t of tools) {
				expect(t.inputSchema.type).toBe('object');
				expect(t.inputSchema.$schema).toBeUndefined();
			}
			expect(tools[0].annotations.readOnlyHint).toBe(true);
			expect(tools[2].annotations.readOnlyHint).toBe(false);
			expect(tools[2].description).toContain("Changes the user's data");

			const described = await mcp.ask({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'describe', arguments: {} } });
			expect(described.result.isError).toBeUndefined();
			expect(JSON.parse(described.result.content[0].text)).toEqual({ habits: [{ id: 'h1', name: 'Water' }] });

			const csv = await mcp.ask({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'values', arguments: { format: 'csv' } } });
			expect(csv.result.content[0].text).toBe('{"rows":2}\n\nref,date,value\nlog:a,2026-11-20,3\nlog:b,2026-11-21,5\n');

			const failed = await mcp.ask({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'log_value', arguments: { habit: 'Tea', value: 1 } } });
			expect(failed.result.isError).toBe(true);
			expect(failed.result.content[0].text).toBe('No habit called Tea.');

			const unknown = await mcp.ask({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'delete_everything' } });
			expect(unknown.result.isError).toBe(true);

			const prompts = await mcp.ask({ jsonrpc: '2.0', id: 8, method: 'prompts/list' });
			expect(prompts.result.prompts.map((p: { name: string }) => p.name)).toEqual(['weekly_review', 'find_patterns']);
			const prompt = await mcp.ask({ jsonrpc: '2.0', id: 9, method: 'prompts/get', params: { name: 'weekly_review', arguments: { days: '14' } } });
			expect(prompt.result.messages[0].content.text).toContain('last 14 days');

			const missing = await mcp.ask({ jsonrpc: '2.0', id: 10, method: 'nope' });
			expect(missing.error.code).toBe(-32601);
			const parse = await mcp.ask('{not json');
			expect(parse.error.code).toBe(-32700);
			const ping = await mcp.ask({ jsonrpc: '2.0', id: 'p', method: 'ping' });
			expect(ping).toEqual({ jsonrpc: '2.0', id: 'p', result: {} });

			// Every call carried the key and said it came from MCP; the trailing slash was dropped.
			const calls = seen.filter((s) => s.auth === 'Bearer itk_test');
			expect(calls.every((s) => s.client === 'mcp' && s.path.startsWith('/api/v1/actions'))).toBe(true);
			expect(calls.find((s) => s.path === '/api/v1/actions/values')?.body).toEqual({ format: 'csv' });
		} finally {
			mcp.stop();
		}
	});

	it('explains a missing or wrong key instead of failing silently', async () => {
		const none = start({ ITTRACKS_URL: base });
		try {
			const list = await none.ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
			expect(list.error.message).toContain('ITTRACKS_KEY');
		} finally {
			none.stop();
		}
		const wrong = start({ ITTRACKS_URL: base, ITTRACKS_KEY: 'itk_wrong' });
		try {
			const list = await wrong.ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
			expect(list.error.message).toBe('That key is not valid.');
		} finally {
			wrong.stop();
		}
		const down = start({ ITTRACKS_URL: 'http://127.0.0.1:9', ITTRACKS_KEY: 'itk_test' });
		try {
			const list = await down.ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
			expect(list.error.message).toContain("Can't reach ittracks");
		} finally {
			down.stop();
		}
	});
});
