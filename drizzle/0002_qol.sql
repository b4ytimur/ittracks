CREATE TABLE `area` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#2563eb' NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collection` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`filter` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collection_task` (
	`collection_id` text NOT NULL,
	`task_id` text NOT NULL,
	PRIMARY KEY(`collection_id`, `task_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pause` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`habit_id` text,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`habit_id`) REFERENCES `habit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `habit` ADD `area_id` text REFERENCES area(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `metric` ADD `prefill` text DEFAULT 'last' NOT NULL;--> statement-breakpoint
ALTER TABLE `metric` ADD `step` real;--> statement-breakpoint
ALTER TABLE `metric` ADD `required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `metric` ADD `quick` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `reminder_sent` ADD `again_at` text;--> statement-breakpoint
ALTER TABLE `task` ADD `area_id` text REFERENCES area(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `metric` SET `prefill` = 'blank' WHERE `type` = 'text';
