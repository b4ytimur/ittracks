// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Actor } from '$lib/server/core/actor';

declare global {
	namespace App {
		interface Locals {
			account: { id: string; username: string } | null;
			/** Set for a quick-log link opened with a key (?key=itk_…) instead of a login. */
			actor?: Actor;
		}
	}
}

export {};
