CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`hint` text NOT NULL,
	`scopes` text NOT NULL,
	`habit_ids` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_hash_unique` ON `api_token` (`hash`);--> statement-breakpoint
CREATE TABLE `event` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`at` integer NOT NULL,
	`type` text NOT NULL,
	`v` integer DEFAULT 1 NOT NULL,
	`habit_id` text,
	`date` text,
	`source` text NOT NULL,
	`token_id` text,
	`data` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_account_seq` ON `event` (`account_id`,`seq`);