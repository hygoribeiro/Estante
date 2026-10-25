// Lembrete diário por notificação (Web Push).
// - Chamado pelo cron da Vercel uma vez por dia (vercel.json, 00:00 UTC = 21:00 em Brasília):
//   para quem ainda não registrou nada hoje, manda "sua sequência está em risco".
// - Chamado pelo app com ?teste=1 (usuário logado): manda uma notificação de teste.
// Variáveis na Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_SERVICE_ROLE_KEY e CRON_SECRET
// (mais SUPABASE_URL, que já existe). VAPID_EMAIL é opcional.
import webpush from 'web-push';
import { verificarUsuario, responderErro, ErroHttp } from './_comum.js';

const FUSO = 'America/Sao_Paulo';
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

// Data (AAAA-MM-DD) e dia da semana no horário de Brasília
function hojeBrasil(deslocDias = 0) {
  const d = new Date(Date.now() + deslocDias * 864e5);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const ativo = e => !!e && ((e.pag || 0) > 0 || (e.horas || 0) > 0 || (e.concl || 0) > 0 || (e.atual || 0) > 0);

// Dias seguidos ativos até ontem (o dia de descanso não quebra nem conta)
function sequenciaAteOntem(eventos, descanso) {
  let n = 0;
  for (let i = 1; i < 400; i++) {
    const { iso, dia } = hojeBrasil(-i);
    if (ativo(eventos[iso])) n++;
    else if (descanso && DIAS[dia] === descanso) continue;
    else break;
  }
  return n;
}

function configurar() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), servico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!pub || !priv || !url || !servico) throw new ErroHttp(400, 'Lembrete não configurado: faltam VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e/ou SUPABASE_SERVICE_ROLE_KEY na Vercel.');
  const contato = process.env.VAPID_EMAIL || process.env.EMAIL_PERMITIDO || 'lembrete@example.com';
  webpush.setVapidDetails(contato.startsWith('mailto:') ? contato : `mailto:${contato}`, pub, priv);
  // Acesso ao banco com a chave de serviço (só no servidor; nunca vai para o app)
  return async (caminho, opcoes = {}) => {
    const r = await fetch(`${url}/rest/v1/${caminho}`, { ...opcoes, headers: { apikey: servico, Authorization: `Bearer ${servico}`, 'Content-Type': 'application/json', ...(opcoes.headers || {}) } });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  };
}

// Envia para todas as assinaturas de um usuário; apaga as que o navegador já descartou
async function enviarPara(db, assinaturas, mensagem) {
  let enviadas = 0;
  for (const a of assinaturas) {
    try { await webpush.sendNotification(a.assinatura, JSON.stringify(mensagem), { TTL: 6 * 3600 }); enviadas++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await db(`lembretes?endpoint=eq.${encodeURIComponent(a.endpoint)}`, { method: 'DELETE' });
      else console.warn('Falha ao enviar lembrete', e.statusCode, e.body);
    }
  }
  return enviadas;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const db = configurar();

    // Teste pedido pelo app (usuário logado)
    if (req.query && req.query.teste) {
      const usuario = await verificarUsuario(req);
      const assin = await db(`lembretes?user_id=eq.${usuario.id}&select=endpoint,assinatura`);
      if (!assin || !assin.length) throw new ErroHttp(400, 'Nenhum aparelho com lembrete ativo. Toque em “Ativar neste aparelho” primeiro.');
      const n = await enviarPara(db, assin, { titulo: 'Lembrete funcionando', corpo: 'É assim que o aviso das 21h vai aparecer quando a sua sequência estiver em risco.', url: './#missoes' });
      return res.status(200).json({ enviadas: n });
    }

    // Cron diário: a Vercel envia "Authorization: Bearer <CRON_SECRET>"
    const segredo = process.env.CRON_SECRET;
    if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) throw new ErroHttp(401, 'Acesso negado.');
    const assin = await db('lembretes?select=endpoint,assinatura,user_id') || [];
    const porUsuario = {};
    assin.forEach(a => { (porUsuario[a.user_id] = porUsuario[a.user_id] || []).push(a); });
    const { iso: hoje, dia } = hojeBrasil();
    let enviadas = 0, pulados = 0;
    for (const [uid, lista] of Object.entries(porUsuario)) {
      const linhas = await db(`estante?user_id=eq.${uid}&select=dados`);
      const dados = (linhas && linhas[0] && linhas[0].dados) || {};
      const eventos = dados.eventos || {}, cfg = dados.config || {};
      if (ativo(eventos[hoje]) || (cfg.descanso && DIAS[dia] === cfg.descanso)) { pulados++; continue; }
      const seq = sequenciaAteOntem(eventos, cfg.descanso);
      const msg = seq >= 2
        ? { titulo: `Sua sequência de ${seq} dias está em risco`, corpo: 'Ainda dá tempo: leia algumas páginas ou registre uma sessão de jogo hoje.', url: './#missoes' }
        : { titulo: 'Missões de hoje esperando', corpo: 'Umas páginas ou uma sessão rápida já contam para a sequência e dão XP.', url: './#missoes' };
      enviadas += await enviarPara(db, lista, msg);
    }
    res.status(200).json({ enviadas, pulados });
  } catch (e) { responderErro(res, e); }
}
