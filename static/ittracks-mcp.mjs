#!/usr/bin/env node
// ittracks MCP server: lets an AI assistant (Claude Desktop, Claude Code, Cursor, and other
// MCP clients) read, analyse and log your habits on your own ittracks server, with a key.
//
// No install: Node 18 or newer is all it needs. Download it from your server
// (https://<your server>/ittracks-mcp.mjs) or use static/ittracks-mcp.mjs from the repo.
//
//   ITTRACKS_URL=http://localhost:3000 ITTRACKS_KEY=itk_… node ittracks-mcp.mjs
//
// The tools come from the server (GET /api/v1/actions), so this file never needs to change
// when the server adds or changes an action, and a key only ever sees what it may do.
// It speaks MCP over stdio: one JSON-RPC message per line. Licensed AGPL-3.0, like ittracks.
import { createInterface } from 'node:readline';

const VERSION = '1.0.0';
const BASE = (process.env.ITTRACKS_URL || 'http://localhost:3000').replace(/\/+$/, '');
const KEY = process.env.ITTRACKS_KEY || process.env.ITTRACKS_TOKEN || '';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `ittracks is the user's own habit tracker. Use these tools to answer questions about their habits and logs, to analyse them, and to log things when they ask.

How to work with it:
1. Call describe first: it lists habits, Tasks, fields (with ids, types and units) and the date range of the data.
2. Let the server do the math. Use habit_summary for rates and streaks, series for any number over time (sums, averages, bests, volume, consistency; per day, week or month; split by habit, Task, muscle group or weekday), and correlate for links between two measures. Fetch raw rows (values, logs) only to look closer, and prefer format "csv" when you need many.
3. Cite what an answer rests on with the refs the tools return (log:<id>, slip:<id>, day:<date>, habit:<id>); record opens any of them. Say which date range you looked at.
4. Correlation is not causation, and small samples mislead: report n and the p-value correlate gives, and say when a result could be chance.
5. Only log when the user asks. Logging tools change data; say what you logged and the progress they report.
Notes and journal entries are only visible when the user's key has notes access.`;

const PROMPTS = {
	weekly_review: {
		description: 'Review the last week (or another period): what went well, what slipped, patterns, and one or two concrete suggestions, with refs.',
		arguments: [{ name: 'days', description: 'How many days to look back (default 7).', required: false }],
		text: (a) =>
			`Review my habits over the last ${Number(a.days) || 7} days. Start with describe, then habit_summary for the period and the period before it, and series where a trend matters. Tell me what went well, what slipped (and on which weekdays), any pattern worth knowing, and one or two concrete, small changes to try. Cite refs for specific days.`
	},
	find_patterns: {
		description: 'Look for links between habits and logged values (e.g. sleep vs training, mood vs exercise), with honest statistics.',
		arguments: [{ name: 'question', description: 'What to look into, e.g. "does sleep affect my lifting?"', required: false }],
		text: (a) =>
			`${a.question ? `Question: ${a.question}\n\n` : ''}Look for patterns in my data. Use describe to see what is tracked, then correlate pairs of measures that could plausibly be linked (try lag 1 for next-day effects), and habit_summary for weekday patterns. Report r, p and n for each finding, say which ones could be chance, and remind me that correlation is not causation. Cite refs for examples.`
	}
};

let catalog = null;
let catalogAt = 0;

async function api(path, body) {
	if (!KEY) throw new Error('No key. Set ITTRACKS_KEY to a key made in ittracks under Settings → Integrations.');
	let res;
	try {
		res = await fetch(BASE + path, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				authorization: `Bearer ${KEY}`,
				accept: 'application/json',
				'x-ittracks-client': 'mcp',
				...(body === undefined ? {} : { 'content-type': 'application/json' })
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch (e) {
		throw new Error(`Can't reach ittracks at ${BASE} (${e.cause?.code ?? e.message}). Is the server running, and is ITTRACKS_URL right?`);
	}
	let data;
	try {
		data = await res.json();
	} catch {
		throw new Error(`ittracks at ${BASE} answered ${res.status} without JSON. Is ITTRACKS_URL the address of your ittracks server?`);
	}
	if (!data.ok) throw new Error(data.error?.message || `ittracks answered ${res.status}.`);
	return data.result;
}

async function actions() {
	if (!catalog || Date.now() - catalogAt > 60_000) {
		catalog = await api('/api/v1/actions');
		catalogAt = Date.now();
	}
	return catalog.actions;
}

function schemaOf(input) {
	const { $schema, ...rest } = input || {};
	void $schema;
	return { type: 'object', ...rest };
}

const toolOf = (a) => ({
	name: a.name,
	title: a.title,
	description: a.kind === 'write' ? `${a.description} Changes the user's data.` : a.description,
	inputSchema: schemaOf(a.input),
	annotations: { title: a.title, readOnlyHint: a.kind === 'read', destructiveHint: false, idempotentHint: a.kind === 'read', openWorldHint: false }
});

/** Results as compact text: CSV as it is, everything else as JSON. */
function textOf(result) {
	if (result && typeof result === 'object' && typeof result.csv === 'string') {
		const { csv, ...meta } = result;
		return `${JSON.stringify(meta)}\n\n${csv}`;
	}
	return JSON.stringify(result);
}

async function handle(msg) {
	const { id, method, params = {} } = msg;
	switch (method) {
		case 'initialize': {
			const asked = params.protocolVersion;
			return {
				protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
				capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
				serverInfo: { name: 'ittracks', title: 'ittracks', version: VERSION },
				instructions: INSTRUCTIONS
			};
		}
		case 'ping':
			return {};
		case 'tools/list':
			return { tools: (await actions()).map(toolOf) };
		case 'tools/call': {
			const name = params.name;
			const known = (await actions()).find((a) => a.name === name);
			if (!known) return { content: [{ type: 'text', text: `Unknown tool ${name}. The key may not allow it.` }], isError: true };
			try {
				const result = await api(`/api/v1/actions/${encodeURIComponent(name)}`, params.arguments ?? {});
				return { content: [{ type: 'text', text: textOf(result) }] };
			} catch (e) {
				return { content: [{ type: 'text', text: e.message }], isError: true };
			}
		}
		case 'prompts/list':
			return { prompts: Object.entries(PROMPTS).map(([name, p]) => ({ name, description: p.description, arguments: p.arguments })) };
		case 'prompts/get': {
			const p = PROMPTS[params.name];
			if (!p) throw Object.assign(new Error(`Unknown prompt ${params.name}`), { code: -32602 });
			return { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.text(params.arguments ?? {}) } }] };
		}
		case 'resources/list':
			return { resources: [] };
		default:
			if (id === undefined) return undefined; // a notification, such as notifications/initialized
			throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
	}
}

function send(obj) {
	process.stdout.write(JSON.stringify(obj) + '\n');
}

async function one(msg) {
	if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
	try {
		const result = await handle(msg);
		if (msg.id === undefined) return undefined;
		return { jsonrpc: '2.0', id: msg.id, result };
	} catch (e) {
		if (msg.id === undefined) return undefined;
		return { jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: e.message } };
	}
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();
async function onLine(line) {
	if (!line.trim()) return;
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
		return;
	}
	if (Array.isArray(msg)) {
		const out = (await Promise.all(msg.map(one))).filter(Boolean);
		if (out.length) send(out);
	} else {
		const out = await one(msg);
		if (out) send(out);
	}
}
rl.on('line', (line) => {
	const p = onLine(line).finally(() => pending.delete(p));
	pending.add(p);
});
// The client closed stdin: answer what is still running, then stop.
rl.on('close', () => Promise.allSettled([...pending]).then(() => process.exit(0)));
if (!KEY) process.stderr.write('ittracks MCP: ITTRACKS_KEY is not set; tools will report how to set it.\n');
