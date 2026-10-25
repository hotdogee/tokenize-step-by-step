/** Entry of `/about/`. The generated About page (fidelity, licences, engine, diagnostics) is WP06's (05 §14). */
import '../theme/base.css';
import { mount } from 'svelte';
import About from './About.svelte';

const target = document.getElementById('app');
if (target === null) throw new Error('about/index.html is missing #app');
mount(About, { target });
