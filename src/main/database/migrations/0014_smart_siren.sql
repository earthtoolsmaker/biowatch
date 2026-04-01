CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`topic` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`maxAttempts` integer DEFAULT 3 NOT NULL,
	`createdAt` text NOT NULL,
	`startedAt` text,
	`completedAt` text
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_kind_status` ON `jobs` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status_createdAt` ON `jobs` (`status`,`createdAt`);