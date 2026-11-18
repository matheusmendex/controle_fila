import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { supabase } from './supabase.js';

const required = ['DEVICE_KEY', 'BOOTSTRAP_USERNAME', 'BOOTSTRAP_PASSWORD', 'BOOTSTRAP_ATTENDANT_NAME', 'BOOTSTRAP_DESK_CODE'];
for (const key of required) if (!process.env[key] || process.env[key].startsWith('ESCOLHA_') || process.env[key].startsWith('CRIE_')) throw new Error(`Preencha ${key} no arquivo .env antes de continuar.`);
if (process.env.BOOTSTRAP_PASSWORD.length < 10) throw new Error('BOOTSTRAP_PASSWORD deve ter pelo menos 10 caracteres.');
if (process.env.DEVICE_KEY.length < 32) throw new Error('DEVICE_KEY deve ter pelo menos 32 caracteres aleatórios.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('GERE_')) throw new Error('Preencha JWT_SECRET com um segredo aleatório de ao menos 32 caracteres.');

const deskCode = process.env.BOOTSTRAP_DESK_CODE;
const { data: desk, error: deskError } = await supabase.from('guiches').select('id').eq('codigo', deskCode).single();
if (deskError || !desk) throw new Error(`Guichê ${deskCode} não encontrado. Execute primeiro o SQL do Supabase.`);

const { error: deviceError } = await supabase.from('dispositivos').upsert({ codigo: process.env.DEVICE_ID || 'E6-FILA', chave_secreta: process.env.DEVICE_KEY, status: 'offline' }, { onConflict: 'codigo' });
if (deviceError) throw deviceError;

const username = process.env.BOOTSTRAP_USERNAME.trim().toLowerCase();
const { error: userError } = await supabase.from('atendentes').upsert({ usuario: username, nome: process.env.BOOTSTRAP_ATTENDANT_NAME.trim(), senha_hash: await bcrypt.hash(process.env.BOOTSTRAP_PASSWORD, 12), guiche_id: desk.id, ativo: true }, { onConflict: 'usuario' });
if (userError) throw userError;
console.log(`Dispositivo ${process.env.DEVICE_ID || 'E6-FILA'} e atendente ${username} configurados.`);
