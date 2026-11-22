CREATE TABLE `task_part` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`child_task_id` text NOT NULL,
	`sets` integer,
	`targets` text,
	`min_targets` text,
	`stretch_targets` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_part_task_idx` ON `task_part` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_part_child_idx` ON `task_part` (`child_task_id`);--> statement-breakpoint
ALTER TABLE `entry` ADD `path` text;--> statement-breakpoint
-- Today's sub-tasks become parts that hold private steps. A migrated part takes its step's id,
-- so a tick logged before paths (an Entry of the step) still finds where it sits.
INSERT INTO `task_part` (`id`, `task_id`, `child_task_id`, `sort_order`, `archived`)
SELECT s.`id`, s.`parent_task_id`, s.`id`, s.`sort_order`, s.`archived`
FROM `task` s JOIN `task` p ON p.`id` = s.`parent_task_id`;
