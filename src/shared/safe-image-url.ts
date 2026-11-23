/** Allow only https image URLs without userinfo (panel / bridge parity).
 * ユーザー情報を含まない HTTPS の画像 URL のみ許可する。 */
export function isSafeHttpsImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
