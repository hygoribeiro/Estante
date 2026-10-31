// Tarefas diárias (Web Push + banco).
// - Chamado pelo cron da Vercel uma vez por dia (vercel.json, 00:00 UTC = 21:00 em Brasília):
//   1) backup semanal da estante (tabela backups, guarda as 8 mais recentes);
//   2) para quem ainda não registrou nada hoje, manda "sua sequência está em risco";
//   3) avisa quando um jogo da lista de desejos (Steam) chega no preço alvo ou tem 50%+ de desconto;
//   4) avisa quando o token da PSN (NPSSO) está para vencer (~10 dias antes) ou já venceu.
// - Chamado pelo app com ?teste=1 (usuário logado): manda uma notificação de teste.
// Variáveis na Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_SERVICE_ROLE_KEY e CRON_SECRET
// (mais SUPABASE_URL, que já existe). VAPID_EMAIL é opcional.
import webpush from 'web-push';
import { verificarUsuario, responderErro, ErroHttp, idTokenPsn } from './_comum.js';
import { loginPsn } from './_psn.js';
import { precosSteam } from './_precos.js';

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

// Notificações (chaves VAPID)
function configurarPush() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new ErroHttp(400, 'Lembrete não configurado: faltam VAPID_PUBLIC_KEY e/ou VAPID_PRIVATE_KEY na Vercel.');
  const contato = process.env.VAPID_EMAIL || process.env.EMAIL_PERMITIDO || 'lembrete@example.com';
  webpush.setVapidDetails(contato.startsWith('mailto:') ? contato : `mailto:${contato}`, pub, priv);
}
// Acesso ao banco com a chave de serviço (só no servidor; nunca vai para o app)
function conectar() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), servico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !servico) throw new ErroHttp(400, 'Falta SUPABASE_SERVICE_ROLE_KEY na Vercel.');
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

// ---------- Backup automático: uma cópia por semana, guarda as 8 mais recentes ----------
const SEMANA = 6.5 * 864e5, MANTER = 8;
async function fazerBackups(db, linhas) {
  let feitos = 0, apagados = 0;
  for (const { user_id: uid, dados } of linhas) {
    if (!dados || !Array.isArray(dados.jogos)) continue;
    const ult = await db(`backups?user_id=eq.${uid}&select=criado_em&order=criado_em.desc&limit=1`) || [];
    if (ult[0] && Date.now() - new Date(ult[0].criado_em).getTime() < SEMANA) continue;
    await db('backups', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, origem: 'auto', jogos: dados.jogos.length, livros: (dados.livros || []).length, dados }) });
    feitos++;
    const todos = await db(`backups?user_id=eq.${uid}&select=id&order=criado_em.desc`) || [];
    const sobra = todos.slice(MANTER).map(b => b.id);
    if (sobra.length) { await db(`backups?id=in.(${sobra.join(',')})`, { method: 'DELETE' }); apagados += sobra.length; }
  }
  return { feitos, apagados };
}

// ---------- Alerta de preço da lista de desejos (só Steam) ----------
// Com preço alvo: avisa quando o preço chega nele. Sem alvo: avisa a partir de 50% de desconto.
// A tabela alertas_preco lembra o último preço avisado, para não repetir o mesmo aviso todo dia.
const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
async function alertasPreco(db, porUsuario, linhas) {
  let avisos = 0;
  for (const [uid, lista] of Object.entries(porUsuario)) {
    const dados = (linhas.find(l => l.user_id === uid) || {}).dados || {};
    const desejos = (dados.desejos || []).filter(d => d && d.steamAppId);
    if (!desejos.length) continue;
    const precos = await precosSteam([...new Set(desejos.map(d => String(d.steamAppId)))]);
    const ja = Object.fromEntries((await db(`alertas_preco?user_id=eq.${uid}&select=appid,preco`) || []).map(a => [a.appid, Number(a.preco)]));
    const novos = [];
    for (const d of desejos) {
      const id = String(d.steamAppId), p = precos[id];
      if (!p || p.gratis) continue;
      const alvo = Number(d.precoAlvo) || 0;
      const vale = alvo > 0 ? p.atual <= alvo : p.desconto >= 50;
      if (vale && ja[id] !== p.atual) novos.push({ d, p, alvo });
      else if (!vale && id in ja) await db(`alertas_preco?user_id=eq.${uid}&appid=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    if (!novos.length) continue;
    const msg = novos.length === 1
      ? { titulo: `${novos[0].d.nome} por ${brl(novos[0].p.atual)}`,
          corpo: novos[0].alvo > 0 ? `Chegou no seu preço alvo (${brl(novos[0].alvo)})${novos[0].p.desconto ? ` · ${novos[0].p.desconto}% off` : ''}.` : `${novos[0].p.desconto}% de desconto na Steam.`, url: './#desejos' }
      : { titulo: `${novos.length} jogos da sua lista em promoção`, corpo: novos.map(n => `${n.d.nome} (${brl(n.p.atual)})`).join(', ').slice(0, 180), url: './#desejos' };
    if (await enviarPara(db, lista, msg)) {
      await db('alertas_preco', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(novos.map(n => ({ user_id: uid, appid: String(n.d.steamAppId), preco: n.p.atual, avisado_em: new Date().toISOString() }))) });
      avisos += novos.length;
    }
  }
  return { avisos };
}

// ---------- Token da PSN (NPSSO) ----------
// O app guarda em dados.integracoes.psnToken = { id, desde } o dia em que viu o token atual pela primeira vez.
// Aqui: 1) testa o login na PSN; se falhar, avisa que venceu; 2) se não, avisa ~10 dias antes dos ~60 dias.
// Cada aviso vai uma vez só por token (lembrado na tabela alertas_preco, com appid "psn-venceu:<id>" / "psn-perto:<id>").
const PSN_VALIDADE = 60, PSN_AVISAR = 50;
async function avisoTokenPsn(db, porUsuario, linhas) {
  const id = idTokenPsn();
  if (!id) return { psn: 'não configurada' };
  let valido = true;
  try { await loginPsn(); } catch (e) { valido = false; }
  let avisos = 0;
  for (const [uid, lista] of Object.entries(porUsuario)) {
    const t = (((linhas.find(l => l.user_id === uid) || {}).dados || {}).integracoes || {}).psnToken;
    let tipo = null, msg = null;
    if (!valido) {
      tipo = 'psn-venceu';
      msg = { titulo: 'O token da PSN venceu', corpo: 'A sincronização da PSN parou. Abra o app e toque em “Como renovar” (leva uns 3 minutos).', url: './#jogos' };
    } else if (t && t.id === id && t.desde) {
      const dias = Math.floor((Date.parse(hojeBrasil().iso) - Date.parse(t.desde)) / 864e5);
      if (dias >= PSN_AVISAR) {
        tipo = 'psn-perto';
        msg = { titulo: 'O token da PSN vence em breve', corpo: `Faltam uns ${Math.max(PSN_VALIDADE - dias, 0)} dia(s). Renove antes para não parar de sincronizar: Ajustes → Token da PSN → Como renovar.`, url: './#config' };
      }
    }
    if (!tipo) continue;
    const appid = `${tipo}:${id}`;
    const ja = await db(`alertas_preco?user_id=eq.${uid}&appid=eq.${encodeURIComponent(appid)}&select=appid`) || [];
    if (ja.length) continue;
    if (await enviarPara(db, lista, msg)) {
      await db('alertas_preco', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ user_id: uid, appid, preco: 0, avisado_em: new Date().toISOString() }]) });
      avisos++;
    }
  }
  return { valido, avisos };
}

// ---------- Lembrete da sequência ----------
async function lembretes(db, porUsuario, linhas) {
  const { iso: hoje, dia } = hojeBrasil();
  let enviadas = 0, pulados = 0;
  for (const [uid, lista] of Object.entries(porUsuario)) {
    const dados = (linhas.find(l => l.user_id === uid) || {}).dados || {};
    const eventos = dados.eventos || {}, cfg = dados.config || {};
    if (ativo(eventos[hoje]) || (cfg.descanso && DIAS[dia] === cfg.descanso)) { pulados++; continue; }
    const seq = sequenciaAteOntem(eventos, cfg.descanso);
    const msg = seq >= 2
      ? { titulo: `Sua sequência de ${seq} dias está em risco`, corpo: 'Ainda dá tempo: leia algumas páginas ou registre uma sessão de jogo hoje.', url: './#missoes' }
      : { titulo: 'Missões de hoje esperando', corpo: 'Umas páginas ou uma sessão rápida já contam para a sequência e dão XP.', url: './#missoes' };
    enviadas += await enviarPara(db, lista, msg);
  }
  return { enviadas, pulados };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Teste pedido pelo app (usuário logado)
    if (req.query && req.query.teste) {
      configurarPush();
      const db = conectar();
      const usuario = await verificarUsuario(req);
      const assin = await db(`lembretes?user_id=eq.${usuario.id}&select=endpoint,assinatura`);
      if (!assin || !assin.length) throw new ErroHttp(400, 'Nenhum aparelho com lembrete ativo. Toque em “Ativar neste aparelho” primeiro.');
      const n = await enviarPara(db, assin, { titulo: 'Lembrete funcionando', corpo: 'É assim que o aviso das 21h vai aparecer quando a sua sequência estiver em risco.', url: './#missoes' });
      return res.status(200).json({ enviadas: n });
    }

    // Cron diário: a Vercel envia "Authorization: Bearer <CRON_SECRET>"
    const segredo = process.env.CRON_SECRET;
    if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) throw new ErroHttp(401, 'Acesso negado.');
    const db = conectar();
    const linhas = await db('estante?select=user_id,dados') || [];
    // Cada tarefa roda separada: se uma falhar, as outras continuam
    const resultado = {};
    const etapa = async (nome, fn) => {
      try { resultado[nome] = await fn(); }
      catch (e) { console.error('Falha em', nome, e); resultado[nome] = { erro: String((e && e.message) || e).slice(0, 200) }; }
    };
    await etapa('backups', () => fazerBackups(db, linhas));
    let porUsuario = null;
    await etapa('notificacoes', async () => {
      configurarPush();
      const assin = await db('lembretes?select=endpoint,assinatura,user_id') || [];
      porUsuario = {};
      assin.forEach(a => { (porUsuario[a.user_id] = porUsuario[a.user_id] || []).push(a); });
      return { aparelhos: assin.length };
    });
    if (porUsuario) {
      await etapa('lembrete', () => lembretes(db, porUsuario, linhas));
      await etapa('precos', () => alertasPreco(db, porUsuario, linhas));
      await etapa('psn', () => avisoTokenPsn(db, porUsuario, linhas));
    }
    res.status(200).json(resultado);
  } catch (e) { responderErro(res, e); }
}
