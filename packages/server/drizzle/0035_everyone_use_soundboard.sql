UPDATE `roles` SET `permissions` = CAST((CAST(`permissions` AS INTEGER) | 134217728) AS TEXT) WHERE `id` = `space_id` AND `permissions` IS NOT NULL AND `permissions` GLOB '[0-9]*';
