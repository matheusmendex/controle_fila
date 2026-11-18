import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { Button, colors, Field, Heading, Page } from '@/components/ui';
import { api, setSessionToken } from '@/lib/api';
import { saveSession } from '@/lib/session';

export default function LoginScreen() {
  const [usuario, setUsuario] = useState(''); const [senha, setSenha] = useState(''); const [busy, setBusy] = useState(false);
  async function entrar() {
    if (!usuario.trim() || !senha) { Alert.alert('Faltam dados', 'Informe seu usuário e sua senha.'); return; }
    setBusy(true);
    try { const result = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ usuario: usuario.trim(), senha }) }); await saveSession(result.token); setSessionToken(result.token); router.replace('/attendant'); }
    catch (error) { Alert.alert('Não foi possível entrar', error instanceof Error ? error.message : 'Tente novamente.'); }
    finally { setBusy(false); }
  }
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled"><Page style={styles.page}><Text onPress={() => router.back()} style={styles.back}>←  Voltar</Text><Heading eyebrow="ÁREA DA EQUIPE" title="Bom ter você por aqui." subtitle="Entre com os dados de acesso do atendente para abrir seu painel." /><Field label="Usuário" placeholder="seu.usuario" autoCapitalize="none" value={usuario} onChangeText={setUsuario} returnKeyType="next" /><Field label="Senha" placeholder="Sua senha" secureTextEntry value={senha} onChangeText={setSenha} onSubmitEditing={entrar} /><Button label={busy ? 'Entrando...' : 'Acessar painel'} disabled={busy} onPress={entrar} /><Text style={styles.foot}>Acesso restrito a atendentes cadastrados no sistema.</Text></Page></ScrollView></KeyboardAvoidingView>;
}
const styles = StyleSheet.create({ page: { gap: 14, paddingTop: 25 }, back: { color: colors.green, fontWeight: '700', marginBottom: 12 }, foot: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 6 } });
