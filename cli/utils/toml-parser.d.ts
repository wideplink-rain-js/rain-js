interface D1Binding {
  binding: string;
  database_name: string;
  database_id: string;
  [key: string]: string;
}

export function parseD1Bindings(content: string): D1Binding[];
export function getD1Bindings(): D1Binding[];
export const WRANGLER_TOML: string;
