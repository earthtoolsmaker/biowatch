CREATE TABLE `metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`title` text,
	`description` text,
	`created` text NOT NULL,
	`importerName` text NOT NULL,
	`contributors` text,
	`updatedAt` text,
	`startDate` text,
	`endDate` text
);
--> statement-breakpoint
ALTER TABLE `model_runs` ADD `importPath` text;--> statement-breakpoint
ALTER TABLE `model_runs` ADD `options` text;