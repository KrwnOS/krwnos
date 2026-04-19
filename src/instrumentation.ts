/**
 * Next.js server bootstrap — runs once per Node process (not Edge).
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  const { startNodeOtel } = await import("@/lib/otel/start-node-sdk");
  startNodeOtel();

  const { configureRedisEventBusIfAvailable } = await import(
    "@/lib/redis-event-bootstrap"
  );
  await configureRedisEventBusIfAvailable();
}
