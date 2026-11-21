// A tiny zip writer for exports: files stored as they are (no compression), which every
// unzip tool and Obsidian vault folder reads. Text exports are small, so this keeps the
// app free of another dependency.

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

export function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** DOS date and time, as zip headers keep them. */
function dosTime(d: Date): { time: number; date: number } {
	return {
		time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
		date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
	};
}

/** Build a zip file from names and text (UTF-8). */
export function zip(files: { name: string; text: string }[], when = new Date()): Uint8Array {
	const enc = new TextEncoder();
	const { time, date } = dosTime(when);
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const f of files) {
		const name = enc.encode(f.name);
		const data = enc.encode(f.text);
		const crc = crc32(data);
		const head = new Uint8Array(30 + name.length);
		const h = new DataView(head.buffer);
		h.setUint32(0, 0x04034b50, true);
		h.setUint16(4, 20, true); // version needed
		h.setUint16(6, 0x0800, true); // names are UTF-8
		h.setUint16(8, 0, true); // stored
		h.setUint16(10, time, true);
		h.setUint16(12, date, true);
		h.setUint32(14, crc, true);
		h.setUint32(18, data.length, true);
		h.setUint32(22, data.length, true);
		h.setUint16(26, name.length, true);
		head.set(name, 30);
		local.push(head, data);

		const c = new Uint8Array(46 + name.length);
		const v = new DataView(c.buffer);
		v.setUint32(0, 0x02014b50, true);
		v.setUint16(4, 20, true);
		v.setUint16(6, 20, true);
		v.setUint16(8, 0x0800, true);
		v.setUint16(10, 0, true);
		v.setUint16(12, time, true);
		v.setUint16(14, date, true);
		v.setUint32(16, crc, true);
		v.setUint32(20, data.length, true);
		v.setUint32(24, data.length, true);
		v.setUint16(28, name.length, true);
		v.setUint32(42, offset, true);
		c.set(name, 46);
		central.push(c);
		offset += head.length + data.length;
	}
	const centralSize = central.reduce((n, c) => n + c.length, 0);
	const end = new Uint8Array(22);
	const e = new DataView(end.buffer);
	e.setUint32(0, 0x06054b50, true);
	e.setUint16(8, files.length, true);
	e.setUint16(10, files.length, true);
	e.setUint32(12, centralSize, true);
	e.setUint32(16, offset, true);
	const out = new Uint8Array(offset + centralSize + 22);
	let p = 0;
	for (const part of [...local, ...central, end]) {
		out.set(part, p);
		p += part.length;
	}
	return out;
}
