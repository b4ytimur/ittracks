ALTER TABLE `habit` ADD `scoring` text DEFAULT 'habit' NOT NULL;--> statement-breakpoint
ALTER TABLE `metric` ADD `same_day` text DEFAULT 'add' NOT NULL;