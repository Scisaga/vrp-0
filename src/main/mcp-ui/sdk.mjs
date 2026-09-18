// Keep this dependency first: the ordinary SDK entry shares its Zod instance
// with sdk-config, unlike the prebundled app-with-deps entry.
import './sdk-config.mjs';

export { App } from '@modelcontextprotocol/ext-apps';
