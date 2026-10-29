// Entrega ao app as configurações PÚBLICAS do Supabase e quais integrações estão ligadas.
// (A chave "anon" do Supabase é pública por natureza; a segurança vem das regras RLS.)
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    integracoes: {
      steam: !!(process.env.STEAM_API_KEY && process.env.STEAM_ID),
      psn: !!process.env.PSN_NPSSO,
      ggdeals: !!process.env.GGDEALS_API_KEY
    },
    // Lembrete diário: a chave pública VAPID também é pública por natureza
    lembrete: {
      ativo: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CRON_SECRET),
      chave: process.env.VAPID_PUBLIC_KEY || ''
    }
  });
}
