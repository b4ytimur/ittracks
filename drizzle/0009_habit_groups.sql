ALTER TABLE `habit` ADD `parent_id` text REFERENCES habit(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `occurrence` ADD `rollup` text;