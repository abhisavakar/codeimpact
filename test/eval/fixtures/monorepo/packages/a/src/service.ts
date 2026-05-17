import { formatDate } from './utils.js';
export function getStatus() { return { ok: true, time: formatDate(new Date()) }; }
