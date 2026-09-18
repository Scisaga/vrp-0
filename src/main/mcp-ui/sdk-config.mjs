// Evaluate before the SDK creates any Zod schemas. Disabling JIT only in the
// App constructor is too late to prevent import-time capability probes.
import { config } from 'zod/v4/core';

config({ jitless: true });
