const DEFAULT_PASSWORD_SALT_ROUNDS = 12
const TEST_PASSWORD_SALT_ROUNDS = 1

export function getPasswordSaltRounds(): number {
  return process.env.INTEGRATION_TEST_FAST_BCRYPT === '1'
    ? TEST_PASSWORD_SALT_ROUNDS
    : DEFAULT_PASSWORD_SALT_ROUNDS
}
