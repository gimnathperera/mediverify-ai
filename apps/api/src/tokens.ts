export const PG_POOL = Symbol('PG_POOL');
export const APP_CONFIG = Symbol('APP_CONFIG');
export const LOGGER = Symbol('LOGGER');
/** Test-only seam: called inside the upload transaction after all inserts, before COMMIT. */
export const UPLOAD_FAULT_HOOK = Symbol('UPLOAD_FAULT_HOOK');
export type UploadFaultHook = (() => Promise<void>) | null;
