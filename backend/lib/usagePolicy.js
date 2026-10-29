/** Shared fail-closed result when usage / Admin cannot be verified. */
export const usageUnavailable = () => ({
  ok: false,
  code: 'USAGE_UNAVAILABLE',
  message: 'Casemate could not verify your usage right now. Please try again in a minute.',
});
