<?php
/** dbDelta stand-in, reachable only through the storage ingestion installer. */
function dbDelta(string $sql): array {
    same(str_contains($sql, 'ENGINE=InnoDB'), true);
    same(str_contains($sql, 'PRIMARY KEY  (account_id,scope,entity_id)'), true);
    same(str_contains($sql, 'COLLATE ascii_bin'), true);
    $GLOBALS['wpdb']->installs++;
    $GLOBALS['wpdb']->installed = true;
    return [];
}
