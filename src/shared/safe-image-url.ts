/** Allow only https image URLs without userinfo (panel / bridge parity).
 * userinfo 無しの https 画像 URL のみ許可する。 */
export function isSafeHttpsImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
