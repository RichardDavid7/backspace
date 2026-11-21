ALTER TABLE `instance_settings` ADD `soundboard_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD `max_audio_bitrate_kbps` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `allow_stereo_audio` integer;
