// Aba Promoções.
//   GET /api/promocoes?tipo=steam        -> promoções em destaque da loja da Steam, em reais (sem chave)
//   GET /api/promocoes?tipo=ggdeals&ids=… -> preços da GG.deals (API oficial) para jogos da Steam:
//        melhor preço em lojas oficiais e em keyshops, e os menores preços da história.
//   GET /api/promocoes?tipo=itad&lista=novas|descontos|minimas -> ofertas de várias lojas de PC, em reais,
//        pela API oficial do IsThereAnyDeal (deals/v2).
// Variáveis na Vercel: GGDEALS_API_KEY e ITAD_API_KEY (chaves gratuitas, uso pessoal).
// Termos: a GG.deals pede crédito com link; o IsThereAnyDeal pede link/menção, que não se alterem
// preços nem links das lojas e que os dados não sejam usados para ajudar concorrentes dele
// (por isso a parte do IsThereAnyDeal só aponta para as lojas e para o próprio IsThereAnyDeal).
import { verificarUsuario, responderErro, ErroHttp } from './_comum.js';

async function pegarJson(url, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'Accept-Language': 'pt-BR' } });
    const corpo = await r.json().catch(() => null);
    return { status: r.status, corpo };
  } catch (e) { return { status: 0, corpo: null }; }
  finally { clearTimeout(t); }
}
const reais = c => Math.round(c) / 100;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Promoções em destaque da Steam: oferta do dia, "Promoções", mais vendidos e lançamentos com desconto
async function promocoesSteam() {
  const { status, corpo } = await pegarJson('https://store.steampowered.com/api/featuredcategories?cc=br&l=portuguese');
  if (status !== 200 || !corpo) throw new ErroHttp(502, 'A loja da Steam não respondeu agora. Tente de novo em alguns minutos.');
  const vistos = new Map();
  for (const [chave, cat] of Object.entries(corpo)) {
    if (!cat || !Array.isArray(cat.items)) continue;
    const origem = chave === 'specials' ? 'Promoção' : chave === 'top_sellers' ? 'Mais vendido' : chave === 'new_releases' ? 'Lançamento'
      : /daily/i.test(cat.name || '') ? 'Oferta do dia' : null;
    if (!origem) continue;
    for (const i of cat.items) {
      if (!i || !i.discounted || !i.discount_percent || vistos.has(i.id) || i.type !== 0) continue;
      vistos.set(i.id, {
        appid: String(i.id), nome: i.name, origem,
        desconto: i.discount_percent, atual: reais(i.final_price), original: reais(i.original_price),
        capa: i.header_image || i.large_capsule_image || '',
        fim: i.discount_expiration ? new Date(i.discount_expiration * 1000).toISOString() : ''
      });
    }
  }
  return [...vistos.values()].sort((a, b) => b.desconto - a.desconto);
}

// Preços da GG.deals por Steam App ID (até 100 por chamada)
async function precosGgDeals(ids) {
  const chave = (process.env.GGDEALS_API_KEY || '').trim();
  if (!chave) throw new ErroHttp(400, 'GG.deals não configurada: falta GGDEALS_API_KEY na Vercel.');
  const itens = {};
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const { status, corpo } = await pegarJson(`https://api.gg.deals/v1/prices/by-steam-app-id/?key=${encodeURIComponent(chave)}&ids=${lote.join(',')}&region=br`);
    // A GG.deals explica o erro em data.message (ex.: chave inválida vem como 400 "Invalid key.")
    const msg = String((corpo && corpo.data && corpo.data.message) || '');
    if (status === 401 || status === 403 || /invalid key|key/i.test(msg) && status >= 400)
      throw new ErroHttp(400, 'A GG.deals recusou a chave GGDEALS_API_KEY ("chave inválida"). Copie de novo a chave na sua conta da GG.deals, troque na Vercel e faça Redeploy.');
    if (status === 429) throw new ErroHttp(429, 'A GG.deals pediu para esperar um pouco (limite de consultas). Tente de novo em alguns minutos.');
    if (status === 0) throw new ErroHttp(502, 'A GG.deals não respondeu agora. Tente de novo em alguns minutos.');
    if (status !== 200 || !corpo || corpo.success === false)
      throw new ErroHttp(502, `A GG.deals recusou o pedido${msg ? `: "${msg.slice(0, 120)}"` : ` (código ${status})`}. Se continuar, me mande essa mensagem.`);
    const dados = corpo.data || {};
    for (const id of lote) {
      const g = dados[id];
      if (!g || !g.prices) { itens[id] = null; continue; }
      const p = g.prices;
      itens[id] = {
        titulo: g.title || '', url: g.url || '', moeda: p.currency || 'BRL',
        varejo: num(p.currentRetail), menorVarejo: num(p.historicalRetail),
        keyshop: num(p.currentKeyshops), menorKeyshop: num(p.historicalKeyshops)
      };
    }
  }
  return itens;
}

// Ofertas do IsThereAnyDeal (lojas de PC), em reais
const LISTAS_ITAD = {
  novas: { sort: '-time', limit: 80 },          // ofertas mais recentes
  descontos: { sort: '-cut', limit: 80 },        // maiores descontos
  minimas: { sort: '-time', limit: 200, soMinimas: true } // recentes que estão no menor preço da história
};
async function ofertasItad(lista) {
  const chave = (process.env.ITAD_API_KEY || '').trim();
  if (!chave) throw new ErroHttp(400, 'IsThereAnyDeal não configurado: falta ITAD_API_KEY na Vercel.');
  const cfg = LISTAS_ITAD[lista];
  if (!cfg) throw new ErroHttp(400, 'Lista desconhecida.');
  const { status, corpo } = await pegarJson(`https://api.isthereanydeal.com/deals/v2?key=${encodeURIComponent(chave)}&country=BR&limit=${cfg.limit}&sort=${encodeURIComponent(cfg.sort)}`);
  const msg = String((corpo && (corpo.reason_phrase || corpo.error || corpo.message)) || '');
  if (status === 401 || status === 403) throw new ErroHttp(400, `O IsThereAnyDeal recusou a chave ITAD_API_KEY${msg ? ` ("${msg.slice(0, 80)}")` : ''}. Confira a chave na Vercel e faça Redeploy.`);
  if (status === 429) throw new ErroHttp(429, 'O IsThereAnyDeal pediu para esperar um pouco (limite de consultas). Tente de novo em alguns minutos.');
  if (status !== 200 || !corpo || !Array.isArray(corpo.list)) throw new ErroHttp(502, `O IsThereAnyDeal não respondeu agora${msg ? ` ("${msg.slice(0, 80)}")` : ''}. Tente de novo em alguns minutos.`);
  const valor = p => p && typeof p.amount === 'number' ? Math.round(p.amount * 100) / 100 : null;
  let itens = corpo.list.filter(x => x && x.deal && x.deal.price).map(x => {
    const d = x.deal, a = x.assets || {};
    const preco = valor(d.price), menor = valor(d.historyLow);
    return {
      id: x.id, titulo: x.title || '', tipo: x.type || '', slug: x.slug || '',
      capa: a.banner400 || a.banner300 || a.banner600 || a.boxart || '',
      loja: (d.shop && d.shop.name) || '', preco, original: valor(d.regular), desconto: d.cut || 0,
      menorHistoria: menor, menorLoja: valor(d.storeLow), ehMinima: preco != null && menor != null && preco <= menor,
      drm: (d.drm || []).map(z => z.name).filter(Boolean), voucher: d.voucher || '',
      inicio: d.timestamp || '', expira: d.expiry || '', url: d.url || '',
      pagina: x.slug ? `https://isthereanydeal.com/game/${encodeURIComponent(x.slug)}/info/` : 'https://isthereanydeal.com/deals/'
    };
  });
  if (cfg.soMinimas) itens = itens.filter(i => i.ehMinima).slice(0, 80);
  return itens;
}

export default async function handler(req, res) {
  try {
    await verificarUsuario(req);
    const q = req.query || {};
    res.setHeader('Cache-Control', 'no-store');
    if (q.tipo === 'steam') return res.status(200).json({ itens: await promocoesSteam(), atualizado: new Date().toISOString() });
    if (q.tipo === 'ggdeals') {
      const ids = [...new Set(String(q.ids || '').split(',').map(s => s.trim()).filter(s => /^\d{1,10}$/.test(s)))].slice(0, 300);
      if (!ids.length) return res.status(200).json({ itens: {} });
      return res.status(200).json({ itens: await precosGgDeals(ids), atualizado: new Date().toISOString() });
    }
    if (q.tipo === 'itad') return res.status(200).json({ itens: await ofertasItad(String(q.lista || 'novas')), atualizado: new Date().toISOString() });
    throw new ErroHttp(400, 'Informe tipo=steam, tipo=ggdeals ou tipo=itad.');
  } catch (e) { responderErro(res, e); }
}
