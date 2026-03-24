import type { RainConfig } from "../../src/framework";
import { Rain } from "../../src/framework";

export function createApp(options?: RainConfig): Rain {
  return new Rain(options);
}

export function request(
  app: Rain,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, init));
}
