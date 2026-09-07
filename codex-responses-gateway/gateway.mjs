#!/usr/bin/env node

import crypto from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(SCRIPT_DIR, "routes.json");
const DEFAULT_ENV = join(SCRIPT_DIR, ".env");
const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

function usage() {
  console.log(`Usage:
  node gateway.mjs [--config routes.json]
  node gateway.mjs --check [--config routes.json]
  node gateway.mjs --print-route <model> [--config routes.json]

The gateway reads .env beside the selected routes file, then forwards
OpenAI Responses API requests to the route selected by request.model.
`);
}

function parseArgs(argv) {
  const args = [...argv];
  let configPath = DEFAULT_CONFIG;
  let mode = "serve";
  let printModel = null;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--config") {
      configPath = args.shift();
      if (!configPath) throw new Error("--config requires a path");
      continue;
    }
    if (arg === "--check") {
      mode = "check";
      continue;
    }
    if (arg === "--print-route") {
      mode = "print-route";
      printModel = args.shift();
      if (!printModel) throw new Error("--print-route requires a model");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { configPath: resolve(configPath), mode, printModel };
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;

  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    // Accept the usual dotenv form `KEY=value # comment`. This is useful
    // for labeling the currently active credential without sending the
    // label as part of the upstream API key.
    const inlineComment = value.search(/\s+#/);
    if (inlineComment >= 0) value = value.slice(0, inlineComment).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadConfig(configPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON config ${configPath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The route config must be a JSON object");
  }
  if (!parsed.models || typeof parsed.models !== "object") {
    throw new Error("The route config must contain a models object");
  }
  if (!parsed.defaultModel || typeof parsed.defaultModel !== "string") {
    throw new Error("The route config must contain a defaultModel string");
  }
  return parsed;
}

function envValue(name, label) {
  if (!name || typeof name !== "string") {
    throw new Error(`${label} must name an environment variable`);
  }
  const value = process.env[name];
  if (!value) throw new Error(`${label}: environment variable ${name} is empty`);
  return value;
}

function validateBaseUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return parsed;
}

function validateRouteConfig(config, { requireSecrets = true } = {}) {
  if (!routeForModel(config, config.defaultModel)) {
    throw new Error(`defaultModel ${config.defaultModel} has no route`);
  }

  const gatewayKeyEnv = config.gatewayApiKeyEnv || "CODEX_GATEWAY_API_KEY";
  if (requireSecrets) envValue(gatewayKeyEnv, "gatewayApiKeyEnv");

  for (const [model, route] of Object.entries(config.models)) {
    if (!route || typeof route !== "object") {
      throw new Error(`Route ${model} must be an object`);
    }
    if (route.ccSwitchProvider !== undefined) {
      if (typeof route.ccSwitchProvider !== "string" || !route.ccSwitchProvider.trim()) {
        throw new Error(`Route ${model} needs a non-empty ccSwitchProvider`);
      }
      if (route.baseUrlEnv || route.apiKeyEnv) {
        throw new Error(`Route ${model} cannot mix ccSwitchProvider and environment credentials`);
      }
    } else if (!route.baseUrlEnv || !route.apiKeyEnv) {
      throw new Error(`Route ${model} needs baseUrlEnv and apiKeyEnv`);
    }
    if (requireSecrets && !route.ccSwitchProvider) {
      validateBaseUrl(envValue(route.baseUrlEnv, `${model}.baseUrlEnv`), `${model}.baseUrlEnv`);
      envValue(route.apiKeyEnv, `${model}.apiKeyEnv`);
    }
    if (
      route.reasoningEffort !== undefined &&
      route.reasoningEffort !== false &&
      route.reasoningEffort !== null &&
      typeof route.reasoningEffort !== "string"
    ) {
      throw new Error(`${model}.reasoningEffort must be a string, false, null, or omitted`);
    }
    if (route.store !== undefined && route.store !== null && typeof route.store !== "boolean") {
      throw new Error(`${model}.store must be true, false, null, or omitted`);
    }
    if (route.upstreamModel !== undefined && typeof route.upstreamModel !== "string") {
      throw new Error(`${model}.upstreamModel must be a string when present`);
    }
  }

  return gatewayKeyEnv;
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(headers) {
  const value = headers.authorization;
  if (!value || Array.isArray(value)) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function jsonResponse(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

function requestUrl(request) {
  return new URL(request.url || "/", "http://codex-gateway.local");
}

function isResponsesPath(pathname) {
  return pathname === "/responses" || pathname.endsWith("/responses") ||
    pathname === "/responses/compact" || pathname.endsWith("/responses/compact");
}

function routeForModel(config, model) {
  if (Object.hasOwn(config.models, model)) return config.models[model];
  // Exact matches win, followed by the longest matching family prefix.
  const pattern = Object.keys(config.models)
    .filter((key) => key.endsWith("*") && model.toLowerCase().startsWith(key.slice(0, -1).toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  return pattern ? config.models[pattern] : null;
}

function loadCcSwitchProviders(config) {
  const names = [...new Set(Object.values(config.models).map((route) => route.ccSwitchProvider).filter(Boolean))];
  if (!names.length) return {};
  const database = config.ccSwitchDatabase || join(homedir(), ".cc-switch", "cc-switch.db");
  const result = spawnSync(process.env.PYTHON_BIN || "python3", [
    join(SCRIPT_DIR, "cc-switch-provider.py"), database, ...names,
  ], { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error("Cannot load CC Switch providers: requires Python 3.11+, readable database, unique Codex provider names and valid Responses config/auth");
  }
  let providers;
  try { providers = JSON.parse(result.stdout); }
  catch { throw new Error("Invalid CC Switch provider data"); }
  for (const name of names) {
    validateBaseUrl(providers[name]?.baseUrl, `${name}.baseUrl`);
    if (typeof providers[name]?.apiKey !== "string" || !providers[name].apiKey.trim()) {
      throw new Error(`CC Switch provider ${name} has no API key`);
    }
  }
  return providers;
}

function applyRouteOverrides(body, route) {
  const next = { ...body };

  if (route.upstreamModel) next.model = route.upstreamModel;

  if (route.reasoningEffort === false) {
    if (next.reasoning && typeof next.reasoning === "object" && !Array.isArray(next.reasoning)) {
      next.reasoning = { ...next.reasoning };
      delete next.reasoning.effort;
      if (Object.keys(next.reasoning).length === 0) delete next.reasoning;
    }
  } else if (typeof route.reasoningEffort === "string") {
    const reasoning =
      next.reasoning && typeof next.reasoning === "object" && !Array.isArray(next.reasoning)
        ? { ...next.reasoning }
        : {};
    reasoning.effort = route.reasoningEffort;
    next.reasoning = reasoning;
  }

  if (route.store !== undefined && route.store !== null) next.store = route.store;
  return next;
}

function normalizedApiPath(pathname) {
  if (pathname.startsWith("/v1/")) return pathname;
  if (pathname === "/v1") return pathname;
  if (
    pathname === "/responses" || pathname.startsWith("/responses/") ||
    pathname === "/models" || pathname.startsWith("/models/")
  ) {
    return `/v1${pathname}`;
  }
  return pathname;
}

function upstreamUrl(baseUrl, request) {
  const incoming = requestUrl(request);
  const target = validateBaseUrl(baseUrl, "upstream base URL");
  const basePath = target.pathname.replace(/\/+$/, "");
  const apiPath = normalizedApiPath(incoming.pathname);

  if (basePath.endsWith("/v1")) {
    const suffix = apiPath === "/v1" ? "" : apiPath.replace(/^\/v1/, "");
    target.pathname = `${basePath}${suffix || "/"}`.replace(/\/\/+/g, "/");
  } else {
    target.pathname = `${basePath}${apiPath}`.replace(/\/\/+/g, "/") || "/";
  }
  target.search = incoming.search;
  return target;
}

function incomingHeaders(request, apiKey) {
  const excluded = new Set([
    "authorization",
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (excluded.has(name.toLowerCase()) || value == null) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers.authorization = `Bearer ${apiKey}`;
  headers["accept-encoding"] = "identity";
  if (!headers["content-type"]) headers["content-type"] = "application/json";
  return headers;
}

async function readBody(request, maxBytes) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error(`request body exceeds ${maxBytes} bytes`);
    error.statusCode = 413;
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`request body exceeds ${maxBytes} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(body, requestPath) {
  if (body.length === 0) return null;
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    const wrapped = new Error(`invalid JSON request body: ${error.message}`);
    wrapped.statusCode = isResponsesPath(requestPath) ? 400 : 422;
    throw wrapped;
  }
}

function responseHeaders(upstreamResponse) {
  const excluded = new Set([
    "connection",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  const headers = {};
  upstreamResponse.headers.forEach((value, name) => {
    if (!excluded.has(name.toLowerCase())) headers[name] = value;
  });
  return headers;
}

async function streamResponse(upstreamResponse, response) {
  const body = upstreamResponse.body;
  if (!body) {
    response.end();
    return;
  }

  for await (const chunk of body) {
    if (!response.write(chunk)) await once(response, "drain");
  }
  response.end();
}

function routeSummary(model, route) {
  return {
    requestedModel: model,
    upstreamModel: route.upstreamModel || model,
    reasoningEffort:
      route.reasoningEffort === undefined ? "preserve" : route.reasoningEffort,
    store: route.store === undefined ? "preserve" : route.store,
    baseUrlEnv: route.baseUrlEnv,
    apiKeyEnv: route.apiKeyEnv,
    ccSwitchProvider: route.ccSwitchProvider,
  };
}

function createServer(config, gatewayApiKey, providers = {}) {
  const maxBodyBytes = Number(config.maxBodyBytes || DEFAULT_MAX_BODY_BYTES);
  const defaultModel = config.defaultModel;

  return http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const incoming = requestUrl(request);
    const pathname = incoming.pathname;

    if (pathname === "/healthz" && request.method === "GET") {
      jsonResponse(response, 200, { ok: true, defaultModel });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, { allow: "GET,POST,OPTIONS" });
      response.end();
      return;
    }

    const suppliedKey = bearerToken(request.headers);
    if (!suppliedKey || !constantTimeEqual(suppliedKey, gatewayApiKey)) {
      jsonResponse(response, 401, { error: { message: "invalid gateway API key", type: "authentication_error" } });
      return;
    }

    let routeModel = defaultModel;
    let route;
    let outboundBody;

    try {
      const bodyRequired = request.method !== "GET" && request.method !== "HEAD";
      const rawBody = bodyRequired ? await readBody(request, maxBodyBytes) : Buffer.alloc(0);
      const contentEncoding = String(request.headers["content-encoding"] || "identity").toLowerCase();
      if (rawBody.length > 0 && contentEncoding !== "identity") {
        const error = new Error("compressed request bodies are not supported by the model router");
        error.statusCode = 415;
        throw error;
      }

      const body = rawBody.length > 0 ? parseJsonBody(rawBody, pathname) : null;
      if (body && typeof body !== "object") {
        const error = new Error("JSON request body must be an object");
        error.statusCode = 400;
        throw error;
      }

      const requestedModel =
        (body && typeof body.model === "string" && body.model) ||
        (typeof request.headers["x-codex-model"] === "string" && request.headers["x-codex-model"]) ||
        defaultModel;
      routeModel = requestedModel;
      route = routeForModel(config, requestedModel);

      if (!route && (isResponsesPath(pathname) || request.method !== "GET")) {
        const error = new Error(`no route configured for model ${requestedModel}`);
        error.statusCode = 400;
        throw error;
      }
      if (!route) route = routeForModel(config, defaultModel);

      if (body) {
        outboundBody = Buffer.from(JSON.stringify(applyRouteOverrides(body, route)));
      } else {
        outboundBody = rawBody;
      }

      const credentials = route.ccSwitchProvider ? providers[route.ccSwitchProvider] : {
        baseUrl: envValue(route.baseUrlEnv, `${routeModel}.baseUrlEnv`),
        apiKey: envValue(route.apiKeyEnv, `${routeModel}.apiKeyEnv`),
      };
      const upstreamBaseUrl = credentials.baseUrl;
      const upstreamApiKey = credentials.apiKey;
      const target = upstreamUrl(upstreamBaseUrl, request);
      const upstreamResponse = await fetch(target, {
        method: request.method,
        headers: incomingHeaders(request, upstreamApiKey),
        body: outboundBody.length > 0 ? outboundBody : undefined,
        redirect: "manual",
      });

      response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse));
      console.error(
        `[gateway] ${request.method} ${pathname} model=${routeModel} route=${routeModel}` +
          ` upstream=${target.host} status=${upstreamResponse.status} ${Date.now() - startedAt}ms`,
      );
      await streamResponse(upstreamResponse, response);
    } catch (error) {
      const statusCode = Number(error.statusCode) || 502;
      console.error(`[gateway] ${request.method} ${pathname} model=${routeModel} error=${error.message}`);
      if (response.headersSent) {
        response.destroy(error);
      } else {
        jsonResponse(response, statusCode, {
          error: {
            message: statusCode === 502 ? "upstream request failed" : error.message,
            type: statusCode === 502 ? "upstream_error" : "invalid_request_error",
          },
        });
      }
    }
  });
}

async function main() {
  const { configPath, mode, printModel } = parseArgs(process.argv.slice(2));
  loadDotEnv(join(dirname(configPath), ".env"));
  if (dirname(configPath) !== SCRIPT_DIR) loadDotEnv(DEFAULT_ENV);

  const config = loadConfig(configPath);
  const gatewayApiKeyEnv = validateRouteConfig(config, { requireSecrets: mode !== "check" });
  const providers = loadCcSwitchProviders(config);

  if (mode === "check") {
    console.log(`Configuration is valid: ${configPath}`);
    console.log(`Default model: ${config.defaultModel}`);
    console.log(`Routes: ${Object.keys(config.models).join(", ")}`);
    return;
  }

  if (mode === "print-route") {
    const route = routeForModel(config, printModel);
    if (!route) throw new Error(`no route configured for model ${printModel}`);
    console.log(JSON.stringify({ ...routeSummary(printModel, route),
      baseUrl: providers[route.ccSwitchProvider]?.baseUrl,
    }, null, 2));
    return;
  }

  const gatewayApiKey = envValue(gatewayApiKeyEnv, "gatewayApiKeyEnv");
  const listen = config.listen || {};
  const host = listen.host || "127.0.0.1";
  const port = Number(listen.port || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("listen.port must be an integer between 1 and 65535");
  }

  const server = createServer(config, gatewayApiKey, providers);
  server.listen(port, host, () => {
    console.log(`[gateway] listening on http://${host}:${port}`);
    console.log(`[gateway] default model: ${config.defaultModel}`);
    console.log(`[gateway] configured models: ${Object.keys(config.models).join(", ")}`);
  });
}

main().catch((error) => {
  console.error(`[gateway] fatal: ${error.message}`);
  process.exitCode = 1;
});
