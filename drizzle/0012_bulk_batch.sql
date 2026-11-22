CREATE TABLE `bulk_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`action` text NOT NULL,
	`request` text NOT NULL,
	`summary` text NOT NULL,
	`undo` text NOT NULL,
	`created_at` integer NOT NULL,
	`undone_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bulk_batch_account_idx` ON `bulk_batch` (`account_id`,`created_at`);