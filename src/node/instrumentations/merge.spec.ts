import { mergeInstrumentations } from './merge';
import type { InstrumentationDescriptor } from './types';

const catalog: InstrumentationDescriptor[] = [
  { name: 'http', module: '@opentelemetry/instrumentation-http', config: { a: 1 } },
  { name: 'typeorm', module: '@opentelemetry/instrumentation-typeorm', requires: 'typeorm' },
];

const fakeInstance = () => ({
  instrumentationName: 'x',
  instrumentationVersion: '1',
  enable() {},
  disable() {},
});

describe('mergeInstrumentations', () => {
  it('returns the catalog unchanged when there are no overrides', () => {
    expect(mergeInstrumentations(catalog, {}).descriptors).toHaveLength(2);
  });

  it('marks catalog defaults as not explicit', () => {
    const http = mergeInstrumentations(catalog, {}).descriptors.find((d) => d.name === 'http');
    expect(http?.explicit).toBeFalsy();
  });

  it('disables a built-in when the override is false', () => {
    const { descriptors } = mergeInstrumentations(catalog, { typeorm: false });
    expect(descriptors.find((d) => d.name === 'typeorm')?.enabled).toBe(false);
  });

  it('patches a built-in config without dropping its other fields', () => {
    const { descriptors } = mergeInstrumentations(catalog, { http: { config: { b: 2 } } });
    const http = descriptors.find((d) => d.name === 'http');
    expect(http?.module).toBe('@opentelemetry/instrumentation-http');
    expect(http?.config).toEqual({ a: 1, b: 2 });
  });

  it('marks a patched built-in as explicit', () => {
    const { descriptors } = mergeInstrumentations(catalog, { http: { config: { b: 2 } } });
    expect(descriptors.find((d) => d.name === 'http')?.explicit).toBe(true);
  });

  it('adds a descriptor that is not in the catalog', () => {
    const { descriptors } = mergeInstrumentations(catalog, {
      amqplib: { module: '@opentelemetry/instrumentation-amqplib', requires: 'amqplib' },
    });
    const added = descriptors.find((d) => d.name === 'amqplib');
    expect(added?.module).toBe('@opentelemetry/instrumentation-amqplib');
    expect(added?.explicit).toBe(true);
  });

  it('separates live instrumentation instances from descriptors', () => {
    const instance = fakeInstance();
    const { descriptors, instances } = mergeInstrumentations(catalog, { custom: instance });
    expect(instances).toEqual([instance]);
    expect(descriptors.find((d) => d.name === 'custom')).toBeUndefined();
  });

  it('treats an override of true as an explicit enable', () => {
    const { descriptors } = mergeInstrumentations(catalog, { typeorm: true });
    const typeorm = descriptors.find((d) => d.name === 'typeorm');
    expect(typeorm?.enabled).toBe(true);
    expect(typeorm?.explicit).toBe(true);
  });

  it('ignores an added entry that supplies no module', () => {
    expect(mergeInstrumentations(catalog, { bogus: { requires: 'x' } }).descriptors).toHaveLength(
      2,
    );
  });

  it('does not let a patch rename a catalog entry out from under its key', () => {
    const { descriptors } = mergeInstrumentations(catalog, { http: { name: 'renamed' } });
    expect(descriptors.find((d) => d.name === 'http')).toBeDefined();
    expect(descriptors.find((d) => d.name === 'renamed')).toBeUndefined();
  });

  it('does not mutate the catalog it is given', () => {
    mergeInstrumentations(catalog, { http: { config: { b: 2 } } });
    expect(catalog[0]?.config).toEqual({ a: 1 });
  });
});
