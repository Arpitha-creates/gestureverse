/**
 * Registers the module stubs. Used via:
 *   node --import ./tests/register.mjs --test tests/
 */

import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
