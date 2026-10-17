<?php
define('WP_INSTALLING', true);
$_SERVER['HTTP_HOST']='127.0.0.1:8088'; $_SERVER['REQUEST_URI']='/';
require __DIR__.'/wp/wp-load.php';
require_once ABSPATH.'wp-admin/includes/upgrade.php';
$r = wp_install('Slotly Test','admin','admin@example.com',true,'','adminpass123');
update_option('siteurl','http://127.0.0.1:8088'); update_option('home','http://127.0.0.1:8088');
update_option('permalink_structure','/%postname%/');
echo "installed user ".$r['user_id']."\n";
