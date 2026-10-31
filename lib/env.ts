// Server-only configuration. None of these are NEXT_PUBLIC_, so Next.js never inlines them into client bundles.

export class ConfigError extends Error {
  override name = "ConfigError";
}

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function tinyfishApiKey(): string {
  const key = read("TINYFISH_API_KEY");
  if (!key) throw new ConfigError("TINYFISH_API_KEY is not set");
  return key;
}

export function supabaseConfig(): { url: string; serviceRoleKey: string } {
  const url = read("SUPABASE_URL");
  const serviceRoleKey = read("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new ConfigError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  if (!/^https:\/\/[^/]+/.test(url)) throw new ConfigError("SUPABASE_URL must be an https URL");
  return { url, serviceRoleKey };
}

export function envStatus(): { tinyfish: boolean; supabase: boolean } {
  return {
    tinyfish: Boolean(read("TINYFISH_API_KEY")),
    supabase: Boolean(read("SUPABASE_URL") && read("SUPABASE_SERVICE_ROLE_KEY")),
  };
}
