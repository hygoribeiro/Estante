// Sincronização com a PSN usando a biblioteca NÃO OFICIAL psn-api.
// Variável na Vercel: PSN_NPSSO (token de 64 caracteres; expira em ~2 meses).
import * as psn from 'psn-api';
import { verificarUsuario, responderErro, ErroHttp, norm } from './_comum.js';

// "PT228H56M33S" (ou "P1DT2H...") -> horas com 1 casa decimal
function horasDeDuracao(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(String(d || ''));
  if (!m) return null;
  const h = (+m[1] || 0) * 24 + (+m[2] || 0) + (+m[3] || 0) / 60 + (+m[4] || 0) / 3600;
  return Math.round(h * 10) / 10;
}
const limparNome = s => String(s || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
const plataformaDe = lista => {
  const p = String(lista || '').toUpperCase().split(',');
  return p.includes('PS5') ? 'PS5' : p.includes('PS4') ? 'PS4' : null;
};

export default async function handler(req, res) {
  try {
    await verificarUsuario(req);
    const npsso = (process.env.PSN_NPSSO || '').trim();
    if (!npsso) throw new ErroHttp(400, 'PSN não configurada: falta PSN_NPSSO na Vercel.');

    // Login na PSN (os nomes das funções mudaram entre versões da biblioteca)
    let autorizacao;
    try {
      const trocarNpsso = psn.exchangeNpssoForAccessCode || psn.exchangeNpssoForCode;
      const trocarCodigo = psn.exchangeAccessCodeForAuthTokens || psn.exchangeCodeForAccessToken;
      autorizacao = await trocarCodigo(await trocarNpsso(npsso));
    } catch (e) {
      throw new ErroHttp(401, 'O token NPSSO da PSN expirou ou é inválido. Gere um novo, atualize PSN_NPSSO na Vercel e faça Redeploy.');
    }
    const a = { accessToken: autorizacao.accessToken };
    const avisos = [];

    // 1) Jogos com troféus (progresso, platina)
    const titulos = [];
    for (let offset = 0, voltas = 0; voltas < 10; voltas++) {
      const r = await psn.getUserTitles(a, 'me', { limit: 800, offset });
      const lote = r.trophyTitles || [];
      titulos.push(...lote);
      if (!lote.length || titulos.length >= (r.totalItemCount || 0) || r.nextOffset == null) break;
      offset = r.nextOffset;
    }

    // 2) Horas jogadas (só PS4/PS5 registram)
    const horas = new Map();
    try {
      for (let offset = 0, voltas = 0; voltas < 20; voltas++) {
        const r = await psn.getUserPlayedGames(a, 'me', { limit: 200, offset });
        const lote = r.titles || [];
        for (const t of lote) {
          const plat = t.category === 'ps5_native_game' ? 'PS5' : t.category === 'ps4_game' ? 'PS4' : null;
          if (!plat) continue;
          const chave = plat + '|' + norm(limparNome(t.name));
          const h = horasDeDuracao(t.playDuration);
          const atual = horas.get(chave);
          horas.set(chave, {
            horas: (atual ? atual.horas : 0) + (h || 0),
            inicio: String(t.firstPlayedDateTime || '').slice(0, 10),
            imagem: (atual && atual.imagem) || t.imageUrl || ''
          });
        }
        if (!lote.length || r.nextOffset == null) break;
        offset = r.nextOffset;
      }
    } catch (e) {
      avisos.push('Não consegui ler as horas jogadas da PSN; os troféus vieram normalmente.');
    }

    let ignorados = 0;
    const itens = [];
    for (const t of titulos) {
      const plataforma = plataformaDe(t.trophyTitlePlatform);
      if (!plataforma) { ignorados++; continue; } // PS3 / PS Vita
      const nome = limparNome(t.trophyTitleName);
      const temPlatina = ((t.definedTrophies && t.definedTrophies.platinum) || 0) > 0;
      const platinado = ((t.earnedTrophies && t.earnedTrophies.platinum) || 0) > 0;
      const progresso = Number(t.progress || 0);
      const concluido = platinado || (!temPlatina && progresso >= 100);
      const h = horas.get(plataforma + '|' + norm(nome));
      itens.push({
        chave: t.npCommunicationId,
        nome, plataforma, progresso, temPlatina,
        concluido100: concluido,
        conclusao: concluido && t.lastUpdatedDateTime ? String(t.lastUpdatedDateTime).slice(0, 10) : '',
        horas: h ? Math.round(h.horas * 10) / 10 : null,
        inicio: h ? h.inicio : '',
        // Capa: arte do jogo (lista de jogados) ou, na falta, o ícone dos troféus
        imagem: (h && h.imagem) || t.trophyTitleIconUrl || ''
      });
    }
    if (ignorados) avisos.push(`${ignorados} jogo(s) de PS3/PS Vita ficaram de fora (o app organiza só PS4, PS5 e Steam).`);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ itens, avisos });
  } catch (e) { responderErro(res, e); }
}
