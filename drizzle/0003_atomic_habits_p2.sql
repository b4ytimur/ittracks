CREATE TABLE `prep_tick` (
	`habit_id` text NOT NULL,
	`date` text NOT NULL,
	`item` text NOT NULL,
	PRIMARY KEY(`habit_id`, `date`, `item`),
	FOREIGN KEY (`habit_id`) REFERENCES `habit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `habit` ADD `reframe` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `bundle` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `prep` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `reward` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `cost` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `limit` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `progression` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `progression_from` text;