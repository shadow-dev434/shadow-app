/**
 * Diagnostica presence-only su ADMIN_EMAILS (nessun valore stampato).
 * Serve solo a distinguere "manca la voce" da "typo/formato".
 */
const raw = process.env.ADMIN_EMAILS ?? '';
const tokens = raw.split(/[,;\s]+/).map((s) => s.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
console.log('ADMIN_EMAILS presente:', raw.trim().length > 0);
console.log('n. voci:', tokens.length);
console.log("contiene sottostringa 'collaudo68':", raw.toLowerCase().includes('collaudo68'));
console.log("contiene sottostringa 'admin@probe.local':", raw.toLowerCase().includes('admin@probe.local'));
console.log("match esatto 'collaudo68-admin@probe.local':", tokens.includes('collaudo68-admin@probe.local'));
