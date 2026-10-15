CREATE TABLE `live_buses` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`unit` integer NOT NULL,
	`owner_id` text NOT NULL,
	`session_hash` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`accuracy` real,
	`sampled_at` integer,
	`updated_at` integer NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
