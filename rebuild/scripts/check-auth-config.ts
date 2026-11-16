import { loadAuthConfiguration } from '../apps/api/src/modules/identity/auth-configuration.js';
try {
  const config = loadAuthConfiguration(process.env);
  const enabled = {
    password: true,
    guest: true,
    wechatMini: !!config.wechatMini,
    email: !!config.otp?.email,
    sms: !!config.otp?.sms,
  };
  const args = process.argv.slice(2);
  if (args.some((arg) => !arg.startsWith('--require='))) throw new Error('UNKNOWN_ARGUMENT');
  const required = args.flatMap((arg) => arg.slice('--require='.length).split(','));
  if (required.some((key) => !['password', 'guest', 'wechatMini', 'email', 'sms'].includes(key)))
    throw new Error('UNKNOWN_CHANNEL');
  process.stdout.write(
    JSON.stringify(
      {
        configured: enabled,
        otpKeyConfigured: !!config.otp?.policy,
        dailyLimits: config.otp?.policy.dailyLimits || null,
        note: 'Configuration check only; does not send messages or verify provider delivery.',
      },
      null,
      2,
    ) + '\n',
  );
  if (required.some((key) => !enabled[key as keyof typeof enabled])) {
    process.stderr.write('REQUIRED_AUTH_CHANNEL_NOT_CONFIGURED\n');
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    (error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : 'AUTH_CONFIGURATION_INVALID') + '\n',
  );
  process.exitCode = 1;
}
