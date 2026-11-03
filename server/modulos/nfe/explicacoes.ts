// Traduz codigos de retorno da SEFAZ em orientacao acionavel.
const EXPLICACOES: Record<string, string> = {
  '203': 'A SEFAZ não reconhece esta empresa como emissora de NF-e. Isso é cadastral, não é erro da nota: é preciso ter Inscrição Estadual e credenciamento para NF-e na SEFAZ-SP (CADESP / Posto Fiscal Eletrônico).',
  '245': 'O CNPJ do emitente não consta no cadastro de contribuintes da SEFAZ-SP. Normalmente significa que a empresa não tem Inscrição Estadual em SP.',
  '246': 'O CNPJ do emitente está sem cadastro estadual válido.',
  '247': 'A UF da nota é diferente da UF desta SEFAZ.',
  '257': 'A SEFAZ informou que este CNPJ não está habilitado para emitir NF-e.',
  '209': 'A Inscrição Estadual do emitente é inválida ou não pertence a este CNPJ.',
  '210': 'A IE do destinatário é inválida. Confira o número ou diga que o cliente não é contribuinte.',
  '215': 'O XML falhou na validação de schema da SEFAZ.',
  '225': 'O XML falhou na validação de schema da SEFAZ.',
  '297': 'A assinatura digital não foi aceita pela SEFAZ.',
  '301': 'Uso denegado: há irregularidade fiscal do emitente.',
  '302': 'Uso denegado: há irregularidade fiscal do destinatário.',
  '539': 'Já existe nota com este número e outra chave de acesso.',
  '204': 'Esta nota já foi enviada antes (duplicidade).',
  '598': 'Em homologação o nome do destinatário precisa ser o texto padrão de teste.',
  '778': 'NCM informado não existe. Confira o código de 8 dígitos.'
};

export const explicar = (cStat?: string) => (cStat ? EXPLICACOES[cStat] : undefined);

export const CADASTRAIS = new Set(['203', '245', '246', '257', '209', '301']);
