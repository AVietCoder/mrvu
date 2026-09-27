/**
 * Cấu hình Font Awesome cho SSR: nạp CSS của Font Awesome qua bundle thay vì để
 * thư viện tự chèn <style> lúc chạy — tránh icon bị phóng to chớp nhoáng khi
 * trang render từ server rồi mới hydrate.
 * Import file này một lần ở nơi dùng <FontAwesomeIcon>.
 */
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";

config.autoAddCss = false;
