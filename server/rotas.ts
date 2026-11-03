import type { Request, Response } from 'express';
import { ErroCadastro } from './cadastros.ts';

/** Salva um cadastro vindo do menu; erro de validacao vira 422 com a mensagem para o formulario. */
export const rotaCadastro = (salvar: (dados: Record<string, unknown>) => unknown) => (req: Request, res: Response) => {
  try {
    res.json(salvar(req.body ?? {}));
  } catch (e) {
    if (e instanceof ErroCadastro) res.status(422).json({ erro: e.message });
    else throw e;
  }
};
