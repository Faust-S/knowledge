/*
 * IWXA public loader (`/_iwxa/loader.js`).
 *
 * Responsibilities:
 *   1. Expose `window.IWXA.connect({ service_id, required_levels? })`.
 *   2. Fetch `/_iwxa/domain.json` and `/_iwxa/current.json`.
 *   3. Fully validate domain.json via `/_iwxa/validator.js` — the SAME pure
 *      module used by the diagnostic app and the Runtime. On failure it
 *      returns a typed error (CONFIG_INVALID / SECRET_FIELD_FORBIDDEN /
 *      ORIGIN_MISMATCH / UPDATE_REQUIRED) and does NOT import the Runtime,
 *      does NOT open IndexedDB, does NOT fetch service passports, does NOT
 *      mint preview tokens.
 *   4. Only if validation passes: dynamically import the versioned Runtime
 *      referenced by current.json and hand it the ALREADY-VALIDATED config
 *      plus the observed `window.location.origin`.
 *
 * The wire contract is snake_case only: `connect` accepts `service_id`.
 * The loader itself is intentionally minimal and version agnostic;
 * switching runtimes only requires changing current.json.
 */
(function () {
  "use strict";

  var LOADER_VERSION = 1;
  var DOMAIN_URL = "/_iwxa/domain.json";
  var CURRENT_URL = "/_iwxa/current.json";
  var VALIDATOR_URL = "/_iwxa/validator.js";

  var existing = (typeof window !== "undefined" && window.IWXA) || {};
  var queue = Array.isArray(existing._queue) ? existing._queue.slice() : [];

  var runtimePromise = null;

  function loadJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) {
        var err = new Error("Failed to load " + url + " (HTTP " + r.status + ")");
        err.code = "CONFIG_INVALID";
        throw err;
      }
      return r.json();
    });
  }

  function loadValidator() {
    return import(/* @vite-ignore */ VALIDATOR_URL).then(function (mod) {
      if (!mod || typeof mod.validateDomainConfig !== "function") {
        var err = new Error("Validator module is malformed");
        err.code = "CONFIG_INVALID";
        throw err;
      }
      return mod.validateDomainConfig;
    });
  }

  function currentOrigin() {
    return typeof window !== "undefined" && window.location
      ? window.location.origin
      : undefined;
  }

  function typedError(code, message, details) {
    var e = new Error(message);
    e.code = code;
    if (details !== undefined) e.details = details;
    return e;
  }

  /**
   * Compare two semver strings. Returns -1 / 0 / 1. Only the numeric
   * major.minor.patch portion is compared — pre-release suffixes are ignored
   * (the loader is intentionally simple; per-module bounds are declared in
   * plain semver).
   */
  function cmpSemver(a, b) {
    var pa = String(a).split("-")[0].split(".").map(Number);
    var pb = String(b).split("-")[0].split(".").map(Number);
    for (var i = 0; i < 3; i++) {
      var x = pa[i] | 0;
      var y = pb[i] | 0;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  }

  function ensureRuntime() {
    if (runtimePromise) return runtimePromise;
    runtimePromise = Promise.all([
      loadJSON(DOMAIN_URL),
      loadJSON(CURRENT_URL),
      loadValidator(),
    ])
      .then(function (triple) {
        var rawDomain = triple[0];
        var current = triple[1];
        var validate = triple[2];

        // 1. Loader vs runtime compatibility.
        if (typeof current.min_loader === "number" && current.min_loader > LOADER_VERSION) {
          throw typedError("UPDATE_REQUIRED", "Loader is out of date", {
            required: current.min_loader,
            have: LOADER_VERSION,
          });
        }

        // 2. current.json must expose the canonical snake_case contract.
        if (!current.runtime_version || typeof current.runtime_version !== "string") {
          throw typedError("CONFIG_INVALID", "current.json missing runtime_version");
        }
        if (!current.runtime_url || typeof current.runtime_url !== "string") {
          throw typedError("CONFIG_INVALID", "current.json missing runtime_url");
        }
        if (!["1.0.0", "1.1.0", "1.2.0", "1.3.0"].includes(current.contract_version)) {
          throw typedError("UPDATE_REQUIRED", "Unsupported contract_version", {
            have: current.contract_version,
            supported: ["1.0.0", "1.1.0", "1.2.0", "1.3.0"],
          });
        }

        // 3. FULL domain.json validation BEFORE importing the runtime.
        var origin = currentOrigin();
        var result = validate(rawDomain, { current_origin: origin });
        if (!result.ok) {
          throw typedError(result.code, result.message, result.details);
        }

        // 4. Per-module runtime version bounds (optional min_runtime / max_runtime).
        var modules = (result.config && result.config.modules) || [];
        for (var i = 0; i < modules.length; i++) {
          var m = modules[i];
          if (m.min_runtime && cmpSemver(current.runtime_version, m.min_runtime) < 0) {
            throw typedError("UPDATE_REQUIRED", "Runtime older than module minimum", {
              module: m.service_id,
              have: current.runtime_version,
              min_runtime: m.min_runtime,
            });
          }
          if (m.max_runtime && cmpSemver(current.runtime_version, m.max_runtime) > 0) {
            throw typedError("UPDATE_REQUIRED", "Runtime newer than module maximum", {
              module: m.service_id,
              have: current.runtime_version,
              max_runtime: m.max_runtime,
            });
          }
        }

        // 5. Only NOW load the runtime bundle.
        return import(/* @vite-ignore */ current.runtime_url).then(function (mod) {
          if (!mod || typeof mod.connect !== "function") {
            throw typedError("CONFIG_INVALID", "Runtime module does not export connect()");
          }
          if (mod.CONTRACT_VERSION && mod.CONTRACT_VERSION !== current.contract_version) {
            throw typedError("CONFIG_INVALID", "Runtime contract_version disagrees with current.json", {
              runtime: mod.CONTRACT_VERSION,
              current: current.contract_version,
            });
          }
          if (mod.RUNTIME_VERSION && mod.RUNTIME_VERSION !== current.runtime_version) {
            throw typedError("CONFIG_INVALID", "Runtime bundle version disagrees with current.json", {
              runtime: mod.RUNTIME_VERSION,
              current: current.runtime_version,
            });
          }
          return {
            runtime: mod,
            domain: result.config,
            current: current,
            origin: origin,
          };
        });
      })
      .catch(function (err) {
        // Reset so a later retry can attempt again once the operator fixed
        // current.json / domain.json / the runtime bundle.
        runtimePromise = null;
        throw err;
      });
    return runtimePromise;
  }

  function connect(request) {
    return ensureRuntime().then(function (ctx) {
      return ctx.runtime.connect(request, {
        domain: ctx.domain,
        current: ctx.current,
        origin: ctx.origin,
      });
    });
  }

  function sha256Hex(bytes) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      return Promise.reject(typedError("CONFIG_INVALID", "WebCrypto is required for migration adapter binding"));
    }
    return globalThis.crypto.subtle.digest("SHA-256", bytes).then(function (digest) {
      return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }

  function migrationEnvironment() {
    return ensureRuntime().then(function (ctx) {
      if (!ctx.runtime || typeof ctx.runtime.createMigrationEnvironment !== "function") {
        throw typedError("UPDATE_REQUIRED", "Runtime does not expose Kernel migration environment");
      }
      return fetch(ctx.current.runtime_url, { cache: "no-store" }).then(function (res) {
        if (!res.ok) throw typedError("CONFIG_INVALID", "Cannot read active runtime artifact for migration binding");
        return res.arrayBuffer();
      }).then(sha256Hex).then(function (artifactSha256) {
        return ctx.runtime.createMigrationEnvironment({
          domain: ctx.domain,
          origin: ctx.origin,
          adapter_source_sha256: artifactSha256,
        });
      });
    });
  }

  var api = {
    version: LOADER_VERSION,
    connect: function (request) {
      return connect(request || {});
    },
    // Introspection helpers, useful for diagnostics. They never leak IDB.
    _migrationEnvironment: function () {
      return migrationEnvironment();
    },
    _describe: function () {
      return ensureRuntime().then(function (ctx) {
        return {
          loader_version: LOADER_VERSION,
          runtime_version: ctx.current && ctx.current.runtime_version,
          contract_version: ctx.current && ctx.current.contract_version,
          domain_id: ctx.domain && ctx.domain.domain_id,
          origin: ctx.origin,
        };
      });
    },
  };

  if (typeof window !== "undefined") {
    window.IWXA = api;
  }

  queue.forEach(function (call) {
    try {
      var result = api.connect(call.request);
      if (call.resolve) result.then(call.resolve, call.reject);
    } catch (e) {
      if (call.reject) call.reject(e);
    }
  });
})();
