// Sincronização com a Steam (API oficial).
// Variáveis na Vercel: STEAM_API_KEY (steamcommunity.com/dev/apikey) e STEAM_ID
// (número de 17 dígitos ou o nome personalizado do perfil).
import { verificarUsuario, responderErro, ErroHttp, emLotes } from './_comum.js';

const BASE = 'https://api.steampowered.com';

async function pegarJson(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return { __status: r.status };
    return await r.json();
  } catch (e) { return { __status: 0 }; }
  finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  try {
    await verificarUsuario(req);
    const chave = (process.env.STEAM_API_KEY || '').trim();
    const id = (process.env.STEAM_ID || '').trim();
    if (!chave || !id) throw new ErroHttp(400, 'Steam não configurada: faltam STEAM_API_KEY e/ou STEAM_ID na Vercel.');
    const k = encodeURIComponent(chave);

    // Converte nome personalizado do perfil em SteamID64
    let steamid = id;
    if (!/^\d{17}$/.test(id)) {
      const v = await pegarJson(`${BASE}/ISteamUser/ResolveVanityURL/v1/?key=${k}&vanityurl=${encodeURIComponent(id)}`);
      if (v.__status === 401 || v.__status === 403) throw new ErroHttp(400, 'A chave STEAM_API_KEY foi recusada pela Steam.');
      if (!v.response || v.response.success !== 1) throw new ErroHttp(400, 'Não encontrei esse STEAM_ID. Use o número de 17 dígitos do seu perfil.');
      steamid = v.response.steamid;
    }

    const dono = await pegarJson(`${BASE}/IPlayerService/GetOwnedGames/v1/?key=${k}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1&format=json`);
    if (dono.__status === 401 || dono.__status === 403) throw new ErroHttp(400, 'A chave STEAM_API_KEY foi recusada pela Steam.');
    if (dono.__status !== undefined) throw new ErroHttp(502, 'A Steam não respondeu agora. Tente de novo em alguns minutos.');
    const jogos = dono.response && dono.response.games;
    if (!Array.isArray(jogos)) throw new ErroHttp(400, 'A Steam não devolveu sua biblioteca. Deixe o perfil e os “Detalhes de jogos” como Públicos nas configurações de privacidade da Steam.');

    // Conquistas: só para jogos com horas jogadas (evita centenas de chamadas inúteis)
    const conquistas = new Map();
    const inicio = Date.now();
    let estourouTempo = false;
    await emLotes(jogos.filter(g => g.playtime_forever > 0), 10, async g => {
      if (Date.now() - inicio > 45000) { estourouTempo = true; return; }
      const r = await pegarJson(`${BASE}/ISteamUserStats/GetPlayerAchievements/v1/?key=${k}&steamid=${steamid}&appid=${g.appid}`);
      const ps = r.playerstats;
      if (ps && ps.success && Array.isArray(ps.achievements) && ps.achievements.length) {
        const feitas = ps.achievements.filter(a => a.achieved === 1);
        const ultima = feitas.reduce((m, a) => Math.max(m, a.unlocktime || 0), 0);
        conquistas.set(g.appid, {
          progresso: Math.floor(feitas.length / ps.achievements.length * 100),
          completo: feitas.length === ps.achievements.length,
          ultima
        });
      } else if (r.__status === 400 || (ps && (ps.success === false || !ps.achievements))) {
        conquistas.set(g.appid, { semConquistas: true });
      }
    });

    const itens = jogos.map(g => {
      const c = conquistas.get(g.appid);
      const temConquistas = c ? !c.semConquistas : null;
      return {
        chave: String(g.appid),
        nome: g.name || `App ${g.appid}`,
        plataforma: 'Steam',
        horas: Math.round((g.playtime_forever || 0) / 6) / 10,
        progresso: temConquistas ? c.progresso : null,
        temConquistas,
        concluido100: !!(c && c.completo),
        conclusao: c && c.completo && c.ultima ? new Date(c.ultima * 1000).toISOString().slice(0, 10) : ''
      };
    });
    const avisos = [];
    if (estourouTempo) avisos.push('Algumas conquistas não foram lidas a tempo. Sincronize de novo para completar.');

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ itens, avisos });
  } catch (e) { responderErro(res, e); }
}
