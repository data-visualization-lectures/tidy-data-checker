import { describe, it, expect } from 'vitest';
import { checkpointRegistry, getImplementedChecks, getCheckpointById } from '../checks/registry';

describe('checkpointRegistry', () => {
  it('should have 11 checkpoints in the correct order', () => {
    expect(checkpointRegistry).toHaveLength(11);

    const expectedOrder = [
      'encoding',
      'format',
      'empty',
      'title-notes',
      'multi-header',
      'totals',
      'symbols',
      'format-number',
      'wareki',
      'wide-to-long',
      'final',
    ];

    const actualOrder = checkpointRegistry.map(cp => cp.id);
    expect(actualOrder).toEqual(expectedOrder);
  });

  it('should have unique ids', () => {
    const ids = checkpointRegistry.map(cp => cp.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have Japanese names and descriptions for all checkpoints', () => {
    for (const cp of checkpointRegistry) {
      expect(cp.name).toBeTruthy();
      expect(cp.description).toBeTruthy();
      expect(/[\u3000-\u9fff]/.test(cp.name)).toBe(true);
      expect(/[\u3000-\u9fff]/.test(cp.description)).toBe(true);
    }
  });

  it('should mark implemented checks correctly', () => {
    const implemented = checkpointRegistry.filter(cp => cp.check !== null);
    const unimplemented = checkpointRegistry.filter(cp => cp.check === null);

    expect(implemented.map(cp => cp.id)).toContain('encoding');
    expect(implemented.map(cp => cp.id)).toContain('format');
    expect(implemented.map(cp => cp.id)).toContain('empty');
    expect(implemented.map(cp => cp.id)).toContain('title-notes');
    expect(implemented.map(cp => cp.id)).toContain('multi-header');
    expect(implemented.map(cp => cp.id)).toContain('totals');
    expect(implemented.map(cp => cp.id)).toContain('symbols');
    expect(implemented.map(cp => cp.id)).toContain('format-number');
    expect(implemented.map(cp => cp.id)).toContain('wareki');

    expect(unimplemented.map(cp => cp.id)).toContain('wide-to-long');
    expect(unimplemented.map(cp => cp.id)).toContain('final');
  });
});

describe('getImplementedChecks', () => {
  it('should return only implemented checks', () => {
    const checks = getImplementedChecks();

    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every(check => check.detect !== undefined)).toBe(true);
  });

  it('should return checks in registry order', () => {
    const checks = getImplementedChecks();
    const implementedFromRegistry = checkpointRegistry
      .filter(cp => cp.check !== null)
      .map(cp => cp.check!);

    expect(checks).toEqual(implementedFromRegistry);
  });
});

describe('getCheckpointById', () => {
  it('should return checkpoint by id', () => {
    const encoding = getCheckpointById('encoding');
    expect(encoding).toBeDefined();
    expect(encoding?.name).toBe('文字コード');
  });

  it('should return undefined for unknown id', () => {
    const unknown = getCheckpointById('unknown-check');
    expect(unknown).toBeUndefined();
  });
});
