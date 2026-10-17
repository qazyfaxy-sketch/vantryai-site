# Real-WordPress test for Vantry Connect

Runs the actual plugin in a real WordPress (SQLite, no MySQL) against the real engine code.

1. `git clone --depth 1 --branch 6.6.2 https://github.com/WordPress/WordPress wp` and `git clone --depth 1 https://github.com/WordPress/sqlite-database-integration sqlite` in this folder.
2. Copy `sqlite/packages/plugin-sqlite-database-integration` to `wp/wp-content/plugins/sqlite-database-integration`, and its `db.copy` to `wp/wp-content/db.php` (fill in the two placeholders).
3. Add a `wp-config.php` with `DB_DIR`/`DB_FILE`, and `define('VANTRY_API','http://127.0.0.1:8787');`. Copy `../vantry-connect` into `wp/wp-content/plugins/`.
4. `php install.php && php activate.php`, then `PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8088 router.php &`
5. `node e2e.mjs`: connect with a code, homepage schema, /llms.txt, robots.txt, publish, remove.
