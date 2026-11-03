// Volta a conversa ao inicio e descarta o emitente em cache. Mantem o historico de notas transmitidas.
import { db, kvDel } from '../server/db.ts';

kvDel('emitente');
kvDel('conversa');
db.exec('DELETE FROM mensagens');
console.log('estado limpo; notas no historico:', (db.prepare('SELECT COUNT(*) AS n FROM notas').get() as { n: number }).n);
