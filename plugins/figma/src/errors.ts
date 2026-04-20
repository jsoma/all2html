export class FigmaPluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigmaPluginError";
  }
}
