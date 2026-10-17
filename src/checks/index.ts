import type { Check } from '../types';
import { encodingCheck } from './encoding';
import { formatCheck } from './format';
import { emptyCheck } from './empty';
import { titleNotesCheck } from './titleNotes';
import { multiHeaderCheck } from './multiHeader';
import { checkpointRegistry, getImplementedChecks } from './registry';

export const checks: Check[] = getImplementedChecks();

export {
  encodingCheck,
  formatCheck,
  emptyCheck,
  titleNotesCheck,
  multiHeaderCheck,
  checkpointRegistry,
  getImplementedChecks,
};
