/// <reference types="expo/types" />

// Metro bundles imported images as native asset references.
declare module '*.png' {
  const asset: number;
  export default asset;
}
