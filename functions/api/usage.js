const CAP = 500;

function monthKey() {
  const d = new Date();
  return `browser_sessions:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function onRequestGet(context) {
  let count = 0;
  if (context.env.USAGE) {
    count = parseInt((await context.env.USAGE.get(monthKey())) || "0", 10);
  }
  return Response.json({ count, cap: CAP, remaining: Math.max(0, CAP - count) });
}
