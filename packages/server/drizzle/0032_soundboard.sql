CREATE TABLE `soundboard_sounds` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`name` text NOT NULL,
	`emoji` text DEFAULT '🔊' NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_soundboard_scope` ON `soundboard_sounds` (`scope_type`,`scope_id`,`position`);
