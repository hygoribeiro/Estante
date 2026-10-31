// Acesso à API oficial da Steam, compartilhado pelas rotas /api/steam e /api/trofeus.
import { ErroHttp } from './_comum.js';

export const BASE = 'https://api.steampowered.com';

// Devolve o JSON, ou { __status } quando a Steam responde com erro / não responde
export async function pegarJson(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return { __status: r.status };
    return await r.json();
  } catch (e) { return { __status: 0 }; }
  finally { clearTimeout(t); }
}

// Lê STEAM_API_KEY e STEAM_ID da Vercel; converte nome personalizado do perfil em SteamID64
export async function credenciaisSteam() {
  const chave = (process.env.STEAM_API_KEY || '').trim();
  const id = (process.env.STEAM_ID || '').trim();
  if (!chave || !id) throw new ErroHttp(400, 'Steam não configurada: faltam STEAM_API_KEY e/ou STEAM_ID na Vercel.');
  const k = encodeURIComponent(chave);
  let steamid = id;
  if (!/^\d{17}$/.test(id)) {
    const v = await pegarJson(`${BASE}/ISteamUser/ResolveVanityURL/v1/?key=${k}&vanityurl=${encodeURIComponent(id)}`);
    if (v.__status === 401 || v.__status === 403) throw new ErroHttp(400, 'A chave STEAM_API_KEY foi recusada pela Steam.');
    if (v.__status !== undefined) throw new ErroHttp(502, 'A Steam não respondeu agora. Tente de novo em alguns minutos.');
    if (!v.response || v.response.success !== 1) throw new ErroHttp(400, 'Não encontrei esse STEAM_ID. Use o número de 17 dígitos do seu perfil.');
    steamid = v.response.steamid;
  }
  return { k, steamid };
}
