# Offline mobile face runtime

Pinned unmodified SDK: `@vladmandic/face-api` 1.7.15, with bundled TensorFlow.js 4.22.0. The two WASM binaries come from `@tensorflow/tfjs-backend-wasm` 4.22.0. Package tarballs were checked against npm's SHA-512 integrity values before extraction. `manifest.json` pins every bundled file by SHA-256.

The existing Tiny/SSD detectors, landmark models and seven-expression weights are unchanged. Acceleration changes kernel execution; it does not establish better expression accuracy. The SDK repository was archived in February 2025; it must not be described as actively maintained or clinically validated. Future maintenance should evaluate a maintained inference stack against labeled data.

The generated mobile worker uses the SDK's own TensorFlow instance, offline platform fetch, automatic SIMD detection and no threads. It cannot fetch unknown assets. Its host CSP keeps network connections disabled and permits WASM compilation. The original website SDK remains separate. CPU fallback is functional but slower; two-second updates are a measured target, not a guarantee on every phone.

Licenses are included with the SDK, TensorFlow binaries and original model weights. Regenerate using `npm run build:face:mobile`, then verify actual model output and the packaged APK. Do not edit generated HTML manually.
