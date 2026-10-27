// Caddy sets X-Real-IP from the TCP peer, overwriting anything the client sent.
// Never read x-forwarded-for: clients can forge it to dodge the rate limit.
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || "unknown";
}
