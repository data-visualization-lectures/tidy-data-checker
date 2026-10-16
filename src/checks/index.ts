import type { Check } from '../types';
import { encodingCheck } from './encoding';
import { emptyCheck } from './empty';

export const checks: Check[] = [
  encodingCheck,
  emptyCheck,
];

export { encodingCheck, emptyCheck };
