/** Entry of `/` (index.html). Mounts the app shell; the real shell, board and pipeline arrive with WP06–WP09 and WP13. */
import '../theme/base.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (target === null) throw new Error('index.html is missing #app');
mount(App, { target });
