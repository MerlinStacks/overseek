<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class OverSeek_API
 *
 * Handles REST API endpoints for the plugin.
 */
class OverSeek_API {

    /**
     * Register REST API routes.
     */
    public function register_routes() {
        register_rest_route( 'overseek/v1', '/settings', array(
            'methods'  => 'POST',
            'callback' => array( $this, 'update_settings_callback' ),
            'permission_callback' => function () {
                return current_user_can( 'manage_woocommerce' ) || current_user_can( 'manage_options' );
            }
        ) );
    }

    /**
     * Callback for updating settings via REST API.
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response
     */
    public function update_settings_callback( $request ) {
        $params = $request->get_json_params();

        if ( isset( $params['account_id'] ) ) {
            update_option( 'overseek_account_id', sanitize_text_field( $params['account_id'] ) );
        }

        if ( isset( $params['api_url'] ) ) {
            update_option( 'overseek_api_url', esc_url_raw( $params['api_url'] ) );
        }
        
        // Only enable tracking/chat if explicitly requested (security: prevent auto-enable on hijacked sessions)
        if ( isset( $params['enable_tracking'] ) ) {
            update_option( 'overseek_enable_tracking', $params['enable_tracking'] ? '1' : '' );
        }
        if ( isset( $params['enable_chat'] ) ) {
            update_option( 'overseek_enable_chat', $params['enable_chat'] ? '1' : '' );
        }

        return new WP_REST_Response( array( 'success' => true, 'message' => 'Settings updated successfully' ), 200 );
    }
}
