<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . '/wp' . $path;
if ($path !== '/' && file_exists($file) && !is_dir($file)) return false;
$_SERVER['SCRIPT_NAME'] = '/index.php';
require __DIR__ . '/wp/index.php';
