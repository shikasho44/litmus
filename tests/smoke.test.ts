import { describe, it, expect } from 'vitest';
import { CaseSchema } from '../shared/case-schema';
describe('schema', () => { it('loads', () => { expect(typeof CaseSchema.parse).toBe('function'); }); });
