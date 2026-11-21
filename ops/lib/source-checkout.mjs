/**
 * This git checkout is Paul's development copy. Customer installs do not
 * include the Rover .git directory, and they are the only place the weekly
 * plan is enforced.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export function isSourceCheckout(root = process.cwd()) {
  return existsSync(path.join(root, '.git'));
}
