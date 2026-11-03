// Roda uma conversa pelo motor real: uso local para teste de ponta a ponta.
export {};
const { processar } = await import('../server/chat/engine.ts');
for (const m of process.argv.slice(2)) {
  console.log(`\n>>> ${m}`);
  for (const r of await processar(m)) {
    console.log(r.texto);
    if (r.nota) console.log('   [nota]', JSON.stringify(r.nota));
    if (r.sugestoes) console.log('   [sugestoes]', r.sugestoes.join(' | '));
  }
}
