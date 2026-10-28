Connection-state regression uses the production Delegate, FusionView and FrameSink with an 8×8 generated image. It needs no Viber installation, AX/screen permission, account, chat content or user files. Tests verify the state machine; they do not certify live ScreenCaptureKit/TCC or mouse forwarding.

On a GitHub Actions `macos-15` runner:

```bash
swiftc -swift-version 5 viber-fusion/main.swift -o "$RUNNER_TEMP/viber-fusion"
mkdir -p "$RUNNER_TEMP/state-regression"
cat viber-fusion/main.swift viber-fusion/state-regression.swift > "$RUNNER_TEMP/state-regression/main.swift"
swiftc -swift-version 5 -D STATE_REGRESSION "$RUNNER_TEMP/state-regression/main.swift" -o "$RUNNER_TEMP/state-regression/run"
"$RUNNER_TEMP/state-regression/run"
```

The original 3×5 account-switch loop, click forwarding assertions and containment checks remain in `viber-fusion-ui.yml`. That imported workflow references `viber-mac-preview/` and `viber-switch/`, which are absent from the requested 1.6.6 baseline and were outside the specified import set. It is preserved, but cannot honestly be reported as passing. The new state regression is independently runnable and uses synthetic data only.
