import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const _require = createRequire(import.meta.url);

const mockGetD1Bindings = vi.fn((): Array<Record<string, string>> => []);
const mockRunCommand = vi.fn((..._args: unknown[]) => 0);
const mockNpmInstall = vi.fn(() => 0);
const mockStripControlChars = vi.fn((s: string) => s);
const mockSchemaTemplate = vi.fn(() => "schema");
const mockDrizzleConfigTemplate = vi.fn(() => "config");
const mockDbIndexTemplate = vi.fn(() => "db-index");
const mockSeedTemplate = vi.fn(() => "seed-data");
const mockExistsSync = vi.fn((..._args: unknown[]) => false);
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReaddirSync = vi.fn((): string[] => []);

const fsModule = _require("node:fs");
const origFs = {
  existsSync: fsModule.existsSync,
  mkdirSync: fsModule.mkdirSync,
  writeFileSync: fsModule.writeFileSync,
  readdirSync: fsModule.readdirSync,
};

function patchDependencies() {
  const tomlParser = _require("../../cli/utils/toml-parser");
  tomlParser.getD1Bindings = mockGetD1Bindings;

  const processUtils = _require("../../cli/utils/process");
  processUtils.runCommand = mockRunCommand;
  processUtils.npmInstall = mockNpmInstall;

  const sanitize = _require("../../cli/utils/sanitize");
  sanitize.stripControlChars = mockStripControlChars;

  const schema = _require("../../cli/templates/schema");
  schema.schemaTemplate = mockSchemaTemplate;

  const drizzleConfig = _require("../../cli/templates/drizzle-config");
  drizzleConfig.drizzleConfigTemplate = mockDrizzleConfigTemplate;

  const dbIndex = _require("../../cli/templates/db-index");
  dbIndex.dbIndexTemplate = mockDbIndexTemplate;

  const seed = _require("../../cli/templates/seed");
  seed.seedTemplate = mockSeedTemplate;

  fsModule.existsSync = mockExistsSync;
  fsModule.mkdirSync = mockMkdirSync;
  fsModule.writeFileSync = mockWriteFileSync;
  fsModule.readdirSync = mockReaddirSync;
}

function restoreFs() {
  fsModule.existsSync = origFs.existsSync;
  fsModule.mkdirSync = origFs.mkdirSync;
  fsModule.writeFileSync = origFs.writeFileSync;
  fsModule.readdirSync = origFs.readdirSync;
}

describe("handleDbCommand", () => {
  let handleDbCommand: (
    subcommand?: string,
    options?: { remote?: boolean },
  ) => void;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockExistsSync.mockReset();
    mockMkdirSync.mockReset();
    mockWriteFileSync.mockReset();
    mockReaddirSync.mockReset();
    mockGetD1Bindings.mockReset().mockReturnValue([]);
    mockRunCommand.mockReset().mockReturnValue(0);
    mockNpmInstall.mockReset().mockReturnValue(0);
    mockStripControlChars.mockReset().mockImplementation((s: string) => s);
    mockSchemaTemplate.mockReset().mockReturnValue("schema");
    mockDrizzleConfigTemplate.mockReset().mockReturnValue("config");
    mockDbIndexTemplate.mockReset().mockReturnValue("db-index");
    mockSeedTemplate.mockReset().mockReturnValue("seed-data");

    patchDependencies();

    const dbPath = _require.resolve("../../cli/commands/db");
    delete _require.cache[dbPath];
    handleDbCommand = _require(dbPath).handleDbCommand;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    restoreFs();
  });

  describe("ヘルプ・バリデーション", () => {
    it("サブコマンドなしでヘルプを表示して exit(0)", () => {
      expect(() => handleDbCommand(undefined)).toThrow("process.exit(0)");
      expect(logSpy).toHaveBeenCalled();
    });

    it("--help でヘルプを表示して exit(0)", () => {
      expect(() => handleDbCommand("--help")).toThrow("process.exit(0)");
      expect(logSpy).toHaveBeenCalled();
    });

    it("-h でヘルプを表示して exit(0)", () => {
      expect(() => handleDbCommand("-h")).toThrow("process.exit(0)");
      expect(logSpy).toHaveBeenCalled();
    });

    it("不正なサブコマンドでエラー表示して exit(1)", () => {
      expect(() => handleDbCommand("invalid")).toThrow("process.exit(1)");
      expect(errorSpy).toHaveBeenCalled();
    });

    it("不正なサブコマンドのエラーメッセージに stripControlChars が使われる", () => {
      expect(() => handleDbCommand("bad\x00cmd")).toThrow("process.exit(1)");
      expect(mockStripControlChars).toHaveBeenCalledWith("bad\x00cmd");
    });
  });

  describe("db init", () => {
    beforeEach(() => {
      mockGetD1Bindings.mockReturnValue([
        {
          binding: "DB",
          database_name: "test-db",
          database_id: "abc",
        },
      ]);
    });

    it("D1 バインディングなしで exit(1)", () => {
      mockGetD1Bindings.mockReturnValue([]);
      expect(() => handleDbCommand("init")).toThrow("process.exit(1)");
    });

    it("drizzle-orm インストール失敗で exit(1)", () => {
      mockNpmInstall.mockReturnValue(1);
      expect(() => handleDbCommand("init")).toThrow("process.exit(1)");
    });

    it("drizzle-kit インストール失敗で exit(1)", () => {
      mockNpmInstall.mockReturnValueOnce(0).mockReturnValueOnce(1);
      expect(() => handleDbCommand("init")).toThrow("process.exit(1)");
    });

    it("schema.ts が存在しない場合 writeFileSync で作成", () => {
      mockExistsSync
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false);
      handleDbCommand("init");
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("schema.ts"),
        "schema",
      );
    });

    it("schema.ts が既に存在する場合スキップ", () => {
      mockExistsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false);
      handleDbCommand("init");
      expect(mockWriteFileSync).not.toHaveBeenCalledWith(
        expect.stringContaining("schema.ts"),
        expect.anything(),
      );
    });

    it("drizzle.config.ts が既に存在する場合スキップ", () => {
      mockExistsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      handleDbCommand("init");
      expect(mockWriteFileSync).not.toHaveBeenCalledWith(
        expect.stringContaining("drizzle.config.ts"),
        expect.anything(),
      );
    });

    it("index.ts が存在しない場合 writeFileSync で作成", () => {
      mockExistsSync
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false);
      handleDbCommand("init");
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("index.ts"),
        "db-index",
      );
    });

    it("index.ts が既に存在する場合スキップ", () => {
      mockExistsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      handleDbCommand("init");
      expect(mockWriteFileSync).not.toHaveBeenCalledWith(
        expect.stringContaining("index.ts"),
        expect.anything(),
      );
    });
  });

  describe("db generate / push / migrate", () => {
    beforeEach(() => {
      mockGetD1Bindings.mockReturnValue([
        {
          binding: "DB",
          database_name: "test-db",
          database_id: "abc",
        },
      ]);
    });

    it("D1 バインディングなしで exit(1)", () => {
      mockGetD1Bindings.mockReturnValue([]);
      expect(() => handleDbCommand("generate")).toThrow("process.exit(1)");
    });

    it("runCommand が 0 以外を返した場合 exit(1)", () => {
      mockRunCommand.mockReturnValue(1);
      expect(() => handleDbCommand("generate")).toThrow("process.exit(1)");
    });

    it("正常時にコマンドが実行される", () => {
      handleDbCommand("generate");
      expect(mockRunCommand).toHaveBeenCalledWith("npx", [
        "drizzle-kit",
        "generate",
      ]);
    });
  });

  describe("db apply-local", () => {
    beforeEach(() => {
      mockGetD1Bindings.mockReturnValue([
        {
          binding: "DB",
          database_name: "test-db",
          database_id: "abc",
        },
      ]);
    });

    it("database_name がない場合 exit(1)", () => {
      mockGetD1Bindings.mockReturnValue([
        {
          binding: "DB",
          database_name: "",
          database_id: "x",
        },
      ]);
      expect(() => handleDbCommand("apply-local")).toThrow("process.exit(1)");
    });

    it("database_name に不正文字がある場合 exit(1)", () => {
      mockGetD1Bindings.mockReturnValue([
        {
          binding: "DB",
          database_name: "my;db",
          database_id: "x",
        },
      ]);
      expect(() => handleDbCommand("apply-local")).toThrow("process.exit(1)");
    });

    it("drizzle/ フォルダがない場合 exit(1)", () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => handleDbCommand("apply-local")).toThrow("process.exit(1)");
    });

    it("SQL ファイルがない場合 exit(0)", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
      expect(() => handleDbCommand("apply-local")).toThrow("process.exit(0)");
    });

    it("SQL ファイルがある場合 runCommand が各ファイルに対して呼ばれる", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["0001_init.sql", "0002_add-users.sql"]);
      handleDbCommand("apply-local");
      expect(mockRunCommand).toHaveBeenCalledTimes(2);
    });
  });

  describe("db seed", () => {
    beforeEach(() => {
      mockGetD1Bindings.mockReturnValue([
        {
          binding: "DB",
          database_name: "test-db",
          database_id: "abc",
        },
      ]);
    });

    it("D1 バインディングなしで exit(1)", () => {
      mockGetD1Bindings.mockReturnValue([]);
      expect(() => handleDbCommand("seed")).toThrow("process.exit(1)");
    });

    it("database_name がない場合 exit(1)", () => {
      mockGetD1Bindings.mockReturnValue([
        {
          binding: "DB",
          database_name: "",
          database_id: "x",
        },
      ]);
      expect(() => handleDbCommand("seed")).toThrow("process.exit(1)");
    });

    it("database_name に不正文字がある場合 exit(1)", () => {
      mockGetD1Bindings.mockReturnValue([
        {
          binding: "DB",
          database_name: "my;db",
          database_id: "x",
        },
      ]);
      expect(() => handleDbCommand("seed")).toThrow("process.exit(1)");
    });

    it("seed.sql が存在しない場合 exit(1)", () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => handleDbCommand("seed")).toThrow("process.exit(1)");
      expect(errorSpy).toHaveBeenCalled();
    });

    it("正常時に --local 付きでコマンドが実行される", () => {
      mockExistsSync.mockReturnValue(true);
      handleDbCommand("seed");
      expect(mockRunCommand).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining([
          "wrangler",
          "d1",
          "execute",
          "test-db",
          "--local",
        ]),
      );
    });

    it("--remote 時に --local なしでコマンドが実行される", () => {
      mockExistsSync.mockReturnValue(true);
      handleDbCommand("seed", { remote: true });
      const args = mockRunCommand.mock.calls[0]?.[1] as string[] | undefined;
      expect(args).toContain("wrangler");
      expect(args).toContain("test-db");
      expect(args).not.toContain("--local");
    });

    it("runCommand 失敗時に exit(1)", () => {
      mockExistsSync.mockReturnValue(true);
      mockRunCommand.mockReturnValue(1);
      expect(() => handleDbCommand("seed")).toThrow("process.exit(1)");
    });
  });
});
