<?php
$_SERVER['HTTP_HOST']='127.0.0.1:8088'; $_SERVER['REQUEST_URI']='/';
require __DIR__.'/wp/wp-load.php';
require_once ABSPATH.'wp-admin/includes/plugin.php';
$r = activate_plugin('vantry-connect/vantry-connect.php');
echo is_wp_error($r) ? $r->get_error_message() : "activated\n";
