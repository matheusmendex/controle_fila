import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from './supabase.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith('GERE_')) throw new Error('Preencha JWT_SECRET com um segredo aleatório de ao menos 32 caracteres.');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN === '*' ? '*' : (process.env.CORS_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean) }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, message) => res.status(status).json({ error: message });
const iso = date => new Date(date).toISOString();

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'e6-fila-api' }));

const deviceAuth = asyncRoute(async (req, res, next) => {
  const provided = Buffer.from(req.get('x-device-key') || '');
  const expected = Buffer.from(process.env.DEVICE_KEY || '');
  if (!expected.length || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return fail(res, 401, 'Dispositivo não autorizado.');
  const code = process.env.DEVICE_ID || 'E6-FILA';
  const { data, error } = await supabase.from('dispositivos').select('id,codigo').eq('codigo', code).single();
  if (error || !data) return fail(res, 503, 'Dispositivo ainda não cadastrado. Execute npm run setup:initial.');
  req.device = data;
  next();
});

const requireUser = asyncRoute(async (req, res, next) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'Entre novamente para continuar.');
  try { req.user = jwt.verify(token, jwtSecret); next(); }
  catch { return fail(res, 401, 'Sessão inválida ou expirada.'); }
});

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const username = String(req.body?.usuario || '').trim().toLowerCase();
  const password = String(req.body?.senha || '');
  if (!username || !password) return fail(res, 400, 'Informe usuário e senha.');
  const { data, error } = await supabase.from('atendentes').select('id,usuario,nome,senha_hash,ativo,guiches(id,codigo,nome,ativo)').eq('usuario', username).maybeSingle();
  if (error) throw error;
  if (!data || !data.ativo || !data.guiches?.ativo || !(await bcrypt.compare(password, data.senha_hash))) return fail(res, 401, 'Usuário ou senha inválidos.');
  const attendant = { id: data.id, usuario: data.usuario, nome: data.nome, guiche_id: data.guiches.id, guiche: data.guiches.nome, guiche_codigo: data.guiches.codigo };
  const token = jwt.sign(attendant, jwtSecret, { expiresIn: '12h', issuer: 'e6-fila-api', audience: 'e6-fila-app' });
  res.json({ token, atendente: attendant });
}));

app.get('/api/auth/me', requireUser, (req, res) => res.json({ atendente: req.user }));

app.post('/api/eventos', deviceAuth, asyncRoute(async (req, res) => {
  const event = req.body || {};
  if (event.device_id && event.device_id !== (process.env.DEVICE_ID || 'E6-FILA')) return fail(res, 400, 'Código do dispositivo inválido.');
  if (!['botao_comum', 'botao_prioritaria'].includes(event.tipo)) return fail(res, 400, 'Tipo de evento inválido.');
  const sequence = Number(event.sequencia);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return fail(res, 400, 'Sequência do evento inválida.');
  const { data, error } = await supabase.rpc('emitir_senha', { p_dispositivo_id: req.device.id, p_sequencia_evento: sequence, p_tipo: event.tipo === 'botao_prioritaria' ? 'prioritaria' : 'comum' });
  if (error) throw error;
  await supabase.from('dispositivos').update({ status: 'online', ultima_comunicacao: new Date().toISOString() }).eq('id', req.device.id);
  res.status(data?.duplicada ? 200 : 201).json({ senha: data.codigo, id: data.id, duplicada: Boolean(data.duplicada) });
}));

app.post('/api/atendimento/simular', requireUser, asyncRoute(async (req, res) => {
  const tipo = req.body?.tipo;
  if (!['comum', 'prioritaria'].includes(tipo)) return fail(res, 400, 'Tipo de senha inválido.');
  const requestId = req.get('idempotency-key') || crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return fail(res, 400, 'Identificador da solicitação inválido.');
  const { data, error } = await supabase.rpc('emitir_senha_simulada', { p_request_id: requestId, p_tipo: tipo });
  if (error) throw error;
  res.status(data?.duplicada ? 200 : 201).json({ ticket: data, origem: 'app_teste' });
}));

app.get('/api/comandos/pendentes', deviceAuth, asyncRoute(async (req, res) => {
  if (req.query.device && req.query.device !== (process.env.DEVICE_ID || 'E6-FILA')) return fail(res, 400, 'Código do dispositivo inválido.');
  const now = new Date().toISOString();
  const [{ error: heartbeatError }, { data, error }] = await Promise.all([
    supabase.from('dispositivos').update({ status: 'online', ultima_comunicacao: now }).eq('id', req.device.id),
    supabase.from('comandos').select('id,acao,parametros').eq('dispositivo_id', req.device.id).eq('status', 'pendente').order('criado_em').limit(20),
  ]);
  if (heartbeatError) throw heartbeatError;
  if (error) throw error;
  res.json(data || []);
}));

app.post('/api/comandos/:id/confirmacao', deviceAuth, asyncRoute(async (req, res) => {
  const status = req.body?.status;
  if (!['executado', 'falhou'].includes(status)) return fail(res, 400, 'Status de confirmação inválido.');
  const { data, error } = await supabase.from('comandos').update({ status, retorno: String(req.body?.retorno || '').slice(0, 500), executado_em: new Date().toISOString() }).eq('id', req.params.id).eq('dispositivo_id', req.device.id).eq('status', 'pendente').select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'Comando não encontrado ou já encerrado.');
  res.json({ ok: true });
}));

app.post('/api/atendimento/chamar-proxima', requireUser, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.rpc('chamar_proxima', { p_guiche_id: req.user.guiche_id });
  if (error) { if (error.message?.includes('QUEUE_EMPTY')) return res.json({ ticket: null }); throw error; }
  res.json({ ticket: data, senha: data?.codigo });
}));

app.post('/api/atendimento/:id/acao', requireUser, asyncRoute(async (req, res) => {
  const action = String(req.body?.acao || '');
  if (!['repetir', 'iniciar', 'finalizar', 'ausente'].includes(action)) return fail(res, 400, 'Ação inválida.');
  const { data, error } = await supabase.rpc('alterar_atendimento', { p_senha_id: Number(req.params.id), p_guiche_id: req.user.guiche_id, p_acao: action });
  if (error) { if (error.message?.includes('ACTION_INVALID')) return fail(res, 409, 'Esta ação não está disponível para o estado atual da senha.'); throw error; }
  res.json({ ticket: data });
}));

app.get('/api/dashboard', asyncRoute(async (_req, res) => {
  const [{ data: current, error: currentError }, { data: recent, error: recentError }, { data: device, error: deviceError }, { count, error: countError }, { data: done, error: doneError }] = await Promise.all([
    supabase.from('senhas').select('id,codigo,tipo,status,emitida_em,chamada_em,guiches(nome)').in('status', ['chamada', 'em_atendimento']).order('chamada_em', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('historico_chamadas').select('senha_id,codigo,tipo,chamada_em,guiche').order('chamada_em', { ascending: false }).limit(4),
    supabase.from('dispositivos').select('ultima_comunicacao').eq('codigo', process.env.DEVICE_ID || 'E6-FILA').maybeSingle(),
    supabase.from('senhas').select('id', { count: 'exact', head: true }).eq('status', 'aguardando'),
    supabase.from('senhas').select('emitida_em,chamada_em,inicio_em,fim_em').not('chamada_em', 'is', null).not('fim_em', 'is', null).order('fim_em', { ascending: false }).limit(100),
  ]);
  for (const error of [currentError, recentError, deviceError, countError, doneError]) if (error) throw error;
  const deviceAt = device?.ultima_comunicacao ? new Date(device.ultima_comunicacao) : null;
  const mins = (rows, start, end) => rows.length ? Math.round(rows.reduce((sum, row) => sum + Math.max(0, new Date(row[end]) - new Date(row[start])) / 60000, 0) / rows.length) : 0;
  const attended = (done || []).filter(row => row.inicio_em);
  res.json({
    atual: current ? { ...current, guiche: current.guiches?.nome || null } : null,
    ultimas: (recent || []).map(row => ({ id: row.senha_id, codigo: row.codigo, tipo: row.tipo, chamada_em: row.chamada_em, guiche: row.guiche })),
    dispositivo: { online: Boolean(deviceAt && Date.now() - deviceAt.getTime() < 15000), ultima_comunicacao: device?.ultima_comunicacao || null },
    indicadores: { aguardando: count || 0, espera_media_minutos: mins(done || [], 'emitida_em', 'chamada_em'), atendimento_medio_minutos: mins(attended, 'inicio_em', 'fim_em') },
  });
}));

app.get('/api/tickets/:codigo', asyncRoute(async (req, res) => {
  const code = req.params.codigo.toUpperCase().slice(0, 20);
  const { data: ticket, error } = await supabase.from('senhas').select('id,codigo,tipo,status,emitida_em,chamada_em,inicio_em,fim_em').eq('codigo', code).order('emitida_em', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!ticket) return fail(res, 404, 'Não encontramos essa senha. Confira o código impresso.');
  const { count, error: countError } = await supabase.from('senhas').select('id', { count: 'exact', head: true }).eq('fila_id', 1).eq('status', 'aguardando').lt('emitida_em', ticket.emitida_em);
  if (countError) throw countError;
  res.json({ senha: ticket, pessoas_a_frente: ticket.status === 'aguardando' ? (count || 0) : 0 });
}));

app.use((error, _req, res, _next) => {
  console.error('[api]', error);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

app.listen(port, '0.0.0.0', () => console.log(`E6-FILA API ouvindo na porta ${port}`));
