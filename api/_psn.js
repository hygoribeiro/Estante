// Login na PSN, compartilhado pelas rotas /api/psn e /api/trofeus (biblioteca NÃO OFICIAL psn-api).
import * as psn from 'psn-api';
import { ErroHttp } from './_comum.js';

export async function loginPsn() {
  const npsso = (process.env.PSN_NPSSO || '').trim();
  if (!npsso) throw new ErroHttp(400, 'PSN não configurada: falta PSN_NPSSO na Vercel.', 'npsso');
  try {
    // Os nomes das funções mudaram entre versões da biblioteca
    const trocarNpsso = psn.exchangeNpssoForAccessCode || psn.exchangeNpssoForCode;
    const trocarCodigo = psn.exchangeAccessCodeForAuthTokens || psn.exchangeCodeForAccessToken;
    const autorizacao = await trocarCodigo(await trocarNpsso(npsso));
    return { accessToken: autorizacao.accessToken };
  } catch (e) {
    // Só culpa o token quando a Sony recusa o login; queda de rede ou PSN fora do ar é outro erro
    const msg = String((e && e.message) || e);
    if (!/npsso|access code|auth|401|403|invalid|expired/i.test(msg)) {
      console.error('Falha no login da PSN', msg);
      throw new ErroHttp(502, 'Não consegui falar com a PSN agora (pode estar fora do ar). Tente de novo em alguns minutos.');
    }
    throw new ErroHttp(401, 'O token da PSN (NPSSO) venceu ou é inválido. Isso acontece sozinho a cada ~2 meses; renovar leva uns 3 minutos.', 'npsso');
  }
}
