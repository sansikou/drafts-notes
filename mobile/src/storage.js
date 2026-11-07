/** 轻量本地存储（localStorage），不引入额外 native 插件以降低内存 */
const PREFIX = 'drafts:';

export async function storeGet(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function storeSet(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
  return true;
}
