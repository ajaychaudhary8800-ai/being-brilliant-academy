export const resetPasswordPolicy = {
  minimumLength: 10,
  maximumLength: 128,
} as const;

export type ResetPasswordValidation = { valid: true } | { valid: false; message: string };

export function validateResetPassword(password: string, confirmation: string): ResetPasswordValidation {
  if (password.length < resetPasswordPolicy.minimumLength) return { valid: false, message: "Use at least 10 characters." };
  if (password.length > resetPasswordPolicy.maximumLength) return { valid: false, message: "Password cannot exceed 128 characters." };
  if (!/[A-Z]/.test(password)) return { valid: false, message: "Include at least one uppercase letter." };
  if (!/[a-z]/.test(password)) return { valid: false, message: "Include at least one lowercase letter." };
  if (!/[0-9]/.test(password)) return { valid: false, message: "Include at least one number." };
  if (password !== confirmation) return { valid: false, message: "Passwords do not match." };
  return { valid: true };
}

export async function submitPasswordReset(
  fetcher: typeof fetch,
  apiUrl: string,
  token: string,
  password: string,
) {
  if (token.length < 20) throw new Error("This reset link is missing or invalid. Request a new link and try again.");
  let response: Response;
  try {
    response = await fetcher(`${apiUrl}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
  } catch {
    throw new Error("Unable to reach the service. Check your connection and try again.");
  }
  if (response.ok) return;
  const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (payload?.error?.code === "INVALID_RESET_TOKEN") throw new Error("This reset link is invalid, expired, or has already been used. Request a new link.");
  throw new Error(payload?.error?.message ?? "Unable to reset the password. Please try again.");
}
