<?php
/**
 * Plugin Name:       Vantry Connect
 * Plugin URI:        https://vantryai.com/ai/
 * Description:       Lets Vantry publish fact-checked answer pages and the code AI tools read (structured data, llms.txt) to your site. Disconnect any time under Settings > Vantry.
 * Version:           1.0.0
 * Requires at least: 5.6
 * Requires PHP:      7.2
 * Author:            Vantry
 * Author URI:        https://vantryai.com
 * License:           GPLv2 or later
 * Text Domain:       vantry-connect
 */

if (!defined('ABSPATH')) {
	exit;
}

if (!defined('VANTRY_API')) {
	define('VANTRY_API', 'https://api.vantryai.com');
}
define('VANTRY_VERSION', '1.0.0');

/* ---------------------------------------------------------------- Settings page */

add_action('admin_menu', function () {
	add_options_page('Vantry', 'Vantry', 'manage_options', 'vantry-connect', 'vantry_settings_page');
});

add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
	array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=vantry-connect')) . '">Settings</a>');
	return $links;
});

function vantry_settings_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$msg = '';
	if (isset($_POST['vantry_code']) && check_admin_referer('vantry_connect')) {
		$code  = trim(sanitize_text_field(wp_unslash($_POST['vantry_code'])));
		$parts = explode('.', $code, 2);
		if (count($parts) !== 2 || strlen($parts[1]) < 20) {
			$msg = 'That code doesn\'t look right. Copy it again from your Vantry page.';
		} else {
			update_option('vantry_key_hash', hash('sha256', $parts[1]), false);
			$res = wp_remote_post(VANTRY_API . '/api/site/connect', array(
				'timeout' => 30,
				'headers' => array('Content-Type' => 'application/json'),
				'body'    => wp_json_encode(array('code' => $code, 'site' => home_url('/'), 'rest' => rest_url('vantry/v1/'))),
			));
			if (is_wp_error($res)) {
				$msg = 'We couldn\'t reach Vantry: ' . $res->get_error_message();
			} else {
				$body = json_decode(wp_remote_retrieve_body($res), true);
				if (!empty($body['ok'])) {
					update_option('vantry_connected', time(), false);
					$msg = 'Connected. Vantry can now publish to this site.';
				} else {
					delete_option('vantry_key_hash');
					$msg = 'Not connected: ' . (isset($body['error']) ? $body['error'] : 'unknown error');
				}
			}
		}
	}
	if (isset($_POST['vantry_disconnect']) && check_admin_referer('vantry_connect')) {
		delete_option('vantry_key_hash');
		delete_option('vantry_connected');
		$msg = 'Disconnected. Pages Vantry published stay on your site; you can delete them under Pages.';
	}
	$connected = get_option('vantry_connected') && get_option('vantry_key_hash');
	?>
	<div class="wrap">
		<h1>Vantry</h1>
		<?php if ($msg) : ?><div class="notice notice-info"><p><?php echo esc_html($msg); ?></p></div><?php endif; ?>
		<p>Vantry publishes pages that answer your buyers' questions, adds structured data to your homepage, serves <code>/llms.txt</code>, and lets AI search tools read your site. Everything is fact-checked against your own website.</p>
		<?php if ($connected) : ?>
			<p><strong>Status: connected</strong> since <?php echo esc_html(date_i18n(get_option('date_format'), (int) get_option('vantry_connected'))); ?>.</p>
			<p>Vantry can only create and update its own pages (marked "Vantry" in your Pages list) and these AI settings. It can't change anything else.</p>
			<form method="post"><?php wp_nonce_field('vantry_connect'); ?><input type="hidden" name="vantry_disconnect" value="1"><?php submit_button('Disconnect', 'secondary'); ?></form>
		<?php else : ?>
			<form method="post">
				<?php wp_nonce_field('vantry_connect'); ?>
				<table class="form-table"><tr><th scope="row"><label for="vantry_code">Connect code</label></th>
				<td><input type="text" id="vantry_code" name="vantry_code" class="regular-text code" autocomplete="off" required><p class="description">From your Vantry page (the link in your Vantry email).</p></td></tr></table>
				<?php submit_button('Connect'); ?>
			</form>
		<?php endif; ?>
	</div>
	<?php
}

/* ---------------------------------------------------------------- API for Vantry */

function vantry_auth(WP_REST_Request $req) {
	$hash = get_option('vantry_key_hash');
	$key  = (string) $req->get_header('x_vantry_key');
	return $hash && $key && hash_equals($hash, hash('sha256', $key));
}

function vantry_author() {
	$admins = get_users(array('role' => 'administrator', 'number' => 1, 'fields' => 'ID'));
	return $admins ? (int) $admins[0] : 0;
}

function vantry_find_page($vid) {
	$found = get_posts(array(
		'post_type'   => 'page',
		'post_status' => array('publish', 'draft', 'pending', 'private'),
		'meta_key'    => '_vantry_id',
		'meta_value'  => $vid,
		'numberposts' => 1,
		'fields'      => 'ids',
	));
	return $found ? (int) $found[0] : 0;
}

add_action('rest_api_init', function () {
	register_rest_route('vantry/v1', '/status', array(
		'methods'             => 'GET',
		'permission_callback' => 'vantry_auth',
		'callback'            => function () {
			$pages = get_posts(array('post_type' => 'page', 'meta_key' => '_vantry_id', 'numberposts' => 200, 'fields' => 'ids'));
			return array(
				'ok'             => true,
				'name'           => get_bloginfo('name'),
				'wp'             => get_bloginfo('version'),
				'plugin'         => VANTRY_VERSION,
				'pages'          => count($pages),
				'physicalRobots' => file_exists(ABSPATH . 'robots.txt'),
				'physicalLlms'   => file_exists(ABSPATH . 'llms.txt'),
			);
		},
	));

	register_rest_route('vantry/v1', '/settings', array(
		'methods'             => 'POST',
		'permission_callback' => 'vantry_auth',
		'callback'            => function (WP_REST_Request $req) {
			$schema = (string) $req->get_param('schema');
			if ($schema !== '' && json_decode($schema) !== null) {
				update_option('vantry_schema', $schema, false);
			}
			update_option('vantry_llms', sanitize_textarea_field((string) $req->get_param('llms')), false);
			update_option('vantry_allow_ai', $req->get_param('allowAi') ? 1 : 0, false);
			$bots = array_filter(array_map('sanitize_text_field', (array) $req->get_param('bots')));
			update_option('vantry_bots', array_slice($bots, 0, 12), false);
			return array('ok' => true, 'physicalRobots' => file_exists(ABSPATH . 'robots.txt'), 'physicalLlms' => file_exists(ABSPATH . 'llms.txt'));
		},
	));

	register_rest_route('vantry/v1', '/page', array(
		array(
			'methods'             => 'POST',
			'permission_callback' => 'vantry_auth',
			'callback'            => function (WP_REST_Request $req) {
				$vid = sanitize_key((string) $req->get_param('vid'));
				if (!$vid) {
					return new WP_Error('vantry_bad', 'Missing page id', array('status' => 400));
				}
				$post = array(
					'post_type'    => 'page',
					'post_status'  => 'publish',
					'post_title'   => sanitize_text_field((string) $req->get_param('title')),
					'post_name'    => sanitize_title((string) $req->get_param('slug')),
					'post_content' => wp_kses_post((string) $req->get_param('content')),
					'post_author'  => vantry_author(),
				);
				$existing = vantry_find_page($vid);
				if ($existing) {
					$post['ID'] = $existing;
					$id         = wp_update_post(wp_slash($post), true);
				} else {
					$id = wp_insert_post(wp_slash($post), true);
				}
				if (is_wp_error($id)) {
					return $id;
				}
				update_post_meta($id, '_vantry_id', $vid);
				update_post_meta($id, '_vantry_desc', sanitize_text_field((string) $req->get_param('description')));
				$schema = (string) $req->get_param('schema');
				if ($schema !== '' && json_decode($schema) !== null) {
					update_post_meta($id, '_vantry_schema', wp_slash($schema));
				}
				return array('ok' => true, 'id' => $id, 'url' => get_permalink($id));
			},
		),
		array(
			'methods'             => 'DELETE',
			'permission_callback' => 'vantry_auth',
			'callback'            => function (WP_REST_Request $req) {
				$id = vantry_find_page(sanitize_key((string) $req->get_param('vid')));
				if ($id) {
					wp_trash_post($id); // to the Trash, so the owner can restore it
				}
				return array('ok' => true, 'removed' => (bool) $id);
			},
		),
	));
});

/* ---------------------------------------------------------------- What visitors and AI see */

function vantry_print_schema($json) {
	$data = json_decode($json, true);
	if (!is_array($data)) {
		return;
	}
	echo "\n<script type=\"application/ld+json\">" . wp_json_encode($data, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . "</script>\n";
}

function vantry_seo_plugin_active() {
	return defined('WPSEO_VERSION') || class_exists('RankMath') || defined('AIOSEO_VERSION') || defined('SEOPRESS_VERSION');
}

add_action('wp_head', function () {
	if (!get_option('vantry_key_hash')) {
		return;
	}
	if (is_front_page()) {
		$schema = get_option('vantry_schema');
		if ($schema) {
			vantry_print_schema($schema);
		}
	}
	if (is_page()) {
		$id = get_queried_object_id();
		if (get_post_meta($id, '_vantry_id', true)) {
			vantry_print_schema((string) get_post_meta($id, '_vantry_schema', true));
			$desc = (string) get_post_meta($id, '_vantry_desc', true);
			if ($desc && !vantry_seo_plugin_active()) {
				echo '<meta name="description" content="' . esc_attr($desc) . "\">\n";
			}
		}
	}
}, 5);

// Our page descriptions inside popular SEO plugins.
$vantry_desc_filter = function ($desc) {
	if (is_page()) {
		$mine = (string) get_post_meta(get_queried_object_id(), '_vantry_desc', true);
		if ($mine && get_post_meta(get_queried_object_id(), '_vantry_id', true)) {
			return $mine;
		}
	}
	return $desc;
};
add_filter('wpseo_metadesc', $vantry_desc_filter);
add_filter('rank_math/frontend/description', $vantry_desc_filter);

// Let AI search tools read the site (only affects WordPress's built-in robots.txt).
add_filter('robots_txt', function ($output, $public) {
	if (!get_option('vantry_key_hash') || !get_option('vantry_allow_ai') || !$public) {
		return $output;
	}
	$bots = (array) get_option('vantry_bots', array());
	if (!$bots) {
		return $output;
	}
	$output .= "\n# Added by Vantry: let AI search tools read this site\n";
	foreach ($bots as $bot) {
		$output .= 'User-agent: ' . $bot . "\nAllow: /\n\n";
	}
	return $output;
}, 20, 2);

// Serve /llms.txt (a plain summary for AI tools), unless a real file already exists.
add_action('init', function () {
	if (!get_option('vantry_key_hash')) {
		return;
	}
	$path = isset($_SERVER['REQUEST_URI']) ? (string) wp_parse_url(wp_unslash($_SERVER['REQUEST_URI']), PHP_URL_PATH) : '';
	$home = (string) wp_parse_url(home_url('/'), PHP_URL_PATH);
	if ($path !== rtrim($home, '/') . '/llms.txt') {
		return;
	}
	$text = (string) get_option('vantry_llms');
	if ($text === '') {
		return;
	}
	header('Content-Type: text/plain; charset=utf-8');
	header('Cache-Control: public, max-age=3600');
	echo $text; // plain text, sanitized when saved
	exit;
}, 0);

// Mark our pages in the admin Pages list.
add_filter('display_post_states', function ($states, $post) {
	if ($post->post_type === 'page' && get_post_meta($post->ID, '_vantry_id', true)) {
		$states['vantry'] = 'Vantry';
	}
	return $states;
}, 10, 2);

register_uninstall_hook(__FILE__, 'vantry_uninstall');
function vantry_uninstall() {
	foreach (array('vantry_key_hash', 'vantry_connected', 'vantry_schema', 'vantry_llms', 'vantry_allow_ai', 'vantry_bots') as $opt) {
		delete_option($opt);
	}
}
