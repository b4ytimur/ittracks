CREATE TABLE `undo_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `undo_snapshot_account_idx` ON `undo_snapshot` (`account_id`);