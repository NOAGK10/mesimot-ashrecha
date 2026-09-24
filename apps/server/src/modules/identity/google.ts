import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity {
  sub: string;
  email: string;
}

/** Verifies a Google Identity Services ID token. Abstracted so tests can substitute it. */
export interface GoogleVerifier {
  verify(credential: string): Promise<GoogleIdentity | null>;
}

export function googleVerifier(clientId: string): GoogleVerifier {
  const client = new OAuth2Client(clientId);
  return {
    async verify(credential) {
      try {
        const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
        const payload = ticket.getPayload();
        if (!payload?.sub || !payload.email || !payload.email_verified) return null;
        return { sub: payload.sub, email: payload.email.toLowerCase() };
      } catch {
        return null;
      }
    },
  };
}
