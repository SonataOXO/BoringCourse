export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function readEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value && value.length > 0) {
    return value;
  }
  return fallback;
}
