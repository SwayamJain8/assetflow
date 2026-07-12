import { and, eq } from "drizzle-orm";

import { db } from "../../config/db";
import { organizations, users } from "../../db/schema";
import { AppError } from "../../middleware/error-handler";
import { issueToken } from "../../middleware/auth";
import type { AuthUser, Ctx } from "../../types";
import type { LoginInput, OnboardInput, SignupInput } from "./auth.schema";

/** The default brand, used until an admin uploads a logo (see the theming feature). */
const DEFAULT_THEME = { primary: "#14b8a6", accent: "#8b5cf6" };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const toAuthUser = (u: typeof users.$inferSelect): AuthUser => ({
  id: u.id,
  organizationId: u.organizationId,
  email: u.email,
  name: u.name,
  role: u.role,
  departmentId: u.departmentId,
});

async function session(user: typeof users.$inferSelect) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, user.organizationId));

  return {
    token: await issueToken(user),
    user: toAuthUser(user),
    organization: {
      id: org!.id,
      name: org!.name,
      slug: org!.slug,
      logoPath: org!.logoPath,
      theme: org!.theme,
    },
  };
}

/**
 * Create a NEW organization and become its Admin.
 *
 * This is the only route that mints an admin, and it can only do so for an org
 * that did not exist a moment ago — so it is not a privilege-escalation path into
 * anyone else's organization. Both writes happen in one transaction: an org with
 * no admin would be unreachable forever.
 */
export async function onboardOrganization(input: OnboardInput) {
  const slug = slugify(input.organizationName);

  if (!slug) {
    throw new AppError(422, "INVALID_ORG_NAME", "Organization name must contain letters or numbers.");
  }

  const [existing] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  if (existing) {
    throw new AppError(
      409,
      "ORGANIZATION_EXISTS",
      `An organization called "${input.organizationName}" already exists. Sign in, or ask its admin to invite you.`,
    );
  }

  const passwordHash = await Bun.password.hash(input.password);

  const admin = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: input.organizationName.trim(), slug, theme: DEFAULT_THEME })
      .returning();

    const [user] = await tx
      .insert(users)
      .values({
        organizationId: org!.id,
        name: input.name,
        email: input.email,
        passwordHash,
        role: "admin", // the founding admin — see the doc comment above
      })
      .returning();

    return user!;
  });

  return session(admin);
}

/**
 * Join an existing organization.
 *
 * `role` is never read from the input — SignupSchema has no such field, and this
 * insert does not set one. The column's DEFAULT 'employee' is what lands, so
 * self-elevation is impossible by construction rather than by a check we could
 * forget to write.
 */
export async function signup(input: SignupInput) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, input.organizationSlug));

  if (!org) {
    throw new AppError(
      404,
      "ORGANIZATION_NOT_FOUND",
      `No organization "${input.organizationSlug}" exists. Check the name, or create a new organization.`,
    );
  }

  const passwordHash = await Bun.password.hash(input.password);

  // A duplicate email trips users_org_email_unique, which the error handler turns
  // into a 409 EMAIL_TAKEN — no pre-check needed, and no race.
  const [user] = await db
    .insert(users)
    .values({
      organizationId: org.id,
      name: input.name,
      email: input.email,
      passwordHash,
      // NO role. The database default ('employee') is the only possibility.
    })
    .returning();

  return session(user!);
}

export async function login(input: LoginInput) {
  // Email is unique per organization, not globally, so the same address may exist
  // in two orgs. Resolve by slug when given; otherwise require one only if the
  // address is genuinely ambiguous.
  const matches = await db
    .select()
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .where(
      input.organizationSlug
        ? and(eq(users.email, input.email), eq(organizations.slug, input.organizationSlug))
        : eq(users.email, input.email),
    );

  if (matches.length > 1) {
    throw new AppError(
      409,
      "AMBIGUOUS_ACCOUNT",
      "That email belongs to more than one organization. Include the organization name.",
      { organizations: matches.map((m) => m.organizations.slug) },
    );
  }

  const found = matches[0]?.users;

  // Same message whether the email is unknown or the password is wrong: telling
  // the difference would let an attacker enumerate who has an account here.
  const INVALID = new AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");

  if (!found) {
    // Hash anyway, so a missing account does not answer measurably faster than a
    // wrong password and leak its existence through timing.
    await Bun.password.hash(input.password);
    throw INVALID;
  }

  if (!(await Bun.password.verify(input.password, found.passwordHash))) {
    throw INVALID;
  }

  if (found.status !== "active") {
    throw new AppError(403, "ACCOUNT_INACTIVE", "Your account has been deactivated.");
  }

  return session(found);
}

export async function currentSession(ctx: Ctx) {
  const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id));
  return session(user!);
}
