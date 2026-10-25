/** Entry of `/about/` (05 §14): no Worker, no vocabulary — licences, fidelity, engine notes, keyboard and diagnostics. */
import '../theme/base.css';
import { mount } from 'svelte';
import About from './About.svelte';

const target = document.getElementById('app');
if (target === null) throw new Error('about/index.html is missing #app');
mount(About, { target });
