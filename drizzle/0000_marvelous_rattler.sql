CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `records_owner_kind` ON `records` (`owner`,`kind`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`provider` text NOT NULL,
	`cursor` text,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_owner_provider` ON `sync_state` (`owner`,`provider`);