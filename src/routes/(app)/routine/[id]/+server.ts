// A routine has no page of its own: its day is its log. Old links go there.
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => redirect(308, `/log/${params.id}`);
