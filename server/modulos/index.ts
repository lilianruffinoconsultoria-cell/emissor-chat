// Registro dos modulos fiscais. Para um documento novo (NFC-e, CT-e...), basta criar a pasta e registrar aqui.
import { nfe } from './nfe/index.ts';
import { nfse } from './nfse/index.ts';
import type { Modulo } from './tipos.ts';

export const MODULOS: readonly Modulo[] = [nfe, nfse];

export const modulo = (id: string): Modulo | undefined => MODULOS.find((m) => m.id === id);
