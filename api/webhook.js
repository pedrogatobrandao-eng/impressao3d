const crypto = require('crypto');

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');

  const body = req.body || {};

  // Confere que o aviso veio da Kiwify (assinatura gerada com o token do webhook)
  const token = process.env.KIWIFY_TOKEN;
  if (token) {
    const sig = (req.query && req.query.signature) || '';
    const calc = crypto.createHmac('sha1', token).update(JSON.stringify(body)).digest('hex');
    if (sig !== calc) {
      console.log('Assinatura invalida. Recebida:', sig);
      return res.status(401).json({ error: 'assinatura invalida' });
    }
  }

  // So continua se a compra foi aprovada (ignora boleto/pix gerado, recusado etc.)
  const aprovado = body.order_status === 'paid' || body.webhook_event_type === 'order_approved';
  if (!aprovado) return res.status(200).json({ ignorado: true });

  const cliente = body.Customer || {};
  const email = cliente.email;
  const nome = cliente.first_name || cliente.full_name || '';
  if (!email) {
    console.log('Pagamento sem e-mail no corpo:', JSON.stringify(body));
    return res.status(400).json({ error: 'sem email' });
  }

  const link = process.env.ACCESS_URL;
  if (!link || !process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
    console.log('Faltam variaveis de ambiente (ACCESS_URL, BREVO_API_KEY, BREVO_SENDER_EMAIL)');
    return res.status(500).json({ error: 'configuracao incompleta' });
  }

  const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#14161a;line-height:1.6">
  <h2 style="color:#ff6a1a">Seu acesso chegou! 🖨️</h2>
  <p>Olá${nome ? ', ' + esc(nome) : ''}!</p>
  <p>Parabéns pela decisão e seja muito bem-vindo(a) ao <b>Impressão 3D Lucrativa</b>.</p>
  <p>Seu acesso às 10 aulas está liberado. Clique no botão abaixo:</p>
  <p style="margin:24px 0"><a href="${esc(link)}" style="background:#ff6a1a;color:#fff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:10px;display:inline-block">Acessar as aulas</a></p>
  <p>Se o botão não abrir, copie este endereço no navegador:<br><a href="${esc(link)}">${esc(link)}</a></p>
  <p><b>Dica:</b> salve o link nos favoritos. Seu progresso fica salvo no navegador onde você assistir as aulas.</p>
  <p>Qualquer dúvida, é só responder este e-mail.</p>
  <p>Bons estudos e boas impressões!</p>
</div>`;

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || 'Impressão 3D Lucrativa',
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [{ email, name: nome || email }],
      subject: 'Seu acesso ao Impressão 3D Lucrativa chegou! 🖨️',
      htmlContent: html,
    }),
  });

  if (!r.ok) {
    console.log('Erro da Brevo:', r.status, await r.text());
    return res.status(502).json({ error: 'falha ao enviar email' });
  }

  return res.status(200).json({ enviado: true });
};  
