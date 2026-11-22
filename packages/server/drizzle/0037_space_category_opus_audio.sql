ALTER TABLE `spaces` ADD `audio_bitrate_kbps` integer;--> statement-breakpoint
ALTER TABLE `spaces` ADD `max_audio_bitrate_kbps` integer;--> statement-breakpoint
ALTER TABLE `spaces` ADD `allow_music_mode` integer;--> statement-breakpoint
ALTER TABLE `spaces` ADD `allow_stereo_audio` integer;--> statement-breakpoint
ALTER TABLE `channel_categories` ADD `audio_bitrate_kbps` integer;--> statement-breakpoint
ALTER TABLE `channel_categories` ADD `max_audio_bitrate_kbps` integer;--> statement-breakpoint
ALTER TABLE `channel_categories` ADD `allow_music_mode` integer;--> statement-breakpoint
ALTER TABLE `channel_categories` ADD `allow_stereo_audio` integer;
