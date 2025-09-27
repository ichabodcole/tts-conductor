// src/index.ts
var TtsConductor = class {
  constructor(config) {
    this.config = config;
    this.providers = /* @__PURE__ */ new Map();
  }
  registerProvider(factory) {
    this.providers.set(factory.id, factory);
    this.config.logger?.debug?.("Registered provider", factory.id);
  }
  hasProvider(id) {
    return this.providers.has(id);
  }
  listProviders() {
    return Array.from(this.providers.keys());
  }
  createProvider(id, options) {
    const factory = this.providers.get(id);
    if (!factory) {
      throw new Error(`Provider '${id}' is not registered`);
    }
    this.config.logger?.info?.("Creating provider instance", id);
    return factory.create({ config: this.config }, options);
  }
};
function createTtsConductor(config) {
  return new TtsConductor(config);
}
export {
  TtsConductor,
  createTtsConductor
};
//# sourceMappingURL=index.js.map