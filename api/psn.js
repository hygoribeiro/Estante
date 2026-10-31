// Sincronização com a PSN usando a biblioteca NÃO OFICIAL psn-api.
// Variável na Vercel: PSN_NPSSO (token de 64 caracteres; expira em ~2 meses).
import * as psn from 'psn-api';
import { verificarUsuario, responderErro, norm, emLotes } from './_comum.js';
import { loginPsn } from './_psn.js';

// "PT228H56M33S" (ou "P1DT2H...") -> horas com 1 casa decimal
function horasDeDuracao(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(String(d || ''));
  if (!m) return null;
  const h = (+m[1] || 0) * 24 + (+m[2] || 0) + (+m[3] || 0) / 60 + (+m[4] || 0) / 3600;
  return Math.round(h * 10) / 10;
}
const limparNome = s => String(s || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
// Nome "base" para casar a lista de troféus com a de jogados quando os nomes vêm um pouco diferentes
const PALAVRAS_EXTRAS = new Set(['trophies', 'trophy', 'trofeus', 'edition', 'edicao', 'remastered', 'remasterizado', 'definitive', 'deluxe', 'complete', 'standard', 'digital', 'goty', 'ps4', 'ps5', 'and', 'e', 'the']);
const nomeBase = s => norm(s).split(' ').filter(w => w && !PALAVRAS_EXTRAS.has(w)).join(' ');
const plataformaDe = lista => {
  const p = String(lista || '').toUpperCase().split(',');
  return p.includes('PS5') ? 'PS5' : p.includes('PS4') ? 'PS4' : null;
};

export default async function handler(req, res) {
  try {
    await verificarUsuario(req);
    const a = await loginPsn();
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

    // Horas: primeiro pelo nome exato; se não achar, pelo nome base (sem "Trophies", "Edition"...)
    // ou quando um nome começa com o outro, desde que só exista um candidato.
    const usadas = new Set();
    const acharHoras = (plataforma, nome) => {
      const exata = plataforma + '|' + norm(nome);
      if (horas.has(exata)) { usadas.add(exata); return horas.get(exata); }
      const base = nomeBase(nome);
      if (!base) return null;
      const candidatas = [...horas.keys()].filter(k => {
        if (usadas.has(k) || !k.startsWith(plataforma + '|')) return false;
        const b = nomeBase(k.slice(plataforma.length + 1));
        return b && (b === base || b.startsWith(base + ' ') || base.startsWith(b + ' '));
      });
      if (candidatas.length !== 1) return null;
      usadas.add(candidatas[0]);
      return horas.get(candidatas[0]);
    };

    // Data real da platina: a lista de jogos só traz a data do último troféu (que pode ser de uma DLC
    // pega meses depois). Busca o dia da platina dos jogos platinados, com limite de tempo.
    const dataPlatina = new Map();
    const platinados = titulos.filter(t => plataformaDe(t.trophyTitlePlatform) && ((t.earnedTrophies && t.earnedTrophies.platinum) || 0) > 0);
    const inicio = Date.now();
    let semTempo = false;
    await emLotes(platinados, 8, async t => {
      if (Date.now() - inicio > 25000) { semTempo = true; return; }
      try {
        const r = await psn.getUserTrophiesEarnedForTitle(a, 'me', t.npCommunicationId, 'default', { npServiceName: t.npServiceName || 'trophy' });
        const pl = (r.trophies || []).find(x => x.trophyType === 'platinum' && x.earned && x.earnedDateTime);
        if (pl) dataPlatina.set(t.npCommunicationId, String(pl.earnedDateTime).slice(0, 10));
      } catch (e) { /* fica a data do último troféu */ }
    });
    if (semTempo) avisos.push('Algumas datas de platina não foram lidas a tempo; sincronize de novo para completar.');

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
      const h = acharHoras(plataforma, nome);
      itens.push({
        chave: t.npCommunicationId,
        nome, plataforma, progresso, temPlatina,
        concluido100: concluido,
        conclusao: !concluido ? '' : dataPlatina.get(t.npCommunicationId) || (t.lastUpdatedDateTime ? String(t.lastUpdatedDateTime).slice(0, 10) : ''),
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
