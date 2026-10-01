# Guarded preview cleanup

## Current behavior

This change does **not** delete anything when a PR merges. It does not supply credentials, configure an approval environment, merge dependency updates, or close existing PRs.

- Every merged PR triggers a Git-only, read-only reconciliation report from trusted default-branch code. Dependabot events need no provider credentials.
- A manual provider dry-run can produce an exact target manifest after provider setup is verified.
- A separate manual deletion workflow is **disabled by checked-in policy**. It cannot proceed merely because an environment with the right name exists.
- GitHub's automatically-delete-head-branches setting is separate Git housekeeping. It is managed outside this PR. It does not immediately delete native Vercel-managed Neon previews.
- Dependabot budgets are app 2, MCP 2, Actions 1. React/runtime/types and Vite/plugin updates are grouped together, with major upgrades in separately named review groups. Better Auth keeps coordinated groups too. There is no auto-merge and no workflow that closes existing PRs. These budgets govern new version-update PRs; they do not immediately remove the existing backlog or cap security-update PRs.

Preview data does **not** merge into production when code merges. Deleting a preview database loses its unique test accounts, decks, readings and other writes. Before approving cleanup, export or retain anything still needed.

## Why remove Vercel deployments

For the **Vercel-managed** Neon integration, all Vercel deployments for a Git branch share a Neon branch. Removing its last deployment triggers native database cleanup. Deleting a Git branch alone does not do this. The older/separate **Neon-managed** integration can instead clean obsolete Git branches during a later preview deployment.

Vercel's retention system is a backstop, not immediate merge cleanup. Active-PR/custom-alias and recent-deployment exceptions can retain previews. Restoring a Vercel deployment does not restore its deleted Neon database. Do not rely on the deployment's 30-day recovery window for database recovery.

Neon Free's published 10-branch limit includes the main branch. Eleven open bot PRs plus main cannot all have isolated previews simultaneously. Reducing future PR concurrency helps; it does not free occupied slots today.

## Safe defaults and held resources

`tools/preview-cleanup/policy.json` protects `main`, common long-lived names, release/staging/production prefixes, and both acceptance branches (`feat/self-hosted-better-auth`, `fix/sanitize-deck-svg`). Their inclusion is a conservative hold, not a claim that either still has a provider branch. Keep the currently tested preview held until the owner explicitly releases it. Additional exact deployment and Neon branch IDs can be held.

No provider IDs are invented. The Neon project ID is the owner-identified project; Vercel team/project IDs and the exact default/root Neon branch ID remain unset. `mappingVerified` and `destructiveEnabled` start false. Configure these in a reviewed follow-up change only after matching the actual Vercel resource connection to the Neon project/root.

All aliases are held by default. Successful previews commonly have generated aliases, so this default may intentionally produce **no eligible plan**. To permit generated aliases after inspecting real metadata, explicitly enable `allowVerifiedAutomaticAliases`. Each alias must then appear in Vercel's `automaticAliases`, all `userAliases` must be absent/empty as specified by the API response, and current alias inventory must agree. A `.vercel.app` suffix alone is never sufficient. Custom/unknown aliases stay held. The plan lists all affected automatic aliases for approval.

A plan must cover **every** deployment returned for the exact branch, including successful and failed ones. The planner never offers to delete only unaliased old deployments while claiming the database slot will be freed.

## Required setup, in order

### 1. Inventory and non-secret policy

Read and verify:

- Vercel team ID, exact Arcana project ID, and its attached `neon-cyclamen-bucket` resource
- That resource's Neon project `dark-poetry-32860113`, default root `main` branch ID, and all preview branch IDs/names/parents
- Current acceptance preview(s), custom aliases and long-lived environments
- A merged PR's exact head branch/SHA, all associated deployments and Neon `preview/<git-branch>` mapping

Update policy through review; leave deletion disabled during inventory validation. Never infer a database branch ID from a Git branch name. A missing, renamed, duplicate or parent-mismatched provider branch blocks the plan.

### 2. Read credentials for manual dry-runs only

Store credentials through secure provider/GitHub settings, never chat, source code, command-line arguments, dispatch input or artifacts:

- `PREVIEW_VERCEL_READ_TOKEN`: Vercel bearer token with access to deployment/alias reads for the exact team/project. Prefer a read-capable identity restricted to this project where the account supports it. Standard personal Vercel tokens are team-scoped, not inherently endpoint-level read-only: the secret name does **not** enforce read-only permission. Verify the actual principal's rights before storing it.
- `PREVIEW_NEON_READ_TOKEN`: Neon bearer credential able to list/read branches of this one project. Prefer a Viewer-scoped identity where supported. Neon project-scoped organization API keys have Editor access, not read-only, so do not mislabel one as restricted. If the Vercel-managed account cannot provide suitably bounded read access, stop and review the available setup instead of granting an organization-wide admin key.

These secrets are only used by a manually dispatched provider-plan job on the default branch. Automatic merge audits do not receive them. No Neon write credential is needed: this implementation never calls Neon DELETE/PATCH/POST.

The built-in `GITHUB_TOKEN` needs contents/pull-requests read; manual approval verification also needs Actions read. No GitHub PAT is required.

### 3. Optional deletion gate, only after separate approval

An owner must deliberately create and configure the existing environment `preview-cleanup-approved`:

- Required reviewers are explicit user accounts (not teams, whose membership the script does not validate)
- Prevent self-review is enabled; initiator and approver must differ. An authorized app/service can initiate while a human owner reviews, or two authorized people can handle the run. One person initiating and approving as the same GitHub identity will be blocked
- Deployment branch policy allows **only** the exact default branch, as type `branch`, not a wildcard/tag
- Prefer disabling administrator bypass. Regardless of that toggle, the script independently requires an actual review-history record with the exact data-loss/digest comment; bypass alone cannot satisfy it
- Record the environment's numeric ID and approved user logins in policy
- Store `PREVIEW_VERCEL_DELETE_TOKEN` **only in this protected environment**, never at repository/organization scope. It needs `DELETE /v13/deployments/{id}` rights for the same Vercel project/team. Limit the principal and token to the smallest available scope and expiry. Do not assume a normal team token is limited to previews

The preflight reads the existing environment's ID, required reviewers, prevent-self-review flag and exact branch policy before the environment job can run. The apply stage reads them again and verifies the live run's independent approval record. An automatically created unprotected environment fails both checks.

Credential creation and persistent access are separate security approvals. This PR does not create tokens, secrets, environments, reviewers or access grants. Do not set `destructiveEnabled: true` until setup is independently verified and reviewed.

## Per-run procedure

1. Dispatch **Preview cleanup audit** on `main` with `pr_numbers` set to a small JSON array of merged PR numbers (maximum 3). Empty `[]` performs only Git reconciliation.
2. Read the `provider-plan` job summary/artifact. A blocked or Git-only report is not a database cleanup plan. Verify exact PR, branch/SHA, Neon project/branch/parent ID, all deployment IDs/URLs/aliases, and all unique preview data that will be lost.
3. The provider plan is valid for 60 minutes and tied to a digest of the complete policy. Changing a target or policy requires a new plan.
4. If deletion is approved, dispatch **Manually approved preview data deletion** from `main`. Paste only the exact `plan` JSON, its digest, and the acknowledgment `PERMANENTLY DELETE PREVIEW DATA <digest>`.
5. A different configured reviewer examines the gate job's exact target summary and approves the pending environment job with the exact same acknowledgment as the **approval comment**. A generic “approve,” blank comment, wrong digest, self-approval or bypass is rejected.
6. Before every DELETE, the script revalidates GitHub PR state/head reuse/open-PR references, complete provider inventory, aliases, Neon root/branch/children, and the approval. It stops on any drift, partial/ambiguous response or API error. Never blindly rerun a failed destructive job; reruns are refused. Inspect its journal and prepare a new live plan for any remaining targets.
7. After deployment deletion it verifies the Neon branch is absent. A delayed cleanup is reported as unverified and fails the job for read-only follow-up; it never falls back to direct database deletion.

There is no atomic transaction spanning GitHub, Vercel and Neon. Live checks minimize but cannot eliminate the small race between revalidation and deletion. This is why deletion remains manual, small-batch, time-bounded and explicitly approved; do not concurrently reopen/reuse target branches while an approved cleanup is running.

Closed-but-unmerged PRs, fork PRs and orphan databases are deliberately outside this executor's deletion scope. Reopened PRs and shared heads/base branches of open PRs are held. An existing preview may survive a code merge and remain useful; “merged” alone never establishes that its data is disposable.

## Verification and failure behavior

Run `node --test tools/test/preview-cleanup.test.mjs`. Tests use synthetic provider fixtures only and perform no network mutations. CI also runs them on every PR.

The HTTP adapter follows no redirects and prints only sanitized status errors, never raw deployment responses (which can include private environment fields). It bounds and verifies pagination. Missing source/ownership/protection/alias fields are blockers, not permission to guess. `automaticAliases`, `userAliases` and the other Vercel fields were checked against the current official response schema, not a live project response. Provider endpoint behavior is **not yet live-validated** because credentials have not been configured. If a live response differs from documented fields, revise/test the adapter; do not weaken guards or fill missing evidence with assumed values.

## Primary references, checked October 1, 2026

- [Neon native cleanup, shared branches, recovery caveat and alternatives](https://neon.com/docs/guides/vercel-branch-cleanup)
- [Native integration lifecycle and naming](https://neon.com/docs/guides/vercel-managed-integration)
- [Neon API keys and their actual scopes](https://neon.com/docs/manage/api-keys)
- [Neon branch list API and pagination](https://neon.com/docs/reference/api/branches/list-project-branches)
- [Neon branch expiration restrictions](https://neon.com/docs/guides/branch-expiration)
- [Current Neon plan limits](https://neon.com/docs/introduction/plans)
- [Vercel list-deployments API](https://vercel.com/docs/rest-api/deployments/list-deployments)
- [Vercel deployment detail: ownerId, projectId, gitSource, target, automaticAliases, userAliases](https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url)
- [Vercel live alias inventory](https://vercel.com/docs/rest-api/aliases/list-deployment-aliases)
- [Vercel exact deployment deletion](https://vercel.com/docs/rest-api/deployments/delete-a-deployment)
- [Vercel team-scoped access tokens](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token)
- [Current Vercel retention exceptions](https://vercel.com/docs/deployment-retention)
- [GitHub environment read API and protection rules](https://docs.github.com/en/rest/deployments/environments)
- [GitHub workflow approval history](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run)
- [GitHub Dependabot secret restrictions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
- [GitHub automatically deleting merged heads](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches)
