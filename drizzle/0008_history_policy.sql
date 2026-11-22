ALTER TABLE `metric` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- "Raise by an amount" added one number to every target (5 reps + 2.5 = 7.5). It is now
-- "raise by steps": each target by its own field's step. Old amounts become one step.
UPDATE `habit` SET `progression` = json_set(`progression`, '$.unit', 'steps', '$.by', 1) WHERE json_extract(`progression`, '$.unit') = 'amount';
