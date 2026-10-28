// Consultas à loja da Steam (preços em reais), usadas pelo app e pelo cron diário.
import { ErroHttp } from './_comum.js';

const LOJA = 'https://store.steampowered.com/api';

async function pegarJson(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'Accept-Language': 'pt-BR' } });
    if (!r.ok) throw new ErroHttp(502, 'A loja da Steam não respondeu agora. Tente de novo em alguns minutos.');
    return await r.json();
  } catch (e) {
    if (e instanceof ErroHttp) throw e;
    throw new ErroHttp(502, 'A loja da Steam não respondeu agora. Tente de novo em alguns minutos.');
  } finally { clearTimeout(t); }
}
const reais = centavos => Math.round(centavos) / 100;

// Busca por nome (só jogos, não trilhas sonoras/DLCs quando dá para saber)
export async function buscarSteam(termo) {
  const d = await pegarJson(`${LOJA}/storesearch/?term=${encodeURIComponent(termo)}&cc=br&l=portuguese`);
  return (d.items || []).filter(i => i.type === 'app').slice(0, 10).map(i => ({
    appid: String(i.id),
    nome: i.name,
    preco: i.price ? { atual: reais(i.price.final), original: reais(i.price.initial), desconto: i.price.initial > i.price.final ? Math.round((1 - i.price.final / i.price.initial) * 100) : 0 } : null,
    capa: `https://cdn.cloudflare.steamstatic.com/steam/apps/${i.id}/library_600x900.jpg`
  }));
}

// Preço atual de vários jogos (a Steam aceita vários de uma vez com filters=price_overview)
export async function precosSteam(ids) {
  const precos = {};
  for (let i = 0; i < ids.length; i += 40) {
    const lote = ids.slice(i, i + 40);
    const d = await pegarJson(`${LOJA}/appdetails?appids=${lote.join(',')}&cc=br&filters=price_overview`);
    for (const id of lote) {
      const x = d[id];
      if (!x || !x.success) { precos[id] = null; continue; }
      const p = x.data && x.data.price_overview;
      // Sem price_overview = jogo gratuito ou fora de venda
      precos[id] = p ? { atual: reais(p.final), original: reais(p.initial), desconto: p.discount_percent || 0 } : { atual: 0, original: 0, desconto: 0, gratis: true };
    }
  }
  return precos;
}
