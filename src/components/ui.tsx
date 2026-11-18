import { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewProps } from 'react-native';

export const colors = {
  ink: '#17231f', muted: '#6f7b75', green: '#1e7455', greenLight: '#e8f3ed',
  paper: '#f5f7f3', white: '#fff', line: '#e4eae5', orange: '#d38b40', red: '#bd4d48',
  dark: '#102c25',
};

export function Page({ children, style, ...props }: PropsWithChildren<ViewProps>) {
  return <View {...props} style={[styles.page, style]}>{children}</View>;
}

export function Heading({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return <View style={styles.heading}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>;
}

export function Button({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, disabled && styles.buttonDisabled, pressed && !disabled && styles.pressed]}><Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text></Pressable>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput placeholderTextColor="#9aa59e" {...props} style={[styles.field, props.style]} /></View>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewProps['style'] }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Tag({ label, tone = 'green' }: { label: string; tone?: 'green' | 'orange' | 'red' }) {
  const bg = tone === 'green' ? colors.greenLight : tone === 'orange' ? '#fbf1e5' : '#f9e9e7';
  const fg = tone === 'green' ? colors.green : tone === 'orange' ? '#a66a23' : colors.red;
  return <View style={[styles.tag, { backgroundColor: bg }]}><Text style={[styles.tagText, { color: fg }]}>{label}</Text></View>;
}

export function Divider() { return <View style={styles.divider} />; }

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 30 },
  heading: { gap: 7, marginBottom: 20 }, eyebrow: { color: colors.green, fontSize: 11, fontWeight: '800', letterSpacing: 1.7, textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: 29, lineHeight: 35, fontWeight: '800', letterSpacing: -0.6 }, subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  button: { backgroundColor: colors.green, minHeight: 54, paddingHorizontal: 20, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, buttonSecondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, buttonDisabled: { opacity: 0.55 }, pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: '700' }, buttonTextSecondary: { color: colors.ink },
  fieldWrap: { gap: 8, marginBottom: 14 }, fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '700' }, field: { height: 52, borderRadius: 13, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 15, color: colors.ink, fontSize: 15 },
  card: { backgroundColor: colors.white, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.line }, tag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 }, tagText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }, divider: { height: 1, backgroundColor: colors.line },
});
