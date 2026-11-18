// Keep the short-lived access token in memory for this app session.
let savedToken: string | null = null;

export async function getSavedSession() { return savedToken; }
export async function saveSession(token: string) { savedToken = token; }
export async function clearSavedSession() { savedToken = null; }
