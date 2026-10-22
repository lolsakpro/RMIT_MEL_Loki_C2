import { Models } from "@tideorg/js";

const contractId = "RelationshipAttestation:1";
const modelIds = new Set(["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"]);

export interface ExpectedRelationshipPolicy {
  vendorId: string;
  subjectId: string;
  recordId: string;
  access: "read" | "read-write";
  expiresAt?: string;
}

export function validateRelationshipPolicy(
  policyB64: unknown,
  expected: ExpectedRelationshipPolicy,
): void {
  if (typeof policyB64 !== "string" || !policyB64 || policyB64.length > 100_000) {
    throw new Error("A valid signed policy is required.");
  }

  let policy: InstanceType<typeof Models.Policy>;
  try {
    const bytes = Buffer.from(policyB64, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== policyB64) {
      throw new Error("Policy encoding is invalid.");
    }
    policy = Models.Policy.from(new Uint8Array(bytes));
  } catch {
    throw new Error("The signed relationship policy could not be read.");
  }

  const params = policy.params?.entries;
  const rolesValue = params?.get("roles");
  let roles: unknown;
  try {
    roles = typeof rolesValue === "string" ? JSON.parse(rolesValue) : undefined;
  } catch {
    throw new Error("The signed relationship policy has invalid access roles.");
  }

  const expectedRoles = expected.access === "read"
    ? ["_tide_decryptor"]
    : ["_tide_encryptor", "_tide_decryptor"];
  const policyExpiry = policy.expiry == null ? undefined : Number(policy.expiry);
  const requestedExpiry = expected.expiresAt ? Math.floor(Date.parse(expected.expiresAt) / 1000) : undefined;
  const expectedParams = ["subjectType", "subjectId", "assignmentId", "roles"];
  const actualParams = params ? [...params.keys()] : [];
  const expiryMatches = requestedExpiry === undefined
    ? policyExpiry === undefined
    : policyExpiry === requestedExpiry && policyExpiry > Math.floor(Date.now() / 1000);

  if (
    policy.version !== Models.Policy.latestVersion ||
    policy.contractId !== contractId ||
    policy.keyId !== expected.vendorId ||
    policy.approvalType !== Models.ApprovalType.IMPLICIT ||
    policy.executionType !== Models.ExecutionType.PRIVATE ||
    !Array.isArray(policy.modelIds) ||
    !modelIdsIsComplete(policy.modelIds) ||
    actualParams.length !== expectedParams.length ||
    !expectedParams.every((key) => actualParams.includes(key)) ||
    params?.get("subjectType") !== "User" ||
    params.get("subjectId") !== expected.subjectId ||
    params.get("assignmentId") !== expected.recordId ||
    params.has("clientId") ||
    !Array.isArray(roles) ||
    roles.length !== expectedRoles.length ||
    !expectedRoles.every((role) => roles.includes(role)) ||
    !policy.signature?.length ||
    !expiryMatches
  ) {
    throw new Error("The signed policy does not match the requested user, entry, access, or expiry.");
  }
}

function modelIdsIsComplete(ids: string[]): boolean {
  return ids.length === modelIds.size && [...modelIds].every((id) => ids.includes(id));
}
