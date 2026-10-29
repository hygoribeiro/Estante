// Lista completa de troféus/conquistas de um jogo: todos os definidos, quais já foram ganhos,
// data, raridade e descrição (em português quando a loja tiver; nome em inglês para buscar guias).
//   GET /api/trofeus?fonte=psn&id=NPWR12345_00&plat=PS5
//   GET /api/trofeus?fonte=steam&appid=1145360
import * as psn from 'psn-api';
import { verificarUsuario, responderErro, ErroHttp } from './_comum.js';
import { loginPsn } from './_psn.js';
import { BASE, pegarJson, credenciaisSteam } from './_steam.js';

const TIPOS = ['platinum', 'gold', 'silver', 'bronze'];
const pct = v => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; };
const limpar = s => String(s || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();

function resumo(trofeus) {
  const porTipo = {};
  for (const t of trofeus) {
    if (!t.tipo) continue;
    const p = porTipo[t.tipo] || (porTipo[t.tipo] = { ganhos: 0, total: 0 });
    p.total++; if (t.ganho) p.ganhos++;
  }
  return { total: trofeus.length, ganhos: trofeus.filter(t => t.ganho).length, porTipo };
}

// ---------- PSN ----------
async function trofeusPsn(id, plat) {
  if (!/^NPWR\d{5}_\d{2}$/.test(id)) throw new ErroHttp(400, 'Identificador de jogo da PSN inválido. Sincronize a PSN de novo.');
  const a = await loginPsn();
  const falhou = r => !r || r.error || !Array.isArray(r.trophies);
  const buscar = async servico => {
    const pt = { npServiceName: servico, headerOverrides: { 'Accept-Language': 'pt-BR' } };
    const en = { npServiceName: servico, headerOverrides: { 'Accept-Language': 'en-US' } };
    const [defPt, defEn, meus, grupos] = await Promise.all([
      psn.getTitleTrophies(a, id, 'all', pt).catch(e => ({ error: e })),
      psn.getTitleTrophies(a, id, 'all', en).catch(() => null),
      psn.getUserTrophiesEarnedForTitle(a, 'me', id, 'all', { npServiceName: servico }).catch(e => ({ error: e })),
      psn.getTitleTrophyGroups(a, id, pt).catch(() => null)
    ]);
    if (falhou(defPt) || falhou(meus)) return null;
    return { defPt, defEn, meus, grupos };
  };
  // PS5 usa "trophy2"; PS4 usa "trophy". Se errar, tenta o outro (jogos de duas gerações).
  const primeiro = plat === 'PS5' ? 'trophy2' : 'trophy';
  const r = await buscar(primeiro) || await buscar(primeiro === 'trophy2' ? 'trophy' : 'trophy2');
  if (!r) throw new ErroHttp(502, 'A PSN não devolveu os troféus deste jogo agora. Tente de novo em alguns minutos.');
  const en = new Map(((r.defEn && r.defEn.trophies) || []).map(t => [t.trophyId, t]));
  const meus = new Map(r.meus.trophies.map(t => [t.trophyId, t]));
  const grupos = ((r.grupos && r.grupos.trophyGroups) || []).map(g => ({ id: g.trophyGroupId, nome: limpar(g.trophyGroupName) }));
  const trofeus = r.defPt.trophies.map(t => {
    const m = meus.get(t.trophyId) || {}, e = en.get(t.trophyId) || {};
    return {
      id: String(t.trophyId),
      nome: limpar(t.trophyName), nomeEn: limpar(e.trophyName || t.trophyName),
      descricao: limpar(t.trophyDetail), tipo: TIPOS.includes(t.trophyType) ? t.trophyType : 'bronze',
      icone: t.trophyIconUrl || '', oculto: !!t.trophyHidden, grupo: t.trophyGroupId || 'default',
      ganho: !!m.earned, data: m.earnedDateTime ? String(m.earnedDateTime).slice(0, 10) : '',
      raridade: pct(m.trophyEarnedRate),
      alvo: t.trophyProgressTargetValue || ''
    };
  });
  return { fonte: 'psn', grupos, trofeus, ...resumo(trofeus) };
}

// ---------- Steam ----------
async function trofeusSteam(appid) {
  if (!/^\d{1,10}$/.test(appid)) throw new ErroHttp(400, 'Jogo da Steam inválido.');
  const { k, steamid } = await credenciaisSteam();
  const [esqPt, esqEn, meus, global] = await Promise.all([
    pegarJson(`${BASE}/ISteamUserStats/GetSchemaForGame/v2/?key=${k}&appid=${appid}&l=brazilian`),
    pegarJson(`${BASE}/ISteamUserStats/GetSchemaForGame/v2/?key=${k}&appid=${appid}&l=english`),
    pegarJson(`${BASE}/ISteamUserStats/GetPlayerAchievements/v1/?key=${k}&steamid=${steamid}&appid=${appid}`),
    pegarJson(`${BASE}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`)
  ]);
  if (esqPt.__status === 401 || esqPt.__status === 403) throw new ErroHttp(400, 'A chave STEAM_API_KEY foi recusada pela Steam.');
  const lista = esqPt.game && esqPt.game.availableGameStats && esqPt.game.availableGameStats.achievements;
  if (esqPt.__status !== undefined && !lista) throw new ErroHttp(502, 'A Steam não respondeu agora. Tente de novo em alguns minutos.');
  if (!Array.isArray(lista) || !lista.length) return { fonte: 'steam', grupos: [], trofeus: [], semConquistas: true, ...resumo([]) };
  const en = new Map(((esqEn.game && esqEn.game.availableGameStats && esqEn.game.availableGameStats.achievements) || []).map(x => [x.name, x]));
  const ps = meus.playerstats;
  const privado = !ps || ps.success === false;
  const ganhos = new Map(((ps && ps.achievements) || []).map(x => [x.apiname, x]));
  const raridade = new Map(((global.achievementpercentages && global.achievementpercentages.achievements) || []).map(x => [x.name, pct(x.percent)]));
  const trofeus = lista.map(x => {
    const g = ganhos.get(x.name) || {}, e = en.get(x.name) || {};
    return {
      id: x.name, nome: limpar(x.displayName), nomeEn: limpar(e.displayName || x.displayName),
      descricao: limpar(x.description || e.description), tipo: null,
      icone: x.icon || '', oculto: !!x.hidden, grupo: 'default',
      ganho: g.achieved === 1, data: g.achieved === 1 && g.unlocktime ? new Date(g.unlocktime * 1000).toISOString().slice(0, 10) : '',
      raridade: raridade.has(x.name) ? raridade.get(x.name) : null, alvo: ''
    };
  });
  const r = { fonte: 'steam', grupos: [], trofeus, ...resumo(trofeus) };
  if (privado) r.aviso = 'A Steam não mostrou quais você já pegou. Deixe “Detalhes de jogos” como Público na privacidade da Steam.';
  return r;
}

export default async function handler(req, res) {
  try {
    await verificarUsuario(req);
    const q = req.query || {};
    const r = q.fonte === 'psn' ? await trofeusPsn(String(q.id || ''), String(q.plat || ''))
      : q.fonte === 'steam' ? await trofeusSteam(String(q.appid || ''))
      : null;
    if (!r) throw new ErroHttp(400, 'Informe a fonte (psn ou steam).');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ...r, atualizado: new Date().toISOString() });
  } catch (e) { responderErro(res, e); }
}
