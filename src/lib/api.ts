const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

let sessionToken: string | null = null;

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Erro ${response.status}`);
  return body as T;
}

export type Ticket = {
  id: number;
  codigo: string;
  tipo: 'comum' | 'prioritaria';
  status: string;
  emitida_em: string;
  chamada_em?: string | null;
  guiche?: string | null;
};

export type Dashboard = {
  atual: Ticket | null;
  ultimas: Ticket[];
  dispositivo: { online: boolean; ultima_comunicacao: string | null };
  indicadores: { aguardando: number; espera_media_minutos: number; atendimento_medio_minutos: number };
};
