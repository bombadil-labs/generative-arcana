import { MigrationSafetyError, type Connection } from './domain-migrations';
/** Require a direct, non-member application migrator, not a renamed Neon owner. */
export async function restrictedMigrator(db:Connection) {
  const result=(await db.query(`SELECT current_user=session_user AS direct,
    NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS limited,
    NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS no_memberships,
    NOT has_database_privilege(current_user,current_database(),'CREATE') AS no_database_create,
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relowner=r.oid AND n.nspname !~ '^pg_' AND (n.nspname<>'public' OR c.relname LIKE 'arcana_auth_%')) AS no_auth_ownership,
    NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('public','information_schema')
      AND n.nspname !~ '^pg_' AND has_schema_privilege(current_user,n.oid,'CREATE')) AS no_other_schema_create
    FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
  if(!result?.direct||!result.limited||!result.no_memberships||!result.no_database_create||!result.no_auth_ownership||!result.no_other_schema_create)throw new MigrationSafetyError('Restricted application migrator required; review role attributes, memberships and schema privileges');
}
