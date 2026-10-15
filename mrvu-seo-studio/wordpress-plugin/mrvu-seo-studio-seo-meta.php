<?php
/**
 * Plugin Name: Mr.Vũ SEO Studio – SEO Meta qua REST API
 * Description: Cho phép công cụ Mr.Vũ SEO Studio (Autopost) ghi meta title, meta description và từ khóa chính của Yoast SEO / Rank Math khi đăng bài qua REST API. Chỉ tài khoản có quyền sửa bài mới ghi được.
 * Version: 1.0
 */
if (!defined('ABSPATH')) exit;

add_action('init', function () {
    $keys = array(
        '_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw',
        'rank_math_title', 'rank_math_description', 'rank_math_focus_keyword',
    );
    foreach ($keys as $key) {
        register_post_meta('post', $key, array(
            'type'          => 'string',
            'single'        => true,
            'show_in_rest'  => true,
            'auth_callback' => function () { return current_user_can('edit_posts'); },
        ));
    }
});
