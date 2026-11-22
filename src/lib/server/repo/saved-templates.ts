// Templates saved to your own Gallery: the file a download would give, kept on the server.
// Read back through the same parser as an imported file, so a saved one adds exactly as the
// downloaded file would.
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { savedTemplate } from '../db/schema';
import { templateFile, type TemplateFile } from '$lib/template';

export interface SavedTemplate {
	id: string;
	template: TemplateFile;
	createdAt: Date;
}

/** Keep a template in the account's Gallery. Returns its id. */
export function saveTemplate(accountId: string, file: TemplateFile): string {
	const id = randomUUID();
	db.insert(savedTemplate).values({ id, accountId, name: file.name, file, createdAt: new Date() }).run();
	return id;
}

const read = (r: typeof savedTemplate.$inferSelect): SavedTemplate | null => {
	const parsed = templateFile.safeParse(r.file);
	return parsed.success ? { id: r.id, template: parsed.data, createdAt: r.createdAt } : null;
};

/** The account's saved templates, newest first. One this server can no longer read is left out. */
export function listSavedTemplates(accountId: string): SavedTemplate[] {
	return db
		.select()
		.from(savedTemplate)
		.where(eq(savedTemplate.accountId, accountId))
		.orderBy(desc(savedTemplate.createdAt))
		.all()
		.flatMap((r) => read(r) ?? []);
}

export function getSavedTemplate(accountId: string, id: string): SavedTemplate | null {
	const r = db
		.select()
		.from(savedTemplate)
		.where(and(eq(savedTemplate.id, id), eq(savedTemplate.accountId, accountId)))
		.get();
	return r ? read(r) : null;
}

export function deleteSavedTemplate(accountId: string, id: string): boolean {
	return db.delete(savedTemplate).where(and(eq(savedTemplate.id, id), eq(savedTemplate.accountId, accountId))).run().changes > 0;
}
