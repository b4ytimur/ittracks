ALTER TABLE `habit` ADD `unlogged` text DEFAULT 'missed' NOT NULL;--> statement-breakpoint
ALTER TABLE `habit` ADD `settled_through` text;--> statement-breakpoint
ALTER TABLE `occurrence` ADD `extra` integer DEFAULT false NOT NULL;