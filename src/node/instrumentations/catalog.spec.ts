import { defaultCatalog } from './catalog';
import { defineConfig } from '../../core/config/define-config';

const cfg = defineConfig({}, {});

describe('defaultCatalog', () => {
  it('gives every descriptor a unique name', () => {
    const names = defaultCatalog(cfg).map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('points every descriptor at an @opentelemetry instrumentation package', () => {
    for (const d of defaultCatalog(cfg)) {
      expect(d.module).toMatch(/^@opentelemetry\/instrumentation-/);
    }
  });

  it('includes the instrumentations the old bootstrap hardcoded', () => {
    const names = defaultCatalog(cfg).map((d) => d.name);
    expect(names).toEqual(
      expect.arrayContaining(['http', 'express', 'nestjs', 'kafkajs', 'typeorm']),
    );
  });

  it('gates every descriptor except http and fs on a host library', () => {
    for (const d of defaultCatalog(cfg)) {
      if (d.name === 'http' || d.name === 'fs') continue;
      expect(typeof d.requires).toBe('string');
    }
  });

  it('disables fs by default', () => {
    expect(defaultCatalog(cfg).find((d) => d.name === 'fs')?.enabled).toBe(false);
  });

  it('builds an http hook that ignores the configured routes', () => {
    const http = defaultCatalog(
      defineConfig({ traces: { ignoreRoutes: ['/health'] } }, {}),
    ).find((d) => d.name === 'http');

    const hook = http?.config?.['ignoreIncomingRequestHook'] as (req: { url?: string }) => boolean;
    expect(hook({ url: '/health' })).toBe(true);
    expect(hook({ url: '/health/deep' })).toBe(true);
    expect(hook({ url: '/orders' })).toBe(false);
    expect(hook({})).toBe(false);
  });

  it('describes express layer filtering without importing the express package', () => {
    const express = defaultCatalog(cfg).find((d) => d.name === 'express');
    expect(express?.config?.['ignoreLayersType']).toEqual(['middleware']);
  });

  it('loads no instrumentation package merely by describing the catalog', () => {
    defaultCatalog(cfg);
    const loaded = Object.keys(require.cache)
      .map((p) => p.replace(/\\/g, '/'))
      .filter((p) => p.includes('@opentelemetry/instrumentation'));
    expect(loaded).toEqual([]);
  });
});
