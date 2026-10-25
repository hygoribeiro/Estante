// Funções compartilhadas pelas rotas /api (arquivos com "_" não viram rota na Vercel)

export class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

// Confere o login do Supabase enviado pelo app (cabeçalho Authorization: Bearer <token>)
// e, se EMAIL_PERMITIDO estiver definido, aceita só esse e-mail.
export async function verificarUsuario(req) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || '';
  if (!url || !anon) throw new ErroHttp(500, 'Faltam SUPABASE_URL e SUPABASE_ANON_KEY na Vercel.');
  const cab = req.headers.authorization || req.headers.Authorization || '';
  const token = cab.startsWith('Bearer ') ? cab.slice(7) : '';
  if (!token) throw new ErroHttp(401, 'Faça login para sincronizar.');
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new ErroHttp(401, 'Sua sessão expirou. Entre de novo.');
  const usuario = await r.json();
  const permitido = (process.env.EMAIL_PERMITIDO || '').trim().toLowerCase();
  if (permitido && String(usuario.email || '').toLowerCase() !== permitido) throw new ErroHttp(403, 'Este usuário não tem permissão.');
  return usuario;
}

export function responderErro(res, e) {
  const status = e instanceof ErroHttp ? e.status : 500;
  if (!(e instanceof ErroHttp)) console.error(e);
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ erro: e instanceof ErroHttp ? e.message : 'Erro inesperado no servidor. Tente de novo em instantes.' });
}

// Normaliza nomes para comparar (sem acentos, símbolos ™ ®, minúsculo)
export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Executa tarefas em paralelo, no máximo "limite" por vez
export async function emLotes(lista, limite, tarefa) {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, lista.length) }, async () => {
    while (i < lista.length) { const item = lista[i++]; await tarefa(item); }
  });
  await Promise.all(trabalhadores);
}
