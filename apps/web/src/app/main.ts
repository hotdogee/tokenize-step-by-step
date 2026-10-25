/**
 * Entry of `/` (index.html). boot.js has already set `<html lang>` and `data-theme`; App builds its AppState
 * (bootstrap.ts) with the precomputed default example on screen and loads o200k after first paint (06 §3).
 */
import '../theme/base.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (target === null) throw new Error('index.html is missing #app');
mount(App, { target });
