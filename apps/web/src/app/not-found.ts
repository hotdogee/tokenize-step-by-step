/** Entry of `404.html`: replaces the static English fallback with the localized page. */
import '../theme/base.css';
import { mount } from 'svelte';
import NotFound from './NotFound.svelte';

const target = document.getElementById('app');
if (target === null) throw new Error('404.html is missing #app');
target.replaceChildren();
mount(NotFound, { target });
