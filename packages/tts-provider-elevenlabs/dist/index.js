// src/index.ts
var elevenLabsProviderFactory = {
  id: "11labs",
  create(ctx, options) {
    ctx.config.logger?.debug?.("[ElevenLabs] init", { hasKey: Boolean(options.apiKey) });
    return {
      id: "11labs",
      async synthesize(_ssml) {
        throw new Error("createElevenLabsProvider not yet implemented");
      }
    };
  }
};
var index_default = elevenLabsProviderFactory;
export {
  index_default as default,
  elevenLabsProviderFactory
};
//# sourceMappingURL=index.js.map