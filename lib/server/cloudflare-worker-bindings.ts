import type { HostedTaskRouteBindings } from "@/lib/server/hosted-task-route-runtime";

/**
 * Keep the Workers-only module out of Next's static module graph. Both runtimes
 * can compile the routes; vinext resolves this native module when a request is
 * actually served by workerd.
 */
export async function getHostedBindings(): Promise<HostedTaskRouteBindings> {
  const workersModule = "cloudflare:workers";
  const { env } = await import(/* webpackIgnore: true */ /* @vite-ignore */ workersModule) as {
    env: HostedTaskRouteBindings;
  };
  return env;
}
