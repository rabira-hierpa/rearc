interface Window {
  /** Injected by the `preline` module (loaded in PrelineLoader). */
  HSStaticMethods: {
    autoInit(collection?: string | string[]): void;
  };
}
