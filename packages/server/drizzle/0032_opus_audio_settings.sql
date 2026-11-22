ALTER TABLE `instance_settings` ADD `default_audio_bitrate_kbps` integer DEFAULT 64 NOT NULL;--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `max_audio_bitrate_kbps` integer DEFAULT 512 NOT NULL;--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `allow_music_mode` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `allow_stereo_audio` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD `audio_bitrate_kbps` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `max_audio_bitrate_kbps` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `allow_music_mode` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `allow_stereo_audio` integer;
