ALTER TABLE `metric` ADD `times` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `metric` ADD `better` text;--> statement-breakpoint
ALTER TABLE `task` ADD `row_one` text DEFAULT 'set' NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `row_many` text DEFAULT 'sets' NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `between_name` text DEFAULT 'Rest' NOT NULL;--> statement-breakpoint
UPDATE `metric` SET `times` = 1 WHERE `repeats` = 1 AND `type` IN ('number', 'count', 'duration') AND `id` <> (
	SELECT x.`id` FROM `metric` x WHERE x.`task_id` = `metric`.`task_id` AND x.`repeats` = 1 AND x.`type` IN ('number', 'count', 'duration')
	ORDER BY (x.`type` = 'number' AND (lower(trim(coalesce(x.`unit`, ''))) IN ('kg', 'lb', 'lbs') OR lower(x.`name`) LIKE '%weight%' OR lower(x.`name`) LIKE '%load%')
		AND EXISTS (SELECT 1 FROM `metric` c WHERE c.`task_id` = x.`task_id` AND c.`repeats` = 1 AND c.`type` = 'count')) DESC, x.`sort_order`, x.`rowid` LIMIT 1
);