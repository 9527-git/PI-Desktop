/**
 * Outbound stream boundary for the context-compaction summary request.
 *
 * pi-agent-core owns that request: since 1.1, `compact` assembles its own
 * stream options and reaches the provider only through the `StreamFn` the
 * caller supplies. Left to the pi-ai default, the summary would miss the
 * session's provider headers — OpenCode Go answers 400 to a request without
 * `x-opencode-session`, which is why `/compact` failed on that provider while
 * ordinary turns worked, and a provider row's own custom headers were missing
 * from the same call. The boundary mirrors the turn `streamFn`: same options
 * shape, one seam, applied to the single summary request.
 */

import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  Api,
  Context,
  Model,
  Models,
  ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  openCodeEndpointFromProvider,
  withOpenCodeSessionHeaders,
} from "./opencode-session-headers.js";
import {
  copilotRequestHeaders,
  type RuntimeProviderConfig,
} from "./provider-binding.js";
import { mergeProviderHeaders, withProviderHeaders } from "./provider-headers.js";

/**
 * The header set `streamFn` puts on a turn, applied to a summary request.
 *
 * The session id is the runtime's own, not the per-call id pi-agent-core falls
 * back to, so the summary reaches the same gateway backend as the conversation
 * it summarizes — the same id the session's turns already send.
 */
export function compactionRequestOptions(input: {
  provider: RuntimeProviderConfig;
  sessionId: string;
  model: Model<Api>;
  context: Pick<Context, "messages">;
  options?: ModelsSimpleStreamOptions;
}): ModelsSimpleStreamOptions {
  const { provider, sessionId, model, context, options } = input;
  return withProviderHeaders(
    withOpenCodeSessionHeaders(
      { ...options, sessionId },
      { ...openCodeEndpointFromProvider(provider, model), sessionId },
    ),
    mergeProviderHeaders(
      copilotRequestHeaders(provider, context),
      provider.headers,
    ),
  );
}

/**
 * The `streamFn` passed to `compact` for the summary request: every call goes
 * through the collection's `streamSimple` with the compaction header set.
 * Later pi releases may call the boundary more than once (split-turn prefix
 * summaries); each request re-applies the same options.
 */
export function compactionRequestStream(
  models: Models,
  provider: RuntimeProviderConfig,
  sessionId: string,
): StreamFn {
  return (model, context, options) =>
    models.streamSimple(
      model,
      context,
      compactionRequestOptions({ provider, sessionId, model, context, options }),
    );
}
