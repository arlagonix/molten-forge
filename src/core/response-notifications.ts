/** Foreground or interrupted runs should never produce a system toast. */
export function shouldNotifyForSettledRun({
  enabled, started, interrupted, providerAborted, focused,
}: {
  enabled: boolean;
  started: boolean;
  interrupted: boolean;
  providerAborted: boolean;
  focused: boolean;
}): boolean {
  return enabled && started && !interrupted && !providerAborted && !focused;
}
