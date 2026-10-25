import { describe, expect, it } from 'vitest';
import config from '../playwright.config.ts';

describe('playwright.config.ts (skeleton)', () => {
  it('runs the specs against vite preview of the built app', () => {
    expect(config.testDir).toBe('./specs');
    expect(config.use?.baseURL).toBe('http://localhost:4173');
    const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
    expect(webServer?.command).toContain('@tsbs/web preview');
  });

  it('defines at least the chromium project (PA-5)', () => {
    expect(config.projects?.map((project) => project.name)).toContain('chromium');
  });
});
