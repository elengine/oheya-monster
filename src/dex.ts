// おへやモンスター - 図鑑（localStorage永続化）

const DEX_KEY = 'oheya:dex:v1';

export type DexEntry = { id: string; count: number };

export function loadDex(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DEX_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, number>;
    return obj;
  } catch {
    return {};
  }
}

export function addCatch(id: string): number {
  const dex = loadDex();
  const n = (dex[id] ?? 0) + 1;
  dex[id] = n;
  try {
    localStorage.setItem(DEX_KEY, JSON.stringify(dex));
  } catch { /* 容量超過時は無視 */ }
  return n;
}

export function totalCount(): number {
  const dex = loadDex();
  return Object.values(dex).reduce((a, b) => a + b, 0);
}

export function speciesCount(): number {
  return Object.keys(loadDex()).length;
}
