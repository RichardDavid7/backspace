CREATE TABLE `space_soundboard_settings` (
	`space_id` text PRIMARY KEY NOT NULL,
	`soundboard_enabled` integer DEFAULT 1 NOT NULL,
	`allow_instance_sounds` integer DEFAULT 1 NOT NULL,
	`max_concurrent_sounds` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `space_soundboard_overrides` (
	`space_id` text NOT NULL,
	`sound_id` text NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`volume` integer,
	PRIMARY KEY(`space_id`, `sound_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sound_id`) REFERENCES `soundboard_sounds`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_space_soundboard_overrides_space` ON `space_soundboard_overrides` (`space_id`);
