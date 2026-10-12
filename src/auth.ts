import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/server/db/client";
import { accounts, sessions, users, verificationTokens } from "@/server/db/schema";

export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Auth.js owns sessions (database strategy) and sign-out. Sign-in itself is
 * done by our own routes: "Log in with PayPal" (/auth/paypal ->
 * /api/auth/callback/paypal) and the demo login. Both write a normal row to
 * the sessions table, which Auth.js then reads here.
 */
export const { handlers, auth, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [],
  session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 60 * 60 },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
}));
