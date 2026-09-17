import { describe, expect, it } from "vitest";
import {
  formatSpawnE2bigDiagnostic,
  sanitizeInheritedPaperclipEnv,
  summarizeSpawnEnvironment,
} from "./server-utils.js";

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });

  it("allowlists host runtime keys and drops IDE/MCP/npm blobs", () => {
    const sanitized = sanitizeInheritedPaperclipEnv({
      PATH: "/usr/bin",
      HOME: "/home/paperclip",
      LANG: "en_US.UTF-8",
      LC_ALL: "C.UTF-8",
      HTTP_PROXY: "http://proxy:8080",
      OPENROUTER_API_KEY: "sk-or-host",
      CURSOR_MCP_CONFIG: `{"servers":${"x".repeat(5000)}}`,
      npm_config_userconfig: "/huge/path",
      ELECTRON_RUN_AS_NODE: "1",
      PAPERCLIP_WAKE_PAYLOAD_JSON: `{"comments":${"y".repeat(8000)}}`,
      PAPERCLIP_API_KEY: "must-not-inherit",
    });
    expect(sanitized).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/paperclip",
      LANG: "en_US.UTF-8",
      LC_ALL: "C.UTF-8",
      HTTP_PROXY: "http://proxy:8080",
      OPENROUTER_API_KEY: "sk-or-host",
    });
  });
});

describe("formatSpawnE2bigDiagnostic", () => {
  it("reports argv and env byte totals and the largest keys without values", () => {
    const env = {
      PAPERCLIP_WAKE_PAYLOAD_JSON: "payload-secret",
      PATH: "/bin",
    };
    const diagnostic = formatSpawnE2bigDiagnostic(env, "opencode", ["run", "--format", "json"]);
    expect(diagnostic).toContain("spawn E2BIG");
    expect(diagnostic).toContain("Largest env keys:");
    expect(diagnostic).toContain("PAPERCLIP_WAKE_PAYLOAD_JSON=");
    expect(diagnostic).toContain("B");
    expect(diagnostic).toContain("Values omitted");
    expect(diagnostic).not.toContain("payload-secret");

    const summary = summarizeSpawnEnvironment(env, ["opencode", "run", "--format", "json"]);
    expect(summary.envKeyCount).toBe(2);
    expect(summary.largestEnvKeys[0]?.key).toBe("PAPERCLIP_WAKE_PAYLOAD_JSON");
    expect(summary.largestEnvKeys[0]?.bytes).toBeGreaterThan(summary.largestEnvKeys[1]?.bytes ?? 0);
  });
});
