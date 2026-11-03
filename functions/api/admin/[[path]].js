// Every request to /api/admin/*, whatever its method, goes to the admin router, which answers
// unknown paths and methods itself, as JSON.
export { handleAdmin as onRequest } from '../../_lib/admin/router.js';
