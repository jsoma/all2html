declare module "upng-js" {
  export interface UPNGModule {
    encode(
      buffers: ArrayBufferLike[],
      width: number,
      height: number,
      colorCount: number,
      delays?: number[],
      forbidPalette?: boolean,
    ): ArrayBuffer;
  }

  const UPNG: UPNGModule;
  export default UPNG;
}
