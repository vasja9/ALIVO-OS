import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigurationException } from "../../src/config/ConfigurationException.ts";
import { ConfigurationKey } from "../../src/config/ConfigurationKey.ts";
import { ConfigurationRegistry } from "../../src/config/ConfigurationRegistry.ts";
import { ConfigurationSource } from "../../src/config/ConfigurationSource.ts";
import { ConfigurationValue } from "../../src/config/ConfigurationValue.ts";

test("creates immutable keys with stable equality", () => {
  const key = new ConfigurationKey("system.mode");

  assert.equal(key.identifier, "system.mode");
  assert.equal(key.equals(new ConfigurationKey("system.mode")), true);
  assert.equal(key.equals(new ConfigurationKey("system.other")), false);
  assert.equal(Object.isFrozen(key), true);
});

test("rejects empty and whitespace-only keys", () => {
  assert.throws(() => new ConfigurationKey(""), ConfigurationException);
  assert.throws(() => new ConfigurationKey("   "), ConfigurationException);
});

test("registers and retrieves optional and required values", () => {
  const registry = new ConfigurationRegistry();
  const key = new ConfigurationKey("system.mode");
  const value = new ConfigurationValue("personal", ConfigurationSource.Default);

  registry.register(key, value);

  assert.equal(registry.get<string>(key), value);
  assert.equal(registry.require<string>(key).value, "personal");
  assert.equal(registry.get(new ConfigurationKey("missing")), undefined);
});

test("fails when a required value is missing", () => {
  const registry = new ConfigurationRegistry();

  assert.throws(
    () => registry.require(new ConfigurationKey("missing")),
    /Required configuration value is not registered: missing/,
  );
});

test("rejects duplicate registration and permits explicit replacement", () => {
  const registry = new ConfigurationRegistry();
  const key = new ConfigurationKey("system.mode");
  registry.register(
    key,
    new ConfigurationValue("initial", ConfigurationSource.Default),
  );

  assert.throws(
    () =>
      registry.register(
        key,
        new ConfigurationValue("duplicate", ConfigurationSource.Local),
      ),
    /Configuration value is already registered: system.mode/,
  );

  registry.replace(
    key,
    new ConfigurationValue("replacement", ConfigurationSource.Runtime),
  );
  assert.equal(registry.require<string>(key).value, "replacement");
  assert.throws(
    () =>
      registry.replace(
        new ConfigurationKey("missing"),
        new ConfigurationValue("value", ConfigurationSource.Runtime),
      ),
    /cannot be replaced because it is not registered: missing/,
  );
});

test("snapshots remain unchanged after registry changes", () => {
  const registry = new ConfigurationRegistry();
  const key = new ConfigurationKey("system.mode");
  registry.register(key, new ConfigurationValue("before", ConfigurationSource.Default));
  const snapshot = registry.snapshot();

  registry.replace(key, new ConfigurationValue("after", ConfigurationSource.Runtime));
  registry.register(
    new ConfigurationKey("system.added"),
    new ConfigurationValue(true, ConfigurationSource.Runtime),
  );

  assert.equal(snapshot.require<string>(key).value, "before");
  assert.equal(snapshot.get(new ConfigurationKey("system.added")), undefined);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("redacts sensitive values from string and JSON diagnostics", () => {
  const secret = new ConfigurationValue(
    "not-for-diagnostics",
    ConfigurationSource.Local,
    "protected value",
    true,
  );

  assert.equal(String(secret), "[REDACTED]");
  assert.equal(JSON.stringify(secret).includes("not-for-diagnostics"), false);
  assert.equal(JSON.stringify(secret).includes("[REDACTED]"), true);
});

test("lists only non-sensitive keys in deterministic order", () => {
  const registry = new ConfigurationRegistry();
  registry.register(
    new ConfigurationKey("zeta"),
    new ConfigurationValue(1, ConfigurationSource.Default),
  );
  registry.register(
    new ConfigurationKey("secret"),
    new ConfigurationValue("hidden", ConfigurationSource.Local, undefined, true),
  );
  registry.register(
    new ConfigurationKey("alpha"),
    new ConfigurationValue(2, ConfigurationSource.Default),
  );

  const keys = registry.listNonSensitiveKeys();
  assert.deepEqual(
    keys.map((key) => key.identifier),
    ["alpha", "zeta"],
  );
  assert.equal(Object.isFrozen(keys), true);
});
