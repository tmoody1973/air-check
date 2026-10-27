// Clerk issues the JWTs. Set CLERK_JWT_ISSUER_DOMAIN in the Convex deployment env.
export default {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" }],
};
