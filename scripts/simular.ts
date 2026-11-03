// Roda uma conversa pelo motor real: uso local para teste de ponta a ponta.
// Uso: npx tsx scripts/simular.ts [--nfse] "mensagem 1" "mensagem 2"
export {};
const args = process.argv.slice(2);
const id = args[0] === '--nfse' ? 'nfse' : 'nfe';
const { modulo } = await import('../server/modulos/index.ts');
const { processar } = modulo(id)!;
for (const m of args.filter((a) => a !== '--nfse')) {
  console.log(`\n>>> ${m}`);
  for (const r of await processar(m, false)) {
    console.log(r.texto);
    if (r.nota) console.log('   [nota]', JSON.stringify(r.nota));
    if (r.sugestoes) console.log('   [sugestoes]', r.sugestoes.join(' | '));
  }
}
