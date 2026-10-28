// Lista de desejos: busca jogos e preços na loja da Steam (em reais).
// A loja da Steam não exige chave, mas não deixa o navegador consultar direto (CORS),
// por isso o app pergunta por aqui.
//   GET /api/precos?busca=hollow knight   -> { itens: [{ appid, nome, preco, capa }] }
//   GET /api/precos?appids=1145360,367520 -> { precos: { "1145360": { atual, original, desconto } } }
import { verificarUsuario, responderErro, ErroHttp } from './_comum.js';
import { buscarSteam, precosSteam } from './_precos.js';

export default async function handler(req, res) {
  try {
    await verificarUsuario(req);
    const q = req.query || {};
    res.setHeader('Cache-Control', 'no-store');
    if (q.busca) {
      const termo = String(q.busca).trim().slice(0, 80);
      if (termo.length < 2) throw new ErroHttp(400, 'Digite pelo menos 2 letras.');
      return res.status(200).json({ itens: await buscarSteam(termo) });
    }
    if (q.appids) {
      const ids = [...new Set(String(q.appids).split(',').map(s => s.trim()).filter(s => /^\d{1,10}$/.test(s)))].slice(0, 200);
      return res.status(200).json({ precos: await precosSteam(ids) });
    }
    throw new ErroHttp(400, 'Informe "busca" ou "appids".');
  } catch (e) { responderErro(res, e); }
}
