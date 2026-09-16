/** The server's clock at render time. Kept out of component bodies so render stays declarative. */
export function serverNowMs(): number {
  return Date.now();
}
