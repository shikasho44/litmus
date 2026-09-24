/**
 * Admin console entry (admin.html). Dev: open http://127.0.0.1:5190/admin.html.
 * Production: /admin.html asks for ADMIN_TOKEN (sent as x-admin-token). See docs/admin.md.
 */
import { render } from 'preact';
import '../styles/tokens.css';
import '../styles/fonts.css';
import './admin.css';
import { AdminApp } from './App';
import { connect } from './store';

document.title = `管理コンソール — ${(import.meta.env.VITE_APP_TITLE as string) || 'ジェーンドゥの死因'}`;
const root = document.getElementById('admin');
if (root) {
  render(<AdminApp />, root);
  void connect();
}
