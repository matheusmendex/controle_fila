-- E6-FILA | execute uma vez no SQL Editor do Supabase.
-- A API usa SUPABASE_SERVICE_ROLE_KEY no servidor. Nunca coloque essa chave no app.

create table if not exists public.dispositivos (
  id uuid primary key default gen_random_uuid(),
  codigo varchar(50) unique not null,
  chave_secreta varchar(120) not null,
  status varchar(20) not null default 'offline' check (status in ('online','offline')),
  ultima_comunicacao timestamptz,
  criado_em timestamptz not null default now()
);

create table if not exists public.filas (
  id serial primary key,
  nome varchar(60) not null,
  prefixo_comum varchar(5) not null default 'C',
  prefixo_prioritaria varchar(5) not null default 'P',
  max_prioritarias_seguidas int not null default 2 check (max_prioritarias_seguidas > 0),
  prioritarias_consecutivas int not null default 0,
  ativa boolean not null default true
);

create table if not exists public.guiches (
  id serial primary key,
  codigo varchar(20) unique not null,
  nome varchar(60) not null,
  ativo boolean not null default true
);

create table if not exists public.atendentes (
  id uuid primary key default gen_random_uuid(),
  usuario varchar(80) unique not null,
  nome varchar(100) not null,
  senha_hash text not null,
  guiche_id int not null references public.guiches(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.contadores_senhas (
  fila_id int not null references public.filas(id),
  tipo varchar(20) not null check (tipo in ('comum','prioritaria')),
  dia date not null,
  ultimo_numero int not null default 0,
  primary key (fila_id, tipo, dia)
);

create table if not exists public.senhas (
  id bigserial primary key,
  fila_id int not null references public.filas(id) default 1,
  dispositivo_id uuid references public.dispositivos(id),
  sequencia_evento bigint,
  codigo varchar(20) not null,
  tipo varchar(20) not null check (tipo in ('comum','prioritaria')),
  status varchar(20) not null default 'aguardando' check (status in ('aguardando','chamada','em_atendimento','finalizada','ausente')),
  origem varchar(20) not null default 'totem' check (origem in ('totem','app_teste')),
  emitida_em timestamptz not null default now(),
  chamada_em timestamptz,
  inicio_em timestamptz,
  fim_em timestamptz,
  guiche_id int references public.guiches(id),
  unique (dispositivo_id, sequencia_evento)
);

create index if not exists senhas_fila_aguardando_idx on public.senhas (fila_id, tipo, emitida_em) where status = 'aguardando';
create index if not exists senhas_chamadas_idx on public.senhas (chamada_em desc) where chamada_em is not null;
create index if not exists senhas_codigo_idx on public.senhas (codigo, emitida_em desc);
alter table public.senhas add column if not exists origem varchar(20) not null default 'totem';

create table if not exists public.comandos (
  id bigserial primary key,
  dispositivo_id uuid references public.dispositivos(id),
  acao varchar(50) not null,
  parametros jsonb not null default '{}'::jsonb,
  status varchar(20) not null default 'pendente' check (status in ('pendente','executado','falhou','expirado')),
  retorno text,
  criado_em timestamptz not null default now(),
  executado_em timestamptz
);
create index if not exists comandos_pendentes_idx on public.comandos (dispositivo_id, criado_em) where status = 'pendente';

create table if not exists public.historico_chamadas (
  id bigserial primary key,
  senha_id bigint not null references public.senhas(id),
  codigo varchar(20) not null,
  tipo varchar(20) not null,
  guiche_id int references public.guiches(id),
  guiche varchar(60) not null,
  chamada_em timestamptz not null default now()
);
create index if not exists historico_chamadas_data_idx on public.historico_chamadas (chamada_em desc);

create table if not exists public.solicitacoes_teste (
  request_id uuid primary key,
  senha_id bigint not null references public.senhas(id),
  criado_em timestamptz not null default now()
);

insert into public.filas (id, nome, prefixo_comum, prefixo_prioritaria, max_prioritarias_seguidas)
values (1, 'Atendimento geral', 'C', 'P', 2)
on conflict (id) do nothing;
select setval(pg_get_serial_sequence('public.filas','id'), greatest((select max(id) from public.filas),1), true);

insert into public.guiches (codigo, nome) values ('G01', 'Guichê 01') on conflict (codigo) do nothing;

create or replace function public.emitir_senha(p_dispositivo_id uuid, p_sequencia_evento bigint, p_tipo varchar)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.senhas%rowtype;
  v_fila public.filas%rowtype;
  v_numero int;
  v_prefixo varchar(5);
  v_ticket public.senhas%rowtype;
begin
  if p_tipo not in ('comum','prioritaria') or p_sequencia_evento < 1 then raise exception 'EVENT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('device:' || p_dispositivo_id::text || ':' || p_sequencia_evento::text, 0));
  select * into v_existing from public.senhas where dispositivo_id = p_dispositivo_id and sequencia_evento = p_sequencia_evento;
  if found then return jsonb_build_object('id',v_existing.id,'codigo',v_existing.codigo,'duplicada',true); end if;

  select * into v_fila from public.filas where ativa order by id limit 1 for update;
  if not found then raise exception 'NO_ACTIVE_QUEUE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('counter:' || v_fila.id::text || ':' || p_tipo || ':' || current_date::text, 0));
  insert into public.contadores_senhas (fila_id,tipo,dia,ultimo_numero) values (v_fila.id,p_tipo,current_date,0)
  on conflict (fila_id,tipo,dia) do nothing;
  update public.contadores_senhas set ultimo_numero = ultimo_numero + 1
   where fila_id = v_fila.id and tipo = p_tipo and dia = current_date returning ultimo_numero into v_numero;
  v_prefixo := case when p_tipo = 'prioritaria' then v_fila.prefixo_prioritaria else v_fila.prefixo_comum end;
  insert into public.senhas (fila_id,dispositivo_id,sequencia_evento,codigo,tipo)
  values (v_fila.id,p_dispositivo_id,p_sequencia_evento,v_prefixo || '-' || lpad(v_numero::text,3,'0'),p_tipo)
  returning * into v_ticket;
  return jsonb_build_object('id',v_ticket.id,'codigo',v_ticket.codigo,'duplicada',false);
end;
$$;

create or replace function public.emitir_senha_simulada(p_request_id uuid, p_tipo varchar)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.senhas%rowtype;
  v_fila public.filas%rowtype;
  v_numero int;
  v_prefixo varchar(5);
  v_ticket public.senhas%rowtype;
begin
  if p_tipo not in ('comum','prioritaria') then raise exception 'EVENT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sim:' || p_request_id::text, 0));
  select s.* into v_existing from public.solicitacoes_teste r
  join public.senhas s on s.id=r.senha_id where r.request_id=p_request_id;
  if found then return jsonb_build_object('id',v_existing.id,'codigo',v_existing.codigo,'tipo',v_existing.tipo,'status',v_existing.status,'emitida_em',v_existing.emitida_em,'origem','app_teste','duplicada',true); end if;

  select * into v_fila from public.filas where ativa order by id limit 1 for update;
  if not found then raise exception 'NO_ACTIVE_QUEUE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('counter:' || v_fila.id::text || ':' || p_tipo || ':' || current_date::text, 0));
  insert into public.contadores_senhas (fila_id,tipo,dia,ultimo_numero) values (v_fila.id,p_tipo,current_date,0)
  on conflict (fila_id,tipo,dia) do nothing;
  update public.contadores_senhas set ultimo_numero=ultimo_numero+1
   where fila_id=v_fila.id and tipo=p_tipo and dia=current_date returning ultimo_numero into v_numero;
  v_prefixo := case when p_tipo='prioritaria' then v_fila.prefixo_prioritaria else v_fila.prefixo_comum end;
  insert into public.senhas (fila_id,codigo,tipo,origem)
  values (v_fila.id,v_prefixo || '-' || lpad(v_numero::text,3,'0'),p_tipo,'app_teste') returning * into v_ticket;
  insert into public.solicitacoes_teste (request_id,senha_id) values (p_request_id,v_ticket.id);
  return jsonb_build_object('id',v_ticket.id,'codigo',v_ticket.codigo,'tipo',v_ticket.tipo,'status',v_ticket.status,'emitida_em',v_ticket.emitida_em,'origem','app_teste','duplicada',false);
end;
$$;

create or replace function public.chamar_proxima(p_guiche_id int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_queue public.filas%rowtype;
  v_ticket public.senhas%rowtype;
  v_desk public.guiches%rowtype;
  v_device uuid;
  v_want varchar(20);
begin
  select * into v_desk from public.guiches where id = p_guiche_id and ativo;
  if not found then raise exception 'DESK_NOT_FOUND'; end if;
  select * into v_queue from public.filas where ativa order by id limit 1 for update;
  if not found then return null; end if;
  v_want := case when v_queue.prioritarias_consecutivas >= v_queue.max_prioritarias_seguidas then 'comum' else 'prioritaria' end;
  select * into v_ticket from public.senhas where fila_id = v_queue.id and status = 'aguardando' and tipo = v_want order by emitida_em,id limit 1 for update skip locked;
  if not found then
    v_want := case when v_want = 'comum' then 'prioritaria' else 'comum' end;
    select * into v_ticket from public.senhas where fila_id = v_queue.id and status = 'aguardando' and tipo = v_want order by emitida_em,id limit 1 for update skip locked;
  end if;
  if not found then return null; end if;
  update public.senhas set status='chamada', chamada_em=now(), guiche_id=p_guiche_id where id=v_ticket.id returning * into v_ticket;
  update public.filas set prioritarias_consecutivas = case when v_ticket.tipo='prioritaria' then prioritarias_consecutivas+1 else 0 end where id=v_queue.id;
  insert into public.historico_chamadas (senha_id,codigo,tipo,guiche_id,guiche) values (v_ticket.id,v_ticket.codigo,v_ticket.tipo,v_desk.id,v_desk.nome);
  select id into v_device from public.dispositivos order by ultima_comunicacao desc nulls last limit 1;
  if v_device is not null then
    insert into public.comandos (dispositivo_id,acao,parametros) values (v_device,'exibir_chamada',jsonb_build_object('senha',v_ticket.codigo,'guiche',v_desk.nome));
  end if;
  return jsonb_build_object('id',v_ticket.id,'codigo',v_ticket.codigo,'tipo',v_ticket.tipo,'status',v_ticket.status,'emitida_em',v_ticket.emitida_em,'chamada_em',v_ticket.chamada_em,'guiche',v_desk.nome);
end;
$$;

create or replace function public.alterar_atendimento(p_senha_id bigint, p_guiche_id int, p_acao varchar)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.senhas%rowtype;
  v_desk public.guiches%rowtype;
  v_device uuid;
begin
  select * into v_ticket from public.senhas where id=p_senha_id for update;
  if not found or v_ticket.guiche_id is distinct from p_guiche_id then raise exception 'ACTION_INVALID'; end if;
  select * into v_desk from public.guiches where id=p_guiche_id;
  if p_acao='repetir' and v_ticket.status in ('chamada','em_atendimento') then
    select id into v_device from public.dispositivos order by ultima_comunicacao desc nulls last limit 1;
    if v_device is not null then insert into public.comandos (dispositivo_id,acao,parametros) values (v_device,'exibir_chamada',jsonb_build_object('senha',v_ticket.codigo,'guiche',v_desk.nome)); end if;
    return jsonb_build_object('id',v_ticket.id,'codigo',v_ticket.codigo,'status',v_ticket.status);
  elsif p_acao='iniciar' and v_ticket.status='chamada' then
    update public.senhas set status='em_atendimento',inicio_em=now() where id=v_ticket.id returning * into v_ticket;
  elsif p_acao='finalizar' and v_ticket.status='em_atendimento' then
    update public.senhas set status='finalizada',fim_em=now() where id=v_ticket.id returning * into v_ticket;
  elsif p_acao='ausente' and v_ticket.status='chamada' then
    update public.senhas set status='ausente',fim_em=now() where id=v_ticket.id returning * into v_ticket;
  else raise exception 'ACTION_INVALID';
  end if;
  return jsonb_build_object('id',v_ticket.id,'codigo',v_ticket.codigo,'tipo',v_ticket.tipo,'status',v_ticket.status,'chamada_em',v_ticket.chamada_em);
end;
$$;

alter table public.dispositivos enable row level security;
alter table public.filas enable row level security;
alter table public.guiches enable row level security;
alter table public.atendentes enable row level security;
alter table public.contadores_senhas enable row level security;
alter table public.senhas enable row level security;
alter table public.comandos enable row level security;
alter table public.historico_chamadas enable row level security;
alter table public.solicitacoes_teste enable row level security;

revoke all on public.dispositivos, public.filas, public.guiches, public.atendentes,
  public.contadores_senhas, public.senhas, public.comandos, public.historico_chamadas, public.solicitacoes_teste
  from anon, authenticated;
grant all on public.dispositivos, public.filas, public.guiches, public.atendentes,
  public.contadores_senhas, public.senhas, public.comandos, public.historico_chamadas, public.solicitacoes_teste
  to service_role;
grant usage, select on sequence public.filas_id_seq, public.guiches_id_seq,
  public.senhas_id_seq, public.comandos_id_seq, public.historico_chamadas_id_seq
  to service_role;
revoke execute on function public.emitir_senha(uuid,bigint,varchar) from public, anon, authenticated;
revoke execute on function public.emitir_senha_simulada(uuid,varchar) from public, anon, authenticated;
revoke execute on function public.chamar_proxima(int) from public, anon, authenticated;
revoke execute on function public.alterar_atendimento(bigint,int,varchar) from public, anon, authenticated;
grant execute on function public.emitir_senha(uuid,bigint,varchar) to service_role;
grant execute on function public.emitir_senha_simulada(uuid,varchar) to service_role;
grant execute on function public.chamar_proxima(int) to service_role;
grant execute on function public.alterar_atendimento(bigint,int,varchar) to service_role;
