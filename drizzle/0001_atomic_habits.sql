CREATE TABLE `app_value` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `craving` (
	`id` text PRIMARY KEY NOT NULL,
	`habit_id` text NOT NULL,
	`date` text NOT NULL,
	`time` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`habit_id`) REFERENCES `habit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `habit_identity` (
	`habit_id` text NOT NULL,
	`identity_id` text NOT NULL,
	PRIMARY KEY(`habit_id`, `identity_id`),
	FOREIGN KEY (`habit_id`) REFERENCES `habit`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`identity_id`) REFERENCES `identity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `identity` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`statement` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_endpoint_unique` ON `push_subscription` (`endpoint`);--> statement-breakpoint
CREATE TABLE `reminder_sent` (
	`habit_id` text NOT NULL,
	`date` text NOT NULL,
	PRIMARY KEY(`habit_id`, `date`),
	FOREIGN KEY (`habit_id`) REFERENCES `habit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `habit` ADD `cue` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `streak_rule` text DEFAULT '{"kind":"strict"}' NOT NULL;--> statement-breakpoint
ALTER TABLE `habit` ADD `minimum_counts` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `habit` ADD `levels` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `quick_done` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `habit` ADD `remind` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `habit` ADD `if_then` text;--> statement-breakpoint
ALTER TABLE `habit` ADD `triggers` text;--> statement-breakpoint
ALTER TABLE `occurrence` ADD `level` text;--> statement-breakpoint
ALTER TABLE `slip` ADD `time` text;--> statement-breakpoint
ALTER TABLE `slip` ADD `place` text;--> statement-breakpoint
ALTER TABLE `slip` ADD `feeling` text;--> statement-breakpoint
ALTER TABLE `slip` ADD `with_whom` text;--> statement-breakpoint
ALTER TABLE `slot` ADD `min_targets` text;--> statement-breakpoint
ALTER TABLE `slot` ADD `stretch_targets` text;