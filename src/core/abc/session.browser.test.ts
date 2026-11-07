import { browserLaunchArgs } from '@waha/core/abc/session.browser';

const SANDBOX_DISABLE_ARGS = [
  '--disable-setuid-sandbox',
  '--no-sandbox',
  '--no-zygote',
];

describe('browserLaunchArgs', () => {
  it('keeps the Linux container sandbox flags on linux', () => {
    const args = browserLaunchArgs('linux');
    for (const arg of SANDBOX_DISABLE_ARGS) {
      expect(args).toContain(arg);
    }
  });

  it('omits the Linux sandbox-disable flags on macOS', () => {
    const args = browserLaunchArgs('darwin');
    for (const arg of SANDBOX_DISABLE_ARGS) {
      expect(args).not.toContain(arg);
    }
    expect(args).toContain('--disable-gpu');
    expect(args).toContain('--use-mock-keychain');
    expect(args).toContain('--window-size=1280,720');
  });

  it('does not drop any other flag on macOS', () => {
    const linux = browserLaunchArgs('linux');
    const darwin = browserLaunchArgs('darwin');
    expect(darwin).toEqual(
      linux.filter(function keep(arg: string) {
        return !SANDBOX_DISABLE_ARGS.includes(arg);
      }),
    );
  });
});
