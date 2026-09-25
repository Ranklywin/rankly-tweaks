import metadata from '../package.json' with { type: 'json' };

// package.json is the only source of the public application version.
export const APP_VERSION = metadata.version;
