// constants/testIds/ — central registry of testID values used by the
// end-to-end testing agent (qabot) to locate and interact with UI elements
// during automated tests. UI without testIDs cannot be automatically verified.
//
// Structure: each feature lives in its own file (auth.js, map.js, ...) and
// is re-exported from here, so consumers can do a single import like
// `import { LOGIN, MAP } from '../constants/testIds'`.
//
// Adding a new feature:
//   1. Create constants/testIds/<feature>.js
//   2. Export named objects (e.g. `export const PROFILE = { ... }`)
//   3. Re-export here: `export * from './<feature>';`

export * from './auth';
export * from './onboarding';
export * from './map';
export * from './routes';
export * from './report';
export * from './drive';
export * from './profile';
