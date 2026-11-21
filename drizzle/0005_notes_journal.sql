CREATE TABLE `day_note` (
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `metric` ADD `long` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `metric` ADD `starter` text;--> statement-breakpoint
ALTER TABLE `metric` ADD `prompts` text;--> statement-breakpoint
ALTER TABLE `metric` ADD `prompt_order` text DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE `metric` ADD `scores` text;